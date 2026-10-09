import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_PREFIX,
  GPS_REUSE_RADIUS_KM,
  MAX_CACHED_BUNDLES,
  MAX_CACHED_POINTS,
  POINT_PREFIX,
  clearAllCaches,
  clearCachedBundle,
  loadCachedBundle,
  loadCachedBundleFor,
  loadCachedPoint,
  saveBundle,
  saveCachedPoint,
} from './cache';
import type { NwsPoint } from './nws/points';
import { makeBundle } from './testing/builders';

/** An in-memory Storage with an optional size quota (like a real browser's). */
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  constructor(private readonly quotaChars = Infinity) {}
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    let used = value.length;
    for (const [k, v] of this.map) if (k !== key) used += v.length;
    if (used > this.quotaChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const place = (n: number): { id: string; lat: number; lon: number } => ({
  id: `${(30 + n).toFixed(4)},${(-90 - n).toFixed(4)}`,
  lat: 30 + n,
  lon: -90 - n,
});

function pointFor(n: number): NwsPoint {
  return {
    info: { wfo: 'TOP', gridX: n, gridY: n, timeZone: 'America/Chicago', city: 'Linn', state: 'KS', radarStation: null, forecastZone: null, county: null },
    urls: { forecast: 'https://f', forecastHourly: 'https://h', forecastGrid: 'https://g', stations: 'https://s' },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-09T03:00:00Z'));
  clearAllCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAllCaches();
});

/** Save places 0..n-1, one minute apart, oldest first. */
function saveMany(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(Date.parse('2026-10-09T03:00:00Z') + i * 60_000);
    saveBundle(makeBundle(place(i)));
  }
}

describe('bundle cache with localStorage', () => {
  it('round-trips a bundle under the versioned key prefix', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    const bundle = makeBundle(place(0));
    saveBundle(bundle);
    expect(storage.keys()).toEqual([`${BUNDLE_PREFIX}${place(0).id}`]);
    expect(BUNDLE_PREFIX).toBe('nws-weather:bundle:v1:');
    expect(loadCachedBundle(place(0).id)).toEqual(bundle);
    expect(loadCachedBundle('nowhere')).toBeNull();
  });

  it('keeps at most 6 places, evicting the oldest first', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    expect(MAX_CACHED_BUNDLES).toBe(6);
    saveMany(9);
    expect(storage.keys()).toHaveLength(6);
    for (let i = 0; i < 3; i++) expect(loadCachedBundle(place(i).id)).toBeNull();
    for (let i = 3; i < 9; i++) expect(loadCachedBundle(place(i).id)).not.toBeNull();
  });

  it('saving an existing place again refreshes it instead of adding another', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    saveMany(6);
    vi.setSystemTime(Date.parse('2026-10-09T05:00:00Z'));
    saveBundle(makeBundle(place(0), '2026-10-09T05:00:00.000Z')); // now the newest
    expect(storage.keys()).toHaveLength(6);
    vi.setSystemTime(Date.parse('2026-10-09T05:01:00Z'));
    saveBundle(makeBundle(place(9)));
    expect(loadCachedBundle(place(0).id)).not.toBeNull(); // survived: it was refreshed
    expect(loadCachedBundle(place(1).id)).toBeNull(); // the oldest untouched place went
  });

  it('frees space by dropping the oldest place when storage is full', () => {
    const one = JSON.stringify(makeBundle(place(0))).length + 60;
    const storage = new FakeStorage(one * 2.5); // room for two bundles
    vi.stubGlobal('localStorage', storage);
    saveMany(4);
    expect(storage.keys().length).toBeLessThanOrEqual(2);
    expect(loadCachedBundle(place(3).id)).not.toBeNull();
    expect(loadCachedBundle(place(0).id)).toBeNull();
  });

  it('survives storage that always refuses writes by keeping the bundle in memory', () => {
    const storage = new FakeStorage(10);
    vi.stubGlobal('localStorage', storage);
    saveBundle(makeBundle(place(0)));
    expect(storage.length).toBe(0);
    expect(loadCachedBundle(place(0).id)).not.toBeNull();
  });

  it('never throws when localStorage itself is unusable (private mode, blocked storage)', () => {
    const boom = (): never => {
      throw new Error('SecurityError');
    };
    const broken = {
      get length(): number {
        return boom();
      },
      key: boom,
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      clear: boom,
    } as unknown as Storage;
    vi.stubGlobal('localStorage', broken);
    expect(() => saveBundle(makeBundle(place(0)))).not.toThrow();
    expect(() => loadCachedBundle(place(0).id)).not.toThrow();
    expect(loadCachedBundle(place(0).id)).not.toBeNull(); // from the memory fallback
    expect(() => clearCachedBundle(place(0).id)).not.toThrow();
    expect(() => saveCachedPoint('1,2', pointFor(1))).not.toThrow();
  });

  it('rejects corrupt, foreign or outdated records', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    const key = `${BUNDLE_PREFIX}${place(0).id}`;
    storage.setItem(key, '{not json');
    expect(loadCachedBundle(place(0).id)).toBeNull();
    storage.setItem(key, JSON.stringify({ v: 2, savedAt: 1, bundle: makeBundle(place(0)) }));
    expect(loadCachedBundle(place(0).id)).toBeNull();
    storage.setItem(key, JSON.stringify({ v: 1, savedAt: 1, bundle: { place: { id: 'x' } } }));
    expect(loadCachedBundle(place(0).id)).toBeNull();
    storage.setItem(key, `{"v":1,"savedAt":1,"bundle":${JSON.stringify(makeBundle(place(5)))}}`);
    expect(loadCachedBundle(place(0).id)).toBeNull(); // record belongs to another place
  });

  it('can forget a place', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    saveBundle(makeBundle(place(0)));
    clearCachedBundle(place(0).id);
    expect(loadCachedBundle(place(0).id)).toBeNull();
  });
});

describe('bundle cache without localStorage (Node)', () => {
  it('works from memory', () => {
    expect(typeof localStorage).toBe('undefined');
    saveBundle(makeBundle(place(0)));
    expect(loadCachedBundle(place(0).id)).not.toBeNull();
    saveMany(8);
    expect(loadCachedBundle(place(0).id)).toBeNull(); // evicted: same 6-place limit
    expect(loadCachedBundle(place(7).id)).not.toBeNull();
  });
});

describe('GPS bundles', () => {
  it('are reused only while the device is near where they were fetched', () => {
    const gps = { id: 'gps', lat: 39.7456, lon: -97.0892 };
    saveBundle(makeBundle({ ...gps, kind: 'gps' }));
    expect(loadCachedBundleFor({ ...gps })).not.toBeNull();
    expect(loadCachedBundleFor({ id: 'gps', lat: 39.76, lon: -97.1 })).not.toBeNull(); // ~1.5 km
    expect(GPS_REUSE_RADIUS_KM).toBe(5);
    expect(loadCachedBundleFor({ id: 'gps', lat: 40.5, lon: -97.0892 })).toBeNull(); // ~83 km
    expect(loadCachedBundleFor({ id: 'saved-elsewhere', lat: 39.7456, lon: -97.0892 })).toBeNull();
  });
});

describe('point metadata cache', () => {
  it('round-trips with the save time and a versioned prefix', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    saveCachedPoint('39.7456,-97.0892', pointFor(1));
    expect(storage.keys()).toEqual([`${POINT_PREFIX}39.7456,-97.0892`]);
    expect(POINT_PREFIX).toBe('nws-weather:point:v1:');
    expect(loadCachedPoint('39.7456,-97.0892')).toEqual({ point: pointFor(1), savedAt: Date.now() });
    expect(loadCachedPoint('0,0')).toBeNull();
  });

  it('is bounded', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    for (let i = 0; i < MAX_CACHED_POINTS + 10; i++) {
      vi.setSystemTime(Date.parse('2026-10-09T03:00:00Z') + i * 1000);
      saveCachedPoint(`p${i}`, pointFor(i));
    }
    expect(storage.keys()).toHaveLength(MAX_CACHED_POINTS);
    expect(loadCachedPoint('p0')).toBeNull();
    expect(loadCachedPoint(`p${MAX_CACHED_POINTS + 9}`)).not.toBeNull();
  });

  it('ignores damaged records', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(`${POINT_PREFIX}k`, '{"v":1,"savedAt":5,"point":{"info":{}}}');
    expect(loadCachedPoint('k')).toBeNull();
  });
});
