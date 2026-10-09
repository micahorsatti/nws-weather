/** Small physical-model helpers used to generate believable mock series. Imperial where NWS uses imperial. */
import { cToF, fToC } from '../lib/units';

export { cToF, fToC };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/** Gaussian bump: 1 at `center`, falling off with `width` (same unit). */
export function bump(x: number, center: number, width: number): number {
  const z = (x - center) / width;
  return Math.exp(-z * z);
}

/** Relative humidity (%) from air temperature and dew point (Magnus formula), both in °C. */
export function relativeHumidity(tC: number, dewC: number): number {
  const a = 17.625;
  const b = 243.04;
  const rh = 100 * Math.exp((a * dewC) / (b + dewC) - (a * tC) / (b + tC));
  return clamp(rh, 1, 100);
}

/** NWS heat index (Rothfusz regression with the standard adjustments). Inputs °F and %RH, returns °F. */
export function heatIndexF(tF: number, rh: number): number {
  const simple = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094);
  if ((simple + tF) / 2 < 80) return simple;
  let hi =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh;
  if (rh < 13 && tF >= 80 && tF <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tF - 95)) / 17);
  else if (rh > 85 && tF >= 80 && tF <= 87) hi += ((rh - 85) / 10) * ((87 - tF) / 5);
  return hi;
}

/** NWS wind chill (2001 formula). Inputs °F and mph, returns °F. Valid for T <= 50°F and wind >= 3 mph. */
export function windChillF(tF: number, mph: number): number {
  const v = Math.pow(mph, 0.16);
  return 35.74 + 0.6215 * tF - 35.75 * v + 0.4275 * tF * v;
}

/** Piecewise cosine interpolation through (x, y) key points sorted by x. */
export function interpolate(points: readonly { x: number; y: number }[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      const u = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * ((1 - Math.cos(Math.PI * u)) / 2);
    }
  }
  return points[points.length - 1].y;
}

/** Deterministic pseudo-noise in [-1, 1] from an integer index (no Math.random: fixtures stay stable). */
export function wobble(i: number, salt = 0): number {
  return Math.sin(i * 1.7 + salt) * 0.55 + Math.sin(i * 0.37 + salt * 2.1) * 0.45;
}

const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const DIR_WORDS = [
  'North',
  'North northeast',
  'Northeast',
  'East northeast',
  'East',
  'East southeast',
  'Southeast',
  'South southeast',
  'South',
  'South southwest',
  'Southwest',
  'West southwest',
  'West',
  'West northwest',
  'Northwest',
  'North northwest',
];

export function dir16(deg: number): string {
  return DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function dirWord(deg: number): string {
  return DIR_WORDS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Wrap text the way NWS products are wrapped: hard line breaks at ~66 columns. */
export function hardWrap(text: string, width = 66): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= width) return line;
      const words = line.split(' ');
      const out: string[] = [];
      let cur = '';
      for (const w of words) {
        if (cur && cur.length + 1 + w.length > width) {
          out.push(cur);
          cur = w;
        } else {
          cur = cur ? `${cur} ${w}` : w;
        }
      }
      if (cur) out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}
