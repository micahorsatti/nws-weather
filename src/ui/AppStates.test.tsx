// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useWeather, WeatherLoadError } from '../data';
import type { Place, WeatherBundle, WeatherErrorKind, WeatherState } from '../data';
import { GPS_PLACE_ID, placeIdFor } from '../data/types';
import { getMockBundle } from '../mocks';
import { placesStore, selectGps, selectPlace } from '../state/places';
import { settingsStore, updateSettings } from '../state/settings';

// Rendering the whole screen in jsdom is slow when the full suite runs its files in parallel: give every test room.
vi.setConfig({ testTimeout: 30_000 });

// The data layer is replaced by a stub whose state each test controls.
vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return { ...actual, useWeather: vi.fn() };
});
const useWeatherMock = vi.mocked(useWeather);

const NOW = Date.parse('2026-07-15T18:30:00Z');
const LINN: Place = { id: placeIdFor(39.6797, -96.9064), name: 'Linn, KS', lat: 39.6797, lon: -96.9064, kind: 'search' };

function state(over: Partial<WeatherState> = {}): WeatherState {
  return { bundle: null, status: 'idle', refreshing: false, error: null, fromCache: false, refresh: vi.fn(), ...over };
}

/** A mock bundle that belongs to `place` (the screen ignores bundles for any other place). */
function bundleFor(place: Place): WeatherBundle {
  const b = getMockBundle('summer', NOW);
  return { ...b, place: { ...place } };
}

function mountApp() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return { root, ...render(<App />, { container: root }) };
}

beforeEach(() => {
  localStorage.clear();
  settingsStore.reload();
  placesStore.reload();
  useWeatherMock.mockReset();
  useWeatherMock.mockReturnValue(state());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  vi.useRealTimers();
});

describe('loading', () => {
  it('shows a skeleton with the place name, not a bare spinner', () => {
    selectPlace(LINN);
    useWeatherMock.mockReturnValue(state({ status: 'loading' }));
    mountApp();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Linn, KS/ })).toBeTruthy();
    expect(screen.getByTestId('updated').textContent).toBe('Updating…');
    expect(screen.queryByTestId('hero')).toBeNull();
  });

  it('never shows another place’s forecast while the new one loads', () => {
    selectPlace(LINN);
    const phoenix: Place = { id: placeIdFor(33.4484, -112.074), name: 'Phoenix, AZ', lat: 33.4484, lon: -112.074, kind: 'search' };
    useWeatherMock.mockReturnValue(state({ status: 'ready', bundle: bundleFor(phoenix) }));
    mountApp();
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });
});

describe('errors', () => {
  const cases: [WeatherErrorKind, RegExp][] = [
    ['out-of-coverage', /NWS forecasts cover the United States and its territories — try a US location\./],
    ['network', /Check your internet connection/],
    ['nws-unavailable', /isn.t responding/],
    ['unknown', /couldn.t be loaded/],
  ];

  it.each(cases)('explains a "%s" failure and offers retry and a way to pick another place', (kind, message) => {
    selectPlace(LINN);
    const refresh = vi.fn();
    useWeatherMock.mockReturnValue(state({ status: 'error', error: new WeatherLoadError(kind, 'details'), refresh }));
    mountApp();
    const card = screen.getByTestId('error-state');
    expect(card.getAttribute('data-kind')).toBe(kind);
    expect(card.textContent).toMatch(message);
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card).getByRole('button', { name: 'Choose another place' }));
    expect(screen.getByRole('dialog', { name: 'Places' })).toBeTruthy();
  });

  it('keeps showing the forecast and says so when a refresh fails', () => {
    selectPlace(LINN);
    const refresh = vi.fn();
    useWeatherMock.mockReturnValue(state({ status: 'ready', bundle: bundleFor(LINN), error: new WeatherLoadError('network', 'offline?'), refresh }));
    mountApp();
    expect(screen.getByTestId('hero')).toBeTruthy();
    const banner = screen.getByTestId('status-banner');
    expect(banner.textContent).toMatch(/^Couldn’t refresh — showing data from \d{1,2}:\d{2}\s?[AP]M\s*Retry$/);
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('error-state')).toBeNull();
  });
});

describe('refreshing', () => {
  it('spins the refresh button and blocks a second tap while a refresh is in flight', () => {
    selectPlace(LINN);
    useWeatherMock.mockReturnValue(state({ status: 'ready', bundle: bundleFor(LINN), refreshing: true }));
    mountApp();
    const button = screen.getByTestId('refresh') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('class')).toMatch(/spin/);
    expect(screen.getByText('Refreshing forecast')).toBeTruthy(); // announced to screen readers
  });

  it('refreshes when tapped', () => {
    selectPlace(LINN);
    const refresh = vi.fn();
    useWeatherMock.mockReturnValue(state({ status: 'ready', bundle: bundleFor(LINN), refresh }));
    mountApp();
    fireEvent.click(screen.getByTestId('refresh'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('what is passed to the data layer', () => {
  it('asks for the selected place with the AirNow key from Settings (and none when there is no key)', () => {
    selectPlace(LINN);
    mountApp();
    expect(useWeatherMock).toHaveBeenLastCalledWith(expect.objectContaining({ id: LINN.id, lat: LINN.lat, lon: LINN.lon }), { airNowKey: undefined });
    act(() => updateSettings({ airNowKey: 'SECRET-AIRNOW-KEY' }));
    expect(useWeatherMock).toHaveBeenLastCalledWith(expect.objectContaining({ id: LINN.id }), { airNowKey: 'SECRET-AIRNOW-KEY' });
    act(() => updateSettings({ airNowKey: '' }));
    expect(useWeatherMock).toHaveBeenLastCalledWith(expect.objectContaining({ id: LINN.id }), { airNowKey: undefined });
  });

  it('asks for nothing before a place has been chosen, and shows the welcome card', () => {
    mountApp();
    expect(useWeatherMock).toHaveBeenLastCalledWith(null, { airNowKey: undefined });
    expect(screen.getByTestId('welcome')).toBeTruthy();
  });

  it('does not change the place it asks for when only the display name changes', () => {
    selectGps(39.6797, -96.9064);
    const bundle = bundleFor({ id: GPS_PLACE_ID, name: 'Current location', lat: 39.6797, lon: -96.9064, kind: 'gps' });
    useWeatherMock.mockReturnValue(state({ status: 'ready', bundle }));
    mountApp();
    // The forecast names the nearest city, so the stored GPS place is renamed...
    expect(placesStore.get().selected?.name).toBe('Linn, KS');
    expect(screen.getByRole('button', { name: /Linn, KS/ })).toBeTruthy();
    // ...but the data layer keeps being handed the very same place object (a new one would trigger a refetch).
    const places = useWeatherMock.mock.calls.map((c) => c[0]).filter((p): p is Place => p !== null);
    expect(places.length).toBeGreaterThan(1);
    expect(new Set(places).size).toBe(1);
  });
});
