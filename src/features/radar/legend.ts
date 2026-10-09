/**
 * Reflectivity legend. The colors were sampled from the MRMS layer's own GetLegendGraphic image
 * (https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?...request=GetLegendGraphic) and
 * rounded to a compact set of stops.
 */

export interface LegendStop {
  dbz: number;
  color: string;
}

export const LEGEND_MIN_DBZ = 5;
export const LEGEND_MAX_DBZ = 70;

/** Two stops a hair apart make the palette's hard steps (orange to red, dark red to white, magenta to purple). */
export const LEGEND_STOPS: readonly LegendStop[] = [
  { dbz: 5, color: '#556ca4' },
  { dbz: 10, color: '#4f8cb9' },
  { dbz: 15, color: '#58c1b9' },
  { dbz: 20, color: '#35d666' },
  { dbz: 25, color: '#0cb512' },
  { dbz: 30, color: '#0a760c' },
  { dbz: 35, color: '#709505' },
  { dbz: 38, color: '#ffe101' },
  { dbz: 42, color: '#eebb26' },
  { dbz: 47, color: '#fbb108' },
  { dbz: 47.6, color: '#fd0000' },
  { dbz: 52, color: '#b30d0e' },
  { dbz: 57, color: '#ae0303' },
  { dbz: 57.6, color: '#fefcff' },
  { dbz: 62, color: '#eda8fd' },
  { dbz: 66.5, color: '#f475fe' },
  { dbz: 67.2, color: '#aa00fb' },
  { dbz: 70, color: '#7800e2' },
];

/** Labeled tick marks along the bar. */
export const LEGEND_TICKS: readonly number[] = [10, 20, 30, 40, 50, 60, 70];

/** Plain-language bands under the bar, placed at the middle of their range. */
export const LEGEND_BANDS: readonly { label: string; dbz: number }[] = [
  { label: 'Light', dbz: 17 },
  { label: 'Moderate', dbz: 32 },
  { label: 'Heavy', dbz: 47 },
  { label: 'Hail', dbz: 62 },
];

/** Horizontal position of a dBZ value along the bar, as a percentage. */
export function legendPercent(dbz: number): number {
  return ((dbz - LEGEND_MIN_DBZ) / (LEGEND_MAX_DBZ - LEGEND_MIN_DBZ)) * 100;
}

/** CSS `background` value for the legend bar. */
export function legendGradient(): string {
  const stops = LEGEND_STOPS.map((s) => `${s.color} ${legendPercent(s.dbz).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Screen-reader description of the legend. */
export const LEGEND_DESCRIPTION =
  'Radar reflectivity in dBZ. Blue and green, 10 to 30, is light to moderate rain. Yellow and orange, 38 to 47, is heavy rain. Red, above 48, is very heavy rain. White and purple, above 57, suggests hail.';
