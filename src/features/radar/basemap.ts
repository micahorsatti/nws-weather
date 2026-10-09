/**
 * Basemap tiles and attribution.
 *
 * The task called for CARTO light_all / dark_all. As of 2026-10-09 CARTO's raster tiles require a
 * registered API key: every keyless request (all styles, any zoom, any Referer) returns a placeholder
 * image stamped "API KEY REQUIRED". Keys are issued by e-mail sign-up, which an agent cannot do for the
 * owner, so this module uses Esri's Light/Dark Gray Canvas instead: key-less, CORS-open, an equally quiet
 * gray style that lets the radar colors stand out, with a transparent "Reference" layer carrying place
 * names (drawn above the radar so labels stay readable). Verified 2026-10-09.
 *
 * To switch providers, change only this file (tile URLs, native zoom, attribution). CARTO's keyed form is
 * https://basemaps.cartocdn.com/rastertiles/{light_nolabels|dark_nolabels}/{z}/{x}/{y}{r}.png?key=KEY with
 * the matching *_only_labels style for the labels layer.
 */
import type { RadarSource } from './frames';
import type { Theme } from './theme';

export interface TileSpec {
  /** Leaflet URL template. */
  url: string;
  /** Highest zoom the service has real tiles for (Leaflet scales them beyond). */
  maxNativeZoom: number;
}

export interface BasemapSpec {
  /** Land, water and boundaries. */
  base: TileSpec;
  /** Place-name labels on a transparent background; sits above the radar. */
  labels: TileSpec;
}

const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';

export function basemapFor(theme: Theme): BasemapSpec {
  const variant = theme === 'dark' ? 'Dark' : 'Light';
  const tile = (layer: string): TileSpec => ({
    // Esri's tile addressing is {z}/{y}/{x}.
    url: `${ESRI_CANVAS}/World_${variant}_Gray_${layer}/MapServer/tile/{z}/{y}/{x}`,
    maxNativeZoom: 16,
  });
  return { base: tile('Base'), labels: tile('Reference') };
}

/** Background color behind not-yet-loaded tiles, matched to each basemap's land color. */
export const MAP_BACKGROUND: Record<Theme, string> = { light: '#e9e9ec', dark: '#3b3b3e' };

export interface AttributionSegment {
  text: string;
  href?: string;
}

/**
 * Attribution line, as segments the view renders (links open in a new tab).
 * Reads "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community · Radar: NOAA/NWS MRMS".
 */
export function attributionFor(source: RadarSource['kind']): AttributionSegment[] {
  const radar: AttributionSegment[] =
    source === 'wms'
      ? [{ text: 'Radar: NOAA/NWS MRMS', href: 'https://www.nssl.noaa.gov/projects/mrms/' }]
      : [{ text: 'Radar: NOAA NEXRAD via Iowa Environmental Mesonet', href: 'https://mesonet.agron.iastate.edu/' }];
  return [
    { text: 'Esri', href: 'https://www.esri.com/' },
    { text: ', HERE, Garmin, ' },
    { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    { text: ', and the GIS user community · ' },
    ...radar,
  ];
}

/** The attribution as plain text (tests, aria labels). */
export function attributionText(source: RadarSource['kind']): string {
  return attributionFor(source)
    .map((s) => s.text)
    .join('');
}
