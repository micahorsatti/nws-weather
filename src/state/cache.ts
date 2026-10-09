import { PLACES_KEY } from './places';
import { SETTINGS_KEY } from './settings';
import { safeKeys, safeRemove } from './storage';

/** Everything the UI itself owns in localStorage; "Clear cached data" never touches these. */
const KEEP = new Set([SETTINGS_KEY, PLACES_KEY]);

/** Cache Storage entries holding re-downloadable map tiles (the app shell's precache must survive for offline start). */
const TILE_CACHES = /basemap/i;

/**
 * Forget saved forecasts, NWS point metadata and radar/map caches. The user's settings, AirNow key and
 * saved places are kept. Other localStorage keys belong to the data and radar layers (all caches).
 */
export async function clearCachedData(): Promise<void> {
  for (const key of safeKeys()) {
    if (!KEEP.has(key)) safeRemove(key);
  }
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        if (TILE_CACHES.test(name)) await caches.delete(name);
      }
    }
  } catch {
    /* Cache Storage can be unavailable (insecure context, private mode); nothing else to do. */
  }
}
