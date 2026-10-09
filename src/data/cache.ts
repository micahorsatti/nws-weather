/**
 * On-device cache: the last good WeatherBundle per place (so the app opens instantly, even offline)
 * and NWS point metadata (rarely changes). Everything is best-effort: localStorage can be missing
 * (Node, tests), blocked (private mode, sandboxed iframes) or full, and none of that may ever throw.
 * An in-memory map stands in when storage is unavailable.
 *
 * Nothing secret is stored here: bundle keys are place ids, and a bundle never contains the AirNow key.
 */
import type { WeatherBundle } from './types';
import type { NwsPoint } from './nws/points';
import { finite, haversineKm, obj } from './util';

export const BUNDLE_PREFIX = 'nws-weather:bundle:v1:';
export const POINT_PREFIX = 'nws-weather:point:v1:';
/** Keep at most this many places' bundles (oldest evicted first). */
export const MAX_CACHED_BUNDLES = 6;
/** Point metadata is tiny; still bound it so browsing places can't grow storage forever. */
export const MAX_CACHED_POINTS = 40;
/** NWS grid/zone metadata for a point rarely changes. */
export const POINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A cached GPS bundle is only reused when the device is still near where it was fetched. */
export const GPS_REUSE_RADIUS_KM = 5;

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function kvGet(key: string): string | null {
  const s = storage();
  if (s) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) ?? null;
}

function kvRemove(key: string): void {
  memory.delete(key);
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

function kvKeys(prefix: string): string[] {
  const keys = new Set<string>();
  for (const k of memory.keys()) if (k.startsWith(prefix)) keys.add(k);
  const s = storage();
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null && k.startsWith(prefix)) keys.add(k);
      }
    } catch {
      /* ignore */
    }
  }
  return [...keys];
}

/** savedAt is written first in every record, so ordering never needs a full JSON.parse. */
function savedAtOf(raw: string | null): number {
  if (raw === null) return 0;
  const m = /^\{"v":1,"savedAt":(\d+)/.exec(raw);
  return m ? Number(m[1]) : 0;
}

/** Remove the oldest records under `prefix` until at most `keep` remain. */
function evictOldest(prefix: string, keep: number, protectKey?: string): void {
  const entries = kvKeys(prefix)
    .map((key) => ({ key, savedAt: savedAtOf(kvGet(key)) }))
    .sort((a, b) => a.savedAt - b.savedAt);
  let excess = entries.length - keep;
  for (const e of entries) {
    if (excess <= 0) break;
    if (e.key === protectKey) continue;
    kvRemove(e.key);
    excess -= 1;
  }
}

/** The oldest record under `prefix` other than `except`, if any. */
function oldestKey(prefix: string, except: string): string | null {
  let best: { key: string; savedAt: number } | null = null;
  for (const key of kvKeys(prefix)) {
    if (key === except) continue;
    const savedAt = savedAtOf(kvGet(key));
    if (best === null || savedAt < best.savedAt) best = { key, savedAt };
  }
  return best === null ? null : best.key;
}

/** Store `raw` under `key`; on quota errors drop the oldest other record and retry, then fall back to memory. */
function kvSet(key: string, raw: string, prefix: string, keep: number): void {
  const s = storage();
  if (s) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        s.setItem(key, raw);
        memory.delete(key);
        evictOldest(prefix, keep, key);
        return;
      } catch {
        // Quota exceeded (or storage blocked): free the oldest other record and try again.
        const victim = oldestKey(prefix, key);
        if (victim === null) break;
        kvRemove(victim);
      }
    }
  }
  memory.set(key, raw);
  evictOldest(prefix, keep, key);
}

interface BundleRecord {
  v: 1;
  savedAt: number;
  bundle: WeatherBundle;
}

function looksLikeBundle(b: unknown): b is WeatherBundle {
  const o = obj(b);
  if (!o) return false;
  const place = obj(o.place);
  const point = obj(o.point);
  return (
    place !== null &&
    typeof place.id === 'string' &&
    finite(place.lat) !== null &&
    finite(place.lon) !== null &&
    point !== null &&
    typeof point.timeZone === 'string' &&
    typeof o.fetchedAt === 'string' &&
    Array.isArray(o.hourly) &&
    Array.isArray(o.daily) &&
    Array.isArray(o.alerts) &&
    Array.isArray(o.problems) &&
    obj(o.sun) !== null
  );
}

/** Last good bundle for a place id, or null (also null for anything unparsable or from an older schema). */
export function loadCachedBundle(placeId: string): WeatherBundle | null {
  const raw = kvGet(BUNDLE_PREFIX + placeId);
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as Partial<BundleRecord>;
    if (rec.v !== 1 || !looksLikeBundle(rec.bundle)) return null;
    return rec.bundle.place.id === placeId ? rec.bundle : null;
  } catch {
    return null;
  }
}

/**
 * The cached bundle to show while a place is (re)loading. A GPS bundle is dropped when the device
 * has moved away from where it was fetched.
 */
export function loadCachedBundleFor(place: { id: string; lat: number; lon: number }): WeatherBundle | null {
  const bundle = loadCachedBundle(place.id);
  if (!bundle) return null;
  if (haversineKm(bundle.place, place) > GPS_REUSE_RADIUS_KM) return null;
  return bundle;
}

/** Save the bundle as the place's last good copy (evicting the oldest places beyond MAX_CACHED_BUNDLES). */
export function saveBundle(bundle: WeatherBundle): void {
  try {
    const raw = `{"v":1,"savedAt":${Date.now()},"bundle":${JSON.stringify(bundle)}}`;
    kvSet(BUNDLE_PREFIX + bundle.place.id, raw, BUNDLE_PREFIX, MAX_CACHED_BUNDLES);
  } catch {
    /* never let caching break loading */
  }
}

export function clearCachedBundle(placeId: string): void {
  kvRemove(BUNDLE_PREFIX + placeId);
}

interface PointRecord {
  v: 1;
  savedAt: number;
  point: NwsPoint;
}

function looksLikePoint(p: unknown): p is NwsPoint {
  const o = obj(p);
  const info = obj(o?.info);
  const urls = obj(o?.urls);
  return (
    info !== null &&
    urls !== null &&
    typeof info.wfo === 'string' &&
    finite(info.gridX) !== null &&
    finite(info.gridY) !== null &&
    typeof info.timeZone === 'string' &&
    typeof urls.forecast === 'string' &&
    typeof urls.forecastHourly === 'string' &&
    typeof urls.forecastGrid === 'string' &&
    typeof urls.stations === 'string'
  );
}

export function loadCachedPoint(key: string): { point: NwsPoint; savedAt: number } | null {
  const raw = kvGet(POINT_PREFIX + key);
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as Partial<PointRecord>;
    if (rec.v !== 1 || typeof rec.savedAt !== 'number' || !looksLikePoint(rec.point)) return null;
    return { point: rec.point, savedAt: rec.savedAt };
  } catch {
    return null;
  }
}

export function saveCachedPoint(key: string, point: NwsPoint): void {
  try {
    const raw = `{"v":1,"savedAt":${Date.now()},"point":${JSON.stringify(point)}}`;
    kvSet(POINT_PREFIX + key, raw, POINT_PREFIX, MAX_CACHED_POINTS);
  } catch {
    /* ignore */
  }
}

/** Forget everything this module cached (used by tests; handy for a future "clear data" button). */
export function clearAllCaches(): void {
  memory.clear();
  for (const prefix of [BUNDLE_PREFIX, POINT_PREFIX]) for (const k of kvKeys(prefix)) kvRemove(k);
}
