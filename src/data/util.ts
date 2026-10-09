/** Small value helpers shared across the data layer. */

/** A finite number, or null (never NaN/Infinity/undefined). */
export function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A non-empty trimmed string, or null. */
export function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export type Obj = Record<string, unknown>;

/** The value as a plain object, or null. */
export function obj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Round to `digits` decimals; keeps null and avoids -0. */
export function round(v: number | null, digits = 2): number | null {
  if (v === null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0;
}

/** Largest finite number in the list, or null when there is none. */
export function maxOf(values: Iterable<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

/** Smallest finite number in the list, or null when there is none. */
export function minOf(values: Iterable<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && (best === null || v < best)) best = v;
  }
  return best;
}

/** Sum of the finite numbers, or null when there are none. */
export function sumOf(values: Iterable<number | null | undefined>): number | null {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 16-point compass labels, clockwise from north. */
const COMPASS_DEG: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/** "SSW" -> 202.5, "220" -> 220; anything else -> null. */
export function compassToDeg(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toUpperCase();
  if (t in COMPASS_DEG) return COMPASS_DEG[t];
  const n = Number(t);
  return t !== '' && Number.isFinite(n) && n >= 0 && n <= 360 ? n % 360 : null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
