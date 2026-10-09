// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPS_PLACE_ID, placeIdFor } from '../data/types';
import type { Place } from '../data/types';
import { clearCachedData } from './cache';
import {
  GPS_DEFAULT_NAME,
  MAX_SAVED_PLACES,
  PLACES_KEY,
  isSaved,
  parsePlaces,
  placesStore,
  removePlace,
  savePlace,
  selectGps,
  selectPlace,
  setGpsName,
} from './places';
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, settingsStore, updateSettings } from './settings';
import { createStore, safeGet, safeKeys, safeSet } from './storage';
import { THEME_COLORS, applyTheme, initTheme, resolveTheme } from './theme';

const LINN: Place = { id: placeIdFor(39.6797, -96.9064), name: 'Linn, KS', lat: 39.6797, lon: -96.9064, kind: 'search' };
const PHX: Place = { id: placeIdFor(33.4484, -112.074), name: 'Phoenix, AZ', lat: 33.4484, lon: -112.074, kind: 'search' };

beforeEach(() => {
  localStorage.clear();
  settingsStore.reload();
  placesStore.reload();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('storage', () => {
  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('nope');
    });
    expect(safeGet('k')).toBeNull();
    expect(safeSet('k', 'v')).toBe(false);
    expect(safeKeys()).toEqual(expect.any(Array));
  });

  it('keeps working in memory when writes fail', () => {
    const store = createStore('test.key', (raw) => ({ n: typeof (raw as { n?: unknown } | undefined)?.n === 'number' ? (raw as { n: number }).n : 0 }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    store.set({ n: 5 });
    expect(store.get()).toEqual({ n: 5 });
  });

  it('notifies subscribers, hands out a stable snapshot, and unsubscribes', () => {
    const store = createStore('test.key2', () => ({ n: 1 }));
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const before = store.get();
    expect(store.get()).toBe(before); // same object until something changes (useSyncExternalStore needs this)
    store.set({ n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).not.toBe(before);
    off();
    store.set((prev) => ({ n: prev.n + 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ n: 3 });
  });

  it('falls back to defaults for corrupt stored JSON', () => {
    localStorage.setItem('test.key3', '{not json');
    const store = createStore('test.key3', () => ({ ok: true }));
    expect(store.get()).toEqual({ ok: true });
  });
});

describe('settings', () => {
  it('defaults to imperial, system theme and no AirNow key', () => {
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ units: 'imperial', theme: 'system', airNowKey: '' });
  });

  it('persists changes and restores them', () => {
    updateSettings({ units: 'metric', theme: 'dark' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) as string)).toMatchObject({ units: 'metric', theme: 'dark' });
    settingsStore.reload();
    expect(settingsStore.get()).toMatchObject({ units: 'metric', theme: 'dark' });
  });

  it('sanitises whatever is stored', () => {
    expect(parseSettings({ units: 'kelvin', theme: 'neon', airNowKey: 42 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ airNowKey: '  ABC-123 \n' }).airNowKey).toBe('ABC-123');
    expect(parseSettings({ airNowKey: 'x'.repeat(500) }).airNowKey).toHaveLength(80);
  });

  it('syncs when another tab changes the setting', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ units: 'metric' }));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(settingsStore.get().units).toBe('metric');
  });
});

describe('places', () => {
  it('starts empty (first run)', () => {
    expect(placesStore.get()).toEqual({ saved: [], selected: null, gps: null });
  });

  it('remembers the selected place across restarts, even if it is not saved', () => {
    selectPlace(LINN);
    placesStore.reload();
    expect(placesStore.get().selected).toEqual(LINN);
    expect(placesStore.get().saved).toEqual([]);
  });

  it('saves a place (as kind "saved"), without duplicates, and can remove it', () => {
    selectPlace(LINN);
    savePlace(LINN);
    savePlace(LINN);
    expect(placesStore.get().saved).toEqual([{ ...LINN, kind: 'saved' }]);
    expect(placesStore.get().selected).toEqual({ ...LINN, kind: 'saved' });
    expect(isSaved(placesStore.get(), LINN)).toBe(true);
    removePlace(LINN.id);
    expect(placesStore.get().saved).toEqual([]);
    expect(isSaved(placesStore.get(), LINN)).toBe(false);
  });

  it('falls back sensibly when the selected place is removed', () => {
    savePlace(LINN);
    savePlace(PHX);
    selectPlace(PHX);
    removePlace(PHX.id);
    expect(placesStore.get().selected?.id).toBe(LINN.id);
    removePlace(LINN.id);
    expect(placesStore.get().selected).toBeNull();
  });

  it('keeps at most the newest 12 saved places', () => {
    for (let i = 0; i < MAX_SAVED_PLACES + 3; i++) {
      savePlace({ id: placeIdFor(30 + i / 10, -100), name: `P${i}`, lat: 30 + i / 10, lon: -100, kind: 'search' });
    }
    const saved = placesStore.get().saved;
    expect(saved).toHaveLength(MAX_SAVED_PLACES);
    expect(saved[saved.length - 1].name).toBe(`P${MAX_SAVED_PLACES + 2}`);
  });

  it('uses the device location as the "gps" place and names it after the nearest city once known', () => {
    selectGps(39.68, -96.9);
    expect(placesStore.get().selected).toMatchObject({ id: GPS_PLACE_ID, kind: 'gps', name: GPS_DEFAULT_NAME, lat: 39.68, lon: -96.9 });
    setGpsName('Linn, KS');
    expect(placesStore.get().selected?.name).toBe('Linn, KS');
    expect(placesStore.get().gps?.name).toBe('Linn, KS');
    // A fresh fix a few hundred metres away keeps the name; a far-away one resets it.
    selectGps(39.681, -96.901);
    expect(placesStore.get().selected?.name).toBe('Linn, KS');
    selectGps(33.45, -112.07);
    expect(placesStore.get().selected?.name).toBe(GPS_DEFAULT_NAME);
  });

  it('saving the GPS place stores a regular place at those coordinates, named after the city', () => {
    selectGps(39.6797, -96.9064);
    const gps = placesStore.get().selected as Place;
    const saved = savePlace(gps, 'Linn, KS');
    expect(saved).toEqual({ id: placeIdFor(39.6797, -96.9064), name: 'Linn, KS', lat: 39.6797, lon: -96.9064, kind: 'saved' });
    expect(isSaved(placesStore.get(), gps)).toBe(true);
    expect(placesStore.get().selected?.kind).toBe('saved');
    // The GPS place itself stays available for "Use my location".
    expect(placesStore.get().gps?.id).toBe(GPS_PLACE_ID);
  });

  it('survives damaged stored data', () => {
    expect(parsePlaces(undefined)).toEqual({ saved: [], selected: null, gps: null });
    expect(parsePlaces('x')).toEqual({ saved: [], selected: null, gps: null });
    const parsed = parsePlaces({
      saved: [LINN, { id: '', name: 'x', lat: 1, lon: 1, kind: 'saved' }, { id: 'a', name: 'b', lat: 999, lon: 0, kind: 'saved' }, { ...LINN }, 7, null],
      selected: { id: 'z', name: 'Z', lat: 'north', lon: 1, kind: 'saved' },
      gps: { id: GPS_PLACE_ID, name: 'Here', lat: 40, lon: -100, kind: 'gps' },
    });
    expect(parsed.saved).toEqual([{ ...LINN, kind: 'saved' }]);
    expect(parsed.selected).toBeNull();
    expect(parsed.gps).toMatchObject({ id: GPS_PLACE_ID });
    localStorage.setItem(PLACES_KEY, '{oops');
    placesStore.reload();
    expect(placesStore.get()).toEqual({ saved: [], selected: null, gps: null });
  });
});

describe('theme', () => {
  it('resolves "system" with the OS preference and honours an explicit choice', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('always stamps the resolved value (never "system") and updates theme-color', () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">';
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    expect(metas.map((m) => m.getAttribute('content'))).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(THEME_COLORS.light);
  });

  it('adds a theme-color tag when the page has none', () => {
    document.head.innerHTML = '';
    applyTheme('light');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it('follows the OS setting at startup (matchMedia may be missing, e.g. in tests)', () => {
    expect(initTheme('system')).toBe('light'); // jsdom has no matchMedia: treated as light
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), addEventListener() {}, removeEventListener() {} }));
    expect(initTheme('system')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(initTheme('light')).toBe('light');
    vi.unstubAllGlobals();
  });
});

describe('clearCachedData', () => {
  it('removes cached forecasts but keeps settings and places', async () => {
    updateSettings({ units: 'metric', airNowKey: 'SECRET-KEY-VALUE' });
    selectPlace(LINN);
    localStorage.setItem('nws-weather:bundle:v1:39.6797,-96.9064', '{"v":1}');
    localStorage.setItem('nws-weather:point:v1:x', '{"v":1}');
    await clearCachedData();
    expect(localStorage.getItem('nws-weather:bundle:v1:39.6797,-96.9064')).toBeNull();
    expect(localStorage.getItem('nws-weather:point:v1:x')).toBeNull();
    expect(settingsStore.get()).toMatchObject({ units: 'metric', airNowKey: 'SECRET-KEY-VALUE' });
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('SECRET-KEY-VALUE');
    expect(placesStore.get().selected).toEqual(LINN);
    expect(localStorage.getItem(PLACES_KEY)).not.toBeNull();
  });
});
