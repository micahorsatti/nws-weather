/** Pure helpers behind the hourly chart: which hours to show, how to group them, where the day breaks fall. */
import type { HourlyPoint } from '../../data/types';
import { cToF } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import { futureHours } from './derive';
import { localDateKey, localHour, parseTime } from './time';

export type RangeMode = '48h' | '7d';

export const RANGE_HOURS: Record<RangeMode, number> = { '48h': 48, '7d': 168 };
/** Horizontal pixels per hour; 7-day mode is denser and groups icons/wind/UV/AQI into 3-hour cells. */
export const PX_PER_HOUR: Record<RangeMode, number> = { '48h': 56, '7d': 24 };
export const GROUP_HOURS: Record<RangeMode, number> = { '48h': 1, '7d': 3 };

export interface HourRow {
  /** Index in the displayed series. */
  i: number;
  /** Start of the hour (epoch ms). */
  t: number;
  /** Local hour 0–23 in the location's zone. */
  hour: number;
  /** Local calendar date. */
  dateKey: string;
  p: HourlyPoint;
}

/** Hours still ahead of `now` (past hours are dropped), limited to the range, with local time attached. */
export function buildRows(hourly: readonly HourlyPoint[], now: number, tz: string, mode: RangeMode): HourRow[] {
  const rows: HourRow[] = [];
  for (const p of futureHours(hourly, now).slice(0, RANGE_HOURS[mode])) {
    const t = parseTime(p.time);
    if (t === null) continue;
    rows.push({ i: rows.length, t, hour: localHour(t, tz), dateKey: localDateKey(t, tz), p });
  }
  return rows;
}

/** A run of consecutive hours drawn as one cell (start inclusive, end exclusive); `mid` is the sample hour. */
export interface Block {
  start: number;
  end: number;
  mid: number;
}

/** Group rows into cells aligned to local hours that are multiples of `step` (step 1 = one cell per hour). */
export function makeBlocks(rows: readonly HourRow[], step: number): Block[] {
  if (rows.length === 0) return [];
  if (step <= 1) return rows.map((_, i) => ({ start: i, end: i + 1, mid: i }));
  const blocks: Block[] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].hour % step === 0) {
      blocks.push({ start, end: i, mid: Math.min(i - 1, start + Math.floor((i - start) / 2)) });
      start = i;
    }
  }
  return blocks;
}

/** Indices of rows that begin a new local day (midnight), excluding the first row. */
export function daySeparators(rows: readonly HourRow[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].dateKey !== rows[i - 1].dateKey) out.push(i);
  }
  return out;
}

/** Temperature in the display unit without rounding (for geometry; round only for labels). */
export function tempForScale(c: number | null | undefined, units: UnitSystem): number | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  return units === 'imperial' ? cToF(c) : c;
}

/** True when a value deserves a printed label at this index (labels every `stride`th hour, anchored to block mids). */
export function isLabelled(index: number, stride: number, blocks: readonly Block[]): boolean {
  if (stride <= 1) return true;
  return blocks.some((b) => b.mid === index);
}

/** One-sentence text summary of the chart for assistive tech (the visually hidden table has every value). */
export function summarizeHours(rows: readonly HourRow[], units: UnitSystem, tz: string, formatStamp: (ms: number, tz: string) => string): string {
  if (rows.length === 0) return 'Hourly forecast is not available.';
  const span = rows.length > 72 ? `${Math.round(rows.length / 24)} days` : `${rows.length} hours`;
  const temps = rows.map((r) => tempForScale(r.p.tempC, units)).filter((v): v is number => v !== null);
  const feels = rows.map((r) => tempForScale(r.p.feelsLikeC, units)).filter((v): v is number => v !== null);
  const parts = [`Hourly forecast for the next ${span}.`];
  if (temps.length) parts.push(`Temperature from ${Math.round(Math.min(...temps))} to ${Math.round(Math.max(...temps))} degrees.`);
  if (feels.length) {
    const hi = Math.round(Math.max(...feels));
    const lo = Math.round(Math.min(...feels));
    if (temps.length && (hi - Math.round(Math.max(...temps)) >= 3 || Math.round(Math.min(...temps)) - lo >= 3)) {
      parts.push(`Feels like ${lo} to ${hi} degrees.`);
    }
  }
  let best: HourRow | null = null;
  for (const r of rows) {
    const c = r.p.precipChancePct ?? 0;
    if (c >= 20 && (best === null || c > (best.p.precipChancePct ?? 0))) best = r;
  }
  parts.push(best ? `Highest chance of precipitation is ${Math.round(best.p.precipChancePct ?? 0)} percent around ${formatStamp(best.t, tz)}.` : 'No significant chance of precipitation.');
  parts.push('Use the left and right arrow keys to review each hour.');
  return parts.join(' ');
}
