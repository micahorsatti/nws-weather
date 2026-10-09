/**
 * Radar sources and the frames they animate. Pure data builders; network access lives in loader.ts and
 * Leaflet access in mapController.ts.
 */
import { MINUTE_MS, pickFrameTimes } from './radarTime';
import type { RadarRegion } from './region';

export type RadarSource = { kind: 'wms'; region: RadarRegion } | { kind: 'mesonet' };

export interface RadarFrame {
  /** Unique per source and scan. Stable across refreshes so loaded layers can be reused. */
  id: string;
  /** Epoch ms of the scan (an estimate for the backup source). */
  time: number;
  /** True when `time` is an estimate. */
  approximate: boolean;
  /** WMS source: the TIME value (ISO 8601 UTC). Backup source: the Leaflet tile URL template. */
  param: string;
}

/** Stable key for a source, used to tell whether two loads came from the same place. */
export function sourceKey(source: RadarSource): string {
  return source.kind === 'wms' ? `wms:${source.region.id}` : 'mesonet';
}

/** Frames for a WMS region from its advertised scan times, oldest first, newest last. */
export function buildWmsFrames(region: RadarRegion, times: readonly number[]): RadarFrame[] {
  return pickFrameTimes(times).map((time) => {
    const param = new Date(time).toISOString();
    return { id: `wms:${region.id}:${param}`, time, approximate: false, param };
  });
}

// --- Iowa State Mesonet NEXRAD mosaic (CONUS only): the backup source -----------------------------------

const MESONET_TILE_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';

/** Tile layer suffixes, oldest first: '-m50m' is 50 minutes ago and '' is the newest. */
export const MESONET_SUFFIXES = ['-m50m', '-m40m', '-m30m', '-m20m', '-m10m', ''] as const;

/** The mosaic updates every 5 minutes and lags real time by a few minutes. */
const MESONET_STEP_MS = 5 * MINUTE_MS;
const MESONET_LAG_MS = 3 * MINUTE_MS;

/** Leaflet URL template for one backup-source layer; `bucket` busts the cache once per 5-minute period. */
export function mesonetTileTemplate(suffix: string, bucket: number): string {
  return `${MESONET_TILE_BASE}/nexrad-n0q-900913${suffix}/{z}/{x}/{y}.png?t=${bucket}`;
}

/**
 * Frames for the backup source at 10-minute spacing, oldest first. The mosaic has no timestamps, so
 * times are estimates (flagged approximate). Ids and tile URLs carry a 5-minute bucket so a refresh
 * fetches fresh tiles instead of reusing the previous period's.
 */
export function buildMesonetFrames(now: number): RadarFrame[] {
  const bucket = Math.floor(now / MESONET_STEP_MS);
  const newest = Math.floor((now - MESONET_LAG_MS) / MESONET_STEP_MS) * MESONET_STEP_MS;
  return MESONET_SUFFIXES.map((suffix) => {
    const minutesBack = suffix === '' ? 0 : Number(suffix.slice(2, -1));
    return {
      id: `mesonet:${bucket}${suffix}`,
      time: newest - minutesBack * MINUTE_MS,
      approximate: true,
      param: mesonetTileTemplate(suffix, bucket),
    };
  });
}
