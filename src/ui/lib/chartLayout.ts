/**
 * Geometry for the hourly chart, computed without touching the DOM (so it can be unit tested).
 * Rows from top to bottom: day labels, time labels, condition icons, temperature + "Feels like" lines,
 * precipitation-chance bars, wind, UV chips, AQI chips. Each row has its own scale; rows share only the
 * time axis, so there is never a dual-axis plot.
 */
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { WxIcon } from '../../data/types';
import { AQI_INFO, UV_INFO, aqiCategory, uvCategory } from '../../lib/scales';
import { wind } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import { precipShort, snowShort } from './format';
import { GROUP_HOURS, PX_PER_HOUR, daySeparators, makeBlocks, tempForScale } from './hourly';
import type { Block, HourRow, RangeMode } from './hourly';
import { formatHour, monthDayOfKey, weekdayOfKey } from './time';

export const LABEL_W = 44;
export const PAD_R = 14;
const GAP = 6;
const HEIGHTS = { day: 20, time: 20, icon: 36, temp: 132, precip: 68, wind: 56, uv: 30, aqi: 30 } as const;
const TEMP_PAD = 27;
const BAR_MAX_H = 34;

export type RowKey = keyof typeof HEIGHTS;
export interface Band {
  y: number;
  h: number;
}

export interface TimeLabel {
  x: number;
  text: string;
  anchor: 'middle' | 'start';
}
export interface DayLabel {
  x: number;
  text: string;
  dateKey: string;
}
export interface IconCell {
  i: number;
  xc: number;
  icon: WxIcon;
  day: boolean;
}
export interface ValueLabel {
  i: number;
  x: number;
  y: number;
  text: string;
  series: 'temp' | 'feels';
}
export interface Dot {
  i: number;
  x: number;
  yTemp: number | null;
  yFeels: number | null;
}
export interface Tick {
  y: number;
  text: string;
}
export interface PrecipBar {
  i: number;
  /** Left edge of the bar. */
  x: number;
  w: number;
  /** Top of the bar. */
  y: number;
  h: number;
  path: string;
  label: { x: number; y: number; text: string } | null;
  amount: { x: number; y: number; text: string; snow: boolean } | null;
}
export interface WindCell {
  i: number;
  xc: number;
  /** Rotation of an up-pointing arrow so it points where the wind is blowing toward. */
  rotate: number | null;
  speed: string;
  gust: string | null;
}
export interface ChipCell {
  i: number;
  xc: number;
  w: number;
  text: string;
  bg: string;
  fg: string;
  /** True for a placeholder (no UV at night): draw a quiet dash instead of a chip. */
  empty: boolean;
}

export interface ChartLayout {
  mode: RangeMode;
  px: number;
  n: number;
  width: number;
  height: number;
  bands: Record<RowKey, Band | null>;
  blocks: Block[];
  separators: number[];
  dayLabels: DayLabel[];
  timeLabels: TimeLabel[];
  icons: IconCell[];
  temp: null | {
    domain: [number, number];
    ticks: Tick[];
    tempPath: string;
    feelsPath: string;
    areaPath: string;
    labels: ValueLabel[];
    dots: Dot[];
    /** y of any hour's temperature / feels-like (for the selection markers). */
    yTemp: (i: number) => number | null;
    yFeels: (i: number) => number | null;
  };
  precip: { bars: PrecipBar[]; baseline: number; mid: number; top: number } | null;
  wind: WindCell[];
  uv: ChipCell[];
  aqi: ChipCell[];
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Rounded-top column ("4px rounded data-end, square at the baseline"). */
export function barPath(x: number, w: number, top: number, base: number, r = 4): string {
  const h = Math.max(0, base - top);
  const rr = Math.min(r, h, w / 2);
  if (rr <= 0) return `M${x} ${base}H${x + w}V${base - h}H${x}Z`;
  return `M${x} ${base}V${top + rr}Q${x} ${top} ${x + rr} ${top}H${x + w - rr}Q${x + w} ${top} ${x + w} ${top + rr}V${base}Z`;
}

export function layoutChart(rows: readonly HourRow[], mode: RangeMode, units: UnitSystem, tz: string, todayKey: string, now: number): ChartLayout {
  const px = PX_PER_HOUR[mode];
  const n = rows.length;
  const width = n * px + PAD_R;
  const blocks = makeBlocks(rows, GROUP_HOURS[mode]);

  const hasUv = rows.some((r) => isNum(r.p.uvIndex));
  const hasAqi = rows.some((r) => isNum(r.p.aqi));
  const hasWind = rows.some((r) => isNum(r.p.windKph));
  const hasTemp = rows.some((r) => isNum(r.p.tempC) || isNum(r.p.feelsLikeC));
  const hasPrecip = rows.some((r) => isNum(r.p.precipChancePct));

  const wanted: Record<RowKey, boolean> = { day: true, time: true, icon: true, temp: hasTemp, precip: hasPrecip, wind: hasWind, uv: hasUv, aqi: hasAqi };
  const bands = {} as Record<RowKey, Band | null>;
  let y = 0;
  (Object.keys(HEIGHTS) as RowKey[]).forEach((key) => {
    if (wanted[key]) {
      bands[key] = { y, h: HEIGHTS[key] };
      y += HEIGHTS[key] + GAP;
    } else {
      bands[key] = null;
    }
  });
  const height = Math.max(0, y - GAP);

  // ---- day separators and labels
  const separators = daySeparators(rows);
  const dayLabels: DayLabel[] = [];
  const segStarts = [0, ...separators];
  segStarts.forEach((start, k) => {
    const end = segStarts[k + 1] ?? n;
    if ((end - start) * px < 70 || !rows[start]) return;
    const key = rows[start].dateKey;
    const name = key === todayKey ? 'Today' : weekdayOfKey(key);
    dayLabels.push({ x: start * px + 6, text: key === todayKey ? name : `${name} ${monthDayOfKey(key).replace(/^[A-Za-z]+ /, '')}`, dateKey: key });
  });

  // ---- time labels and icons (one per block)
  const timeLabels: TimeLabel[] = [];
  const icons: IconCell[] = [];
  blocks.forEach((b) => {
    const row = rows[b.mid];
    const startRow = rows[b.start];
    const centre = ((b.start + b.end) / 2) * px;
    icons.push({ i: b.mid, xc: centre, icon: row.p.icon, day: row.p.isDaytime });
    const text = b.start === 0 && startRow.t <= now ? 'Now' : formatHour(startRow.t, tz);
    if (mode === '48h') {
      timeLabels.push({ x: centre, text, anchor: 'middle' });
    } else if (b.start > 0 || b.end - b.start >= 2) {
      // Tick-style labels at the left edge of each 3-hour cell (a lone leading hour has no room for one).
      timeLabels.push({ x: b.start * px + 3, text, anchor: 'start' });
    }
  });

  return {
    mode,
    px,
    n,
    width,
    height,
    bands,
    blocks,
    separators,
    dayLabels,
    timeLabels,
    icons,
    temp: bands.temp ? layoutTemp(rows, mode, units, bands.temp, px, blocks) : null,
    precip: bands.precip ? layoutPrecip(rows, mode, units, bands.precip, px) : null,
    wind: bands.wind ? layoutWind(rows, units, blocks, px) : [],
    uv: bands.uv ? layoutChips(rows, blocks, px, 'uv') : [],
    aqi: bands.aqi ? layoutChips(rows, blocks, px, 'aqi') : [],
  };
}

function layoutTemp(rows: readonly HourRow[], mode: RangeMode, units: UnitSystem, band: Band, px: number, blocks: Block[]): NonNullable<ChartLayout['temp']> {
  const tv = rows.map((r) => tempForScale(r.p.tempC, units));
  const fv = rows.map((r) => tempForScale(r.p.feelsLikeC, units));
  const finite = [...tv, ...fv].filter(isNum);
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 4) {
    const mid = (hi + lo) / 2;
    lo = mid - 2;
    hi = mid + 2;
  }
  const top = band.y + TEMP_PAD;
  const bottom = band.y + band.h - TEMP_PAD;
  const ys = scaleLinear().domain([lo, hi]).range([bottom, top]);
  const x = (i: number) => (i + 0.5) * px;

  type Pt = { i: number; v: number | null };
  const tPts: Pt[] = tv.map((v, i) => ({ i, v }));
  const fPts: Pt[] = fv.map((v, i) => ({ i, v }));
  const gen = line<Pt>()
    .defined((d) => d.v !== null)
    .x((d) => x(d.i))
    .y((d) => ys(d.v as number))
    .curve(curveMonotoneX);
  const areaGen = area<Pt>()
    .defined((d) => d.v !== null)
    .x((d) => x(d.i))
    .y0(band.y + band.h - 4)
    .y1((d) => ys(d.v as number))
    .curve(curveMonotoneX);

  // Ticks: round values inside the domain, kept off the label-padding edges.
  const ticks: Tick[] = ys
    .ticks(3)
    .filter((t) => ys(t) > top - 2 && ys(t) < bottom + 2)
    .map((t) => ({ y: ys(t), text: `${Math.round(t)}°` }));

  // Which hours get printed values: every other hour (48 h) or every 3-hour cell (7 d), plus each day's high and low.
  const labelled = new Set<number>();
  if (mode === '48h') {
    rows.forEach((r, i) => {
      if (r.hour % 2 === 0) labelled.add(i);
    });
    const byDay = new Map<string, { hi: number; lo: number }>();
    rows.forEach((r, i) => {
      const v = tv[i];
      if (v === null) return;
      const cur = byDay.get(r.dateKey);
      if (!cur) byDay.set(r.dateKey, { hi: i, lo: i });
      else {
        if (v > (tv[cur.hi] as number)) cur.hi = i;
        if (v < (tv[cur.lo] as number)) cur.lo = i;
      }
    });
    byDay.forEach(({ hi: h, lo: l }) => {
      labelled.add(h);
      labelled.add(l);
    });
  } else {
    blocks.forEach((b) => labelled.add(b.mid));
  }

  const labels: ValueLabel[] = [];
  const dots: Dot[] = [];
  rows.forEach((_, i) => {
    if (!labelled.has(i)) return;
    const t = tv[i];
    const f = fv[i];
    const shownT = t !== null ? Math.round(t) : null;
    const shownF = f !== null ? Math.round(f) : null;
    const yT = t !== null ? ys(t) : null;
    const yF = f !== null ? ys(f) : null;
    const differs = shownT !== null && shownF !== null && Math.abs(shownF - shownT) >= 2;
    const feelsAbove = differs && (f as number) > (t as number);
    if (t !== null && yT !== null) {
      labels.push({ i, x: x(i), y: feelsAbove ? yT + 18 : yT - 9, text: `${shownT}°`, series: 'temp' });
    }
    if (differs && f !== null && yF !== null) {
      labels.push({ i, x: x(i), y: feelsAbove ? yF - 9 : yF + 18, text: `${shownF}°`, series: 'feels' });
    }
    dots.push({ i, x: x(i), yTemp: yT, yFeels: differs ? yF : null });
  });

  return {
    domain: [lo, hi],
    ticks,
    tempPath: gen(tPts) ?? '',
    feelsPath: gen(fPts) ?? '',
    areaPath: areaGen(tPts) ?? '',
    labels,
    dots,
    yTemp: (i) => (tv[i] === null || tv[i] === undefined ? null : ys(tv[i] as number)),
    yFeels: (i) => (fv[i] === null || fv[i] === undefined ? null : ys(fv[i] as number)),
  };
}

function layoutPrecip(rows: readonly HourRow[], mode: RangeMode, units: UnitSystem, band: Band, px: number): NonNullable<ChartLayout['precip']> {
  const top = band.y + 17;
  const baseline = top + BAR_MAX_H;
  const bw = Math.min(24, px - 6);
  // In 7-day mode only each day's peak is labelled.
  const peakOfDay = new Map<string, number>();
  if (mode === '7d') {
    rows.forEach((r, i) => {
      const c = r.p.precipChancePct ?? 0;
      const cur = peakOfDay.get(r.dateKey);
      if (cur === undefined || c > (rows[cur].p.precipChancePct ?? 0)) peakOfDay.set(r.dateKey, i);
    });
  }
  const peaks = new Set(peakOfDay.values());

  const bars: PrecipBar[] = [];
  rows.forEach((r, i) => {
    const chance = r.p.precipChancePct;
    if (!isNum(chance) || chance <= 0) return;
    const h = Math.max(2, (Math.min(100, chance) / 100) * BAR_MAX_H);
    const x = (i + 0.5) * px - bw / 2;
    const y = baseline - h;
    const showLabel = mode === '48h' ? chance >= 20 : peaks.has(i) && chance >= 30;
    const snow = isNum(r.p.snowMm) && r.p.snowMm > 0.05;
    const liquid = isNum(r.p.precipMm) && r.p.precipMm > 0.025;
    let amount: PrecipBar['amount'] = null;
    if (mode === '48h' && (snow || liquid)) {
      const text = snow ? `${snowShort(r.p.snowMm, units)}${units === 'metric' ? ' cm' : ''}` : precipShort(r.p.precipMm, units);
      amount = { x: (i + 0.5) * px, y: baseline + 14, text, snow };
    }
    bars.push({
      i,
      x,
      w: bw,
      y,
      h,
      path: barPath(x, bw, y, baseline),
      label: showLabel ? { x: (i + 0.5) * px, y: y - 5, text: `${Math.round(chance)}%` } : null,
      amount,
    });
  });
  return { bars, baseline, mid: baseline - BAR_MAX_H / 2, top };
}

function layoutWind(rows: readonly HourRow[], units: UnitSystem, blocks: Block[], px: number): WindCell[] {
  const cells: WindCell[] = [];
  blocks.forEach((b) => {
    const r = rows[b.mid];
    const speed = wind(r.p.windKph, units);
    if (speed === null) return;
    let gustMax: number | null = null;
    for (let i = b.start; i < b.end; i++) {
      const g = rows[i].p.windGustKph;
      if (isNum(g) && (gustMax === null || g > gustMax)) gustMax = g;
    }
    const gust = gustMax !== null ? wind(gustMax, units) : null;
    cells.push({
      i: b.mid,
      xc: ((b.start + b.end) / 2) * px,
      rotate: isNum(r.p.windDirDeg) ? (r.p.windDirDeg + 180) % 360 : null,
      speed: String(speed),
      gust: gust !== null && gust > speed ? String(gust) : null,
    });
  });
  return cells;
}

function layoutChips(rows: readonly HourRow[], blocks: Block[], px: number, kind: 'uv' | 'aqi'): ChipCell[] {
  const cells: ChipCell[] = [];
  blocks.forEach((b) => {
    let best: number | null = null;
    for (let i = b.start; i < b.end; i++) {
      const v = kind === 'uv' ? rows[i].p.uvIndex : rows[i].p.aqi;
      if (isNum(v) && (best === null || v > best)) best = v;
    }
    if (best === null) return;
    const bw = (b.end - b.start) * px;
    const w = Math.min(bw - 10, 46);
    const xcen = ((b.start + b.end) / 2) * px;
    if (kind === 'uv' && best < 0.5) {
      cells.push({ i: b.mid, xc: xcen, w, text: '–', bg: 'transparent', fg: 'currentColor', empty: true });
      return;
    }
    const info = kind === 'uv' ? UV_INFO[uvCategory(best)] : AQI_INFO[aqiCategory(best)];
    cells.push({ i: b.mid, xc: xcen, w, text: String(Math.round(best)), bg: info.color, fg: info.onColor, empty: false });
  });
  return cells;
}

