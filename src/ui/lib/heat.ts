/**
 * Temperature to color for the 10-day range bars. A semantic "heat" ramp (cold blue to hot red) keyed to
 * absolute temperature, so a bar's colors tell you how cold or hot the day is independent of the other days.
 * The numbers at both ends of every bar are the scale; color never carries the value alone.
 */
import { cToF } from '../../lib/units';

interface Knot {
  f: number;
  rgb: [number, number, number];
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const KNOTS: Knot[] = [
  { f: 0, rgb: hex('#6a62d8') },
  { f: 20, rgb: hex('#3f86ea') },
  { f: 40, rgb: hex('#1fa6c4') },
  { f: 55, rgb: hex('#2eb87f') },
  { f: 70, rgb: hex('#d4a514') },
  { f: 85, rgb: hex('#ee8a22') },
  { f: 100, rgb: hex('#e5484d') },
  { f: 110, rgb: hex('#b4233a') },
];

function mix(a: [number, number, number], b: [number, number, number], u: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * u));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** CSS color for a temperature in °C. */
export function heatColor(c: number): string {
  const f = cToF(c);
  if (f <= KNOTS[0].f) return mix(KNOTS[0].rgb, KNOTS[0].rgb, 0);
  for (let i = 1; i < KNOTS.length; i++) {
    if (f <= KNOTS[i].f) {
      const a = KNOTS[i - 1];
      const b = KNOTS[i];
      return mix(a.rgb, b.rgb, (f - a.f) / (b.f - a.f));
    }
  }
  const last = KNOTS[KNOTS.length - 1];
  return mix(last.rgb, last.rgb, 0);
}

/** A left-to-right CSS gradient covering a low..high temperature range (°C), with a stop at each ramp knot inside it. */
export function heatGradient(lowC: number, highC: number): string {
  const lo = Math.min(lowC, highC);
  const hi = Math.max(lowC, highC);
  if (hi - lo < 0.01) return heatColor(lo);
  const stops: string[] = [`${heatColor(lo)} 0%`];
  const loF = cToF(lo);
  const hiF = cToF(hi);
  for (const k of KNOTS) {
    if (k.f > loF && k.f < hiF) {
      const pct = ((k.f - loF) / (hiF - loF)) * 100;
      stops.push(`rgb(${k.rgb[0]} ${k.rgb[1]} ${k.rgb[2]}) ${pct.toFixed(1)}%`);
    }
  }
  stops.push(`${heatColor(hi)} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
