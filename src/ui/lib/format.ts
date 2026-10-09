import { cToF, mmToIn } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Compact precipitation amount for tight spaces (the unit goes in a label): "0.12", "<.01", "1.2", "12". */
export function precipShort(mm: number | null | undefined, units: UnitSystem): string {
  if (!isNum(mm)) return '';
  if (units === 'imperial') {
    const inch = mmToIn(mm);
    if (inch > 0 && inch < 0.01) return '<.01';
    return inch >= 1 ? inch.toFixed(1) : inch.toFixed(2).replace(/^0/, '');
  }
  if (mm > 0 && mm < 0.1) return '<0.1';
  return mm >= 10 ? String(Math.round(mm)) : mm.toFixed(1);
}

/** Snowfall without the unit: inches to 1 decimal, or centimetres. */
export function snowShort(mm: number | null | undefined, units: UnitSystem): string {
  if (!isNum(mm)) return '';
  if (units === 'imperial') return mmToIn(mm).toFixed(1);
  const cm = mm / 10;
  return cm >= 10 ? String(Math.round(cm)) : cm.toFixed(1);
}

export const precipUnit = (units: UnitSystem): string => (units === 'imperial' ? 'in' : 'mm');
export const snowUnit = (units: UnitSystem): string => (units === 'imperial' ? 'in' : 'cm');

/** "SW" -> "southwest" for screen readers; falls back to the input. */
const COMPASS_WORDS: Record<string, string> = {
  N: 'north',
  NNE: 'north-northeast',
  NE: 'northeast',
  ENE: 'east-northeast',
  E: 'east',
  ESE: 'east-southeast',
  SE: 'southeast',
  SSE: 'south-southeast',
  S: 'south',
  SSW: 'south-southwest',
  SW: 'southwest',
  WSW: 'west-southwest',
  W: 'west',
  WNW: 'west-northwest',
  NW: 'northwest',
  NNW: 'north-northwest',
};
export const compassWords = (point: string): string => COMPASS_WORDS[point] ?? point;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to a whole number for display, avoiding "-0". */
export function round0(v: number): number {
  const r = Math.round(v);
  return Object.is(r, -0) ? 0 : r;
}

export interface DewComfort {
  label: string;
  /** One-line plain-language meaning. */
  note: string;
}

/**
 * How the air feels at a given dew point (the usual meteorologist's bands, defined in °F).
 * Dew point says more about mugginess than relative humidity does.
 */
export function dewPointComfort(dewC: number | null | undefined): DewComfort | null {
  if (!isNum(dewC)) return null;
  const f = cToF(dewC);
  if (f < 50) return { label: 'Dry', note: 'Crisp and dry.' };
  if (f < 60) return { label: 'Comfortable', note: 'Pleasant air.' };
  if (f < 65) return { label: 'Slightly humid', note: 'A little sticky.' };
  if (f < 70) return { label: 'Muggy', note: 'Noticeably sticky.' };
  if (f < 75) return { label: 'Very humid', note: 'Oppressive for many people.' };
  return { label: 'Oppressive', note: 'Extremely muggy; take it easy outdoors.' };
}

/** "1 hour" / "3 hours" */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** "Moderate" -> "Moderate"; "SEVERE THUNDERSTORM WARNING" -> "Severe Thunderstorm Warning". */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
