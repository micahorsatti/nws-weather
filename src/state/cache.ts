import { CACHE_NAMESPACE, clearAllCaches } from '../data';
import { safeKeys, safeRemove } from './storage';

/**
 * The Workbox runtime cache of Esri basemap tiles (see vite.config.ts): re-downloadable map images. The app
 * shell's precache must survive so the app still starts offline.
 */
const TILE_CACHE = 'basemap-tiles';

/**
 * Forget saved forecasts, NWS point metadata and cached map tiles. The user's settings, AirNow key and saved
 * places (keys under "nwsw.") are kept.
 *
 * GitHub Pages serves every project site of an account from one origin (micahorsatti.github.io), so
 * localStorage and Cache Storage are shared with those other sites. Only what this app wrote is removed:
 * keys under the data layer's "nws-weather:" namespace (including any left by older cache versions) and
 * the one tile cache by its exact name. Never "everything except my settings".
 */
export async function clearCachedData(): Promise<void> {
  clearAllCaches(); // the in-memory copies the data layer keeps when storage is full or blocked
  for (const key of safeKeys()) {
    if (key.startsWith(CACHE_NAMESPACE)) safeRemove(key);
  }
  try {
    if (typeof caches !== 'undefined') await caches.delete(TILE_CACHE);
  } catch {
    /* Cache Storage can be unavailable (insecure context, private mode); nothing else to do. */
  }
}
