/**
 * Unit conversion and display formatting. Data is stored in canonical metric units
 * (°C, km/h, mm, Pa, m; see src/data/types.ts) and converted here for display.
 */

export type UnitSystem = 'imperial' | 'metric';

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const kphToMph = (kph: number): number => kph / 1.609344;
export const mphToKph = (mph: number): number => mph * 1.609344;
export const msToKph = (ms: number): number => ms * 3.6;
export const knotsToKph = (kt: number): number => kt * 1.852;
export const mmToIn = (mm: number): number => mm / 25.4;
export const inToMm = (inches: number): number => inches * 25.4;
export const paToInHg = (pa: number): number => pa / 3386.389;
export const paToHpa = (pa: number): number => pa / 100;
export const mToMi = (m: number): number => m / 1609.344;

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Rounded temperature in the display unit, or null. */
export function temp(c: number | null | undefined, units: UnitSystem): number | null {
  if (!isNum(c)) return null;
  const v = Math.round(units === 'imperial' ? cToF(c) : c);
  return Object.is(v, -0) ? 0 : v;
}

/** "72°" (or "72°F" with withUnit). Missing values render as an em dash. */
export function formatTemp(c: number | null | undefined, units: UnitSystem, withUnit = false): string {
  const v = temp(c, units);
  if (v === null) return '—';
  return withUnit ? `${v}°${units === 'imperial' ? 'F' : 'C'}` : `${v}°`;
}

/** Rounded wind speed in the display unit, or null. */
export function wind(kph: number | null | undefined, units: UnitSystem): number | null {
  if (!isNum(kph)) return null;
  return Math.round(units === 'imperial' ? kphToMph(kph) : kph);
}

export const windUnit = (units: UnitSystem): string => (units === 'imperial' ? 'mph' : 'km/h');

/** "12 mph" / "19 km/h". */
export function formatWind(kph: number | null | undefined, units: UnitSystem): string {
  const v = wind(kph, units);
  return v === null ? '—' : `${v} ${windUnit(units)}`;
}

/** Precipitation amount: inches to 2 decimals or millimetres to 1 decimal. */
export function formatPrecip(mm: number | null | undefined, units: UnitSystem): string {
  if (!isNum(mm)) return '—';
  if (units === 'imperial') {
    const inches = mmToIn(mm);
    if (inches > 0 && inches < 0.01) return '<0.01 in';
    return `${inches.toFixed(2)} in`;
  }
  if (mm > 0 && mm < 0.1) return '<0.1 mm';
  return `${mm.toFixed(1)} mm`;
}

/** Snowfall: inches to 1 decimal or centimetres to 1 decimal. */
export function formatSnow(mm: number | null | undefined, units: UnitSystem): string {
  if (!isNum(mm)) return '—';
  return units === 'imperial' ? `${mmToIn(mm).toFixed(1)} in` : `${(mm / 10).toFixed(1)} cm`;
}

export function formatPressure(pa: number | null | undefined, units: UnitSystem): string {
  if (!isNum(pa)) return '—';
  return units === 'imperial' ? `${paToInHg(pa).toFixed(2)} inHg` : `${Math.round(paToHpa(pa))} hPa`;
}

export function formatVisibility(m: number | null | undefined, units: UnitSystem): string {
  if (!isNum(m)) return '—';
  if (units === 'imperial') {
    const mi = mToMi(m);
    return mi >= 10 ? '10+ mi' : `${mi.toFixed(mi < 1 ? 1 : 0)} mi`;
  }
  const km = m / 1000;
  return km >= 16 ? '16+ km' : `${km.toFixed(km < 1 ? 1 : 0)} km`;
}

export function formatPercent(pct: number | null | undefined): string {
  return isNum(pct) ? `${Math.round(pct)}%` : '—';
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass label for a direction in degrees ("NE"). */
export function compassPoint(deg: number | null | undefined): string {
  if (!isNum(deg)) return '—';
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i];
}
