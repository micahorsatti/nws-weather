/**
 * NWS MRMS radar regions and which one covers a point.
 *
 * Each region is its own GeoServer workspace/layer on opengeo.ncep.noaa.gov:
 *   https://opengeo.ncep.noaa.gov/geoserver/{id}/{id}_bref_qcd/ows
 * Layer names and bounds below were read from each region's real GetCapabilities response (2026-10-09).
 * Pure module: no DOM, no Leaflet.
 */

export type RadarRegionId = 'conus' | 'alaska' | 'hawaii' | 'carib' | 'guam';

export interface RadarRegion {
  id: RadarRegionId;
  /** Short human label for the header. */
  label: string;
  /** WMS layer name. */
  layer: string;
  /** Geographic bounds of the layer: [south, west, north, east] in degrees. */
  bounds: readonly [south: number, west: number, north: number, east: number];
}

/**
 * Priority order matters where bounds overlap: CONUS and Caribbean share 20-25N, and CONUS and Alaska
 * share a sliver of the BC coast; the first containing region wins.
 */
export const RADAR_REGIONS: readonly RadarRegion[] = [
  { id: 'conus', label: 'Continental US', layer: 'conus_bref_qcd', bounds: [20, -130, 55, -60] },
  { id: 'alaska', label: 'Alaska', layer: 'alaska_bref_qcd', bounds: [50, -176, 72, -126] },
  { id: 'hawaii', label: 'Hawaii', layer: 'hawaii_bref_qcd', bounds: [15, -164, 26, -151] },
  { id: 'carib', label: 'Puerto Rico & Virgin Islands', layer: 'carib_bref_qcd', bounds: [10, -90, 25, -60] },
  { id: 'guam', label: 'Guam & Marianas', layer: 'guam_bref_qcd', bounds: [9, 140, 18, 150] },
];

/** A point this close (degrees) outside a region's bounds still uses it (coast and island edges). */
export const EDGE_TOLERANCE_DEG = 1;

export const WMS_BASE = 'https://opengeo.ncep.noaa.gov/geoserver';

/** Gap between a point and a region's bounds, in degrees (0 when inside). */
function boundsGapDeg(region: RadarRegion, lat: number, lon: number): number {
  const [south, west, north, east] = region.bounds;
  const dLat = lat < south ? south - lat : lat > north ? lat - north : 0;
  const dLon = lon < west ? west - lon : lon > east ? lon - east : 0;
  return Math.max(dLat, dLon);
}

/**
 * The radar region covering a point, or null when none does (e.g. Canada's north, Europe, American Samoa).
 * Inside beats nearby; among nearby regions the closest wins; ties keep the priority order.
 */
export function pickRegion(lat: number, lon: number): RadarRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let best: RadarRegion | null = null;
  let bestGap = Infinity;
  for (const region of RADAR_REGIONS) {
    const gap = boundsGapDeg(region, lat, lon);
    if (gap === 0) return region;
    if (gap < bestGap) {
      best = region;
      bestGap = gap;
    }
  }
  return bestGap <= EDGE_TOLERANCE_DEG ? best : null;
}

/** WMS endpoint for a region (GetMap and GetCapabilities share it). */
export function wmsEndpoint(region: RadarRegion): string {
  return `${WMS_BASE}/${region.id}/${region.layer}/ows`;
}

export function capabilitiesUrl(region: RadarRegion): string {
  return `${wmsEndpoint(region)}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

/** The Iowa Mesonet backup mosaic only exists for the continental US. */
export function hasBackupSource(region: RadarRegion | null): boolean {
  return region?.id === 'conus';
}
