/**
 * Builds the 10-day outlook: NWS day/night periods grouped by the *location's* calendar date, then
 * NOAA GFS days (via Open-Meteo) appended after the last NWS date. Per-day numbers (feels-like range,
 * precipitation, wind, UV, AQI) come from the hourly series where it covers the day, else from GFS.
 */
import { gridHighC, gridLowC, type ParsedGrid } from './nws/grid';
import { describeWmo, iconFromWmo, mostSignificant } from './icons';
import type { GfsDay } from './openMeteo';
import { sunTimesForDate } from './sun';
import {
  HOUR_MS,
  addDays,
  localDateOf,
  localHourOf,
  parseTime,
  startOfLocalDay,
  zonedWallToMs,
} from './time';
import type { AirQualityDay, DailyForecast, ForecastPeriod, HourlyPoint } from './types';
import { maxOf, minOf, round, sumOf } from './util';

export const MAX_DAILY_DAYS = 10;
/** An hourly window counts as "covering" a day/period when at least this share of its hours has data. */
const MIN_COVERAGE = 0.8;

export interface DailyInputs {
  now: number;
  timeZone: string;
  lat: number;
  lon: number;
  /** NWS 12-hour periods, chronological; empty when the forecast request failed. */
  periods: ForecastPeriod[];
  /** Hourly series, which may start earlier today than `now` (whatever the grid still holds). */
  series: HourlyPoint[];
  grid: ParsedGrid | null;
  /** GFS daily rows (may be empty). */
  gfs: GfsDay[];
  /** AirNow's official daily forecast, for aqiMax. */
  airForecast: AirQualityDay[];
  /** Defaults to 10. */
  maxDays?: number;
}

/** One local calendar date's NWS day and night periods. */
export interface DaySlot {
  date: string;
  day: ForecastPeriod | null;
  /** The night that starts that evening. */
  night: ForecastPeriod | null;
}

/**
 * Group 12-hour periods by the local date they start on.
 *  - a daytime period is that date's `day` ("Today", "This Afternoon", "Thursday")
 *  - a night period starting in the afternoon/evening is that date's `night` ("Tonight", "Thursday Night")
 *  - a night period starting before noon is the after-midnight tail of the previous night ("Overnight");
 *    it appears in the hourly series only
 * Periods that already ended, and dates before today, are ignored.
 */
export function groupPeriods(periods: ForecastPeriod[], timeZone: string, today: string, now: number): DaySlot[] {
  const slots = new Map<string, DaySlot>();
  const slotFor = (date: string): DaySlot => {
    let s = slots.get(date);
    if (!s) {
      s = { date, day: null, night: null };
      slots.set(date, s);
    }
    return s;
  };

  for (const p of periods) {
    const start = parseTime(p.startTime);
    const end = parseTime(p.endTime);
    if (start === null || end === null || end <= now) continue;
    const date = localDateOf(start, timeZone);
    if (date < today) continue;
    if (p.isDaytime) {
      const slot = slotFor(date);
      slot.day ??= p;
    } else if (localHourOf(start, timeZone) >= 12) {
      const slot = slotFor(date);
      slot.night ??= p;
    }
  }
  return [...slots.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

interface Pt {
  ms: number;
  p: HourlyPoint;
}

interface Stat {
  value: number | null;
  /** Share of the window's hours that had a value (0-1). */
  coverage: number;
}

function stat(points: Pt[], from: number, to: number, pick: (p: HourlyPoint) => number | null, op: 'max' | 'min' | 'sum'): Stat {
  const values: number[] = [];
  for (const { ms, p } of points) {
    if (ms < from || ms >= to) continue;
    const v = pick(p);
    if (v !== null) values.push(v);
  }
  const expected = Math.max(1, Math.round((to - from) / HOUR_MS));
  const value = op === 'max' ? maxOf(values) : op === 'min' ? minOf(values) : sumOf(values);
  return { value, coverage: values.length / expected };
}

/** Hourly value when the window is well covered; otherwise the model's whole-day number, else whatever partial data exists. */
function resolve(s: Stat, fallback: number | null | undefined): number | null {
  if (s.value !== null && s.coverage >= MIN_COVERAGE) return s.value;
  return fallback ?? s.value;
}

interface Ctx {
  timeZone: string;
  lat: number;
  lon: number;
  today: string;
  points: Pt[];
  grid: ParsedGrid | null;
  gfsByDate: Map<string, GfsDay>;
  airNowByDate: Map<string, number>;
}

function periodWindow(p: ForecastPeriod): [number, number] | null {
  const from = parseTime(p.startTime);
  const to = parseTime(p.endTime);
  return from !== null && to !== null && to > from ? [from, to] : null;
}

function sunFor(date: string, c: Ctx): { sunrise: string | null; sunset: string | null } {
  const sun = sunTimesForDate(date, c.timeZone, c.lat, c.lon);
  return { sunrise: sun.sunrise, sunset: sun.sunset };
}

/** The numbers shared by every kind of day, taken from the hourly series (falling back to GFS). */
function commonStats(date: string, c: Ctx) {
  const from = startOfLocalDay(date, c.timeZone);
  const to = startOfLocalDay(addDays(date, 1), c.timeZone);
  const gfs = c.gfsByDate.get(date);
  const precip = stat(c.points, from, to, (p) => p.precipMm, 'sum');
  const snow = stat(c.points, from, to, (p) => p.snowMm, 'sum');
  const wind = stat(c.points, from, to, (p) => p.windKph, 'max');
  const gust = stat(c.points, from, to, (p) => p.windGustKph, 'max');
  const uv = stat(c.points, from, to, (p) => p.uvIndex, 'max');
  const aqi = stat(c.points, from, to, (p) => p.aqi, 'max');
  const pop = stat(c.points, from, to, (p) => p.precipChancePct, 'max');
  return {
    precipMm: round(resolve(precip, gfs?.precipMm)),
    snowMm: round(resolve(snow, gfs?.snowMm)),
    windKph: round(resolve(wind, gfs?.windKph), 1),
    windGustKph: round(resolve(gust, gfs?.windGustKph), 1),
    uvIndexMax: round(gfs?.uvIndexMax ?? uv.value, 1),
    aqiMax: c.airNowByDate.get(date) ?? (aqi.value === null ? null : Math.round(aqi.value)),
    hourlyPop: pop.value,
  };
}

function nwsDay(slot: DaySlot, c: Ctx): DailyForecast {
  const { date, day, night } = slot;
  const gfs = c.gfsByDate.get(date);
  const common = commonStats(date, c);

  // "Feels like" extremes: highs over the daytime window, lows over the night that starts that evening.
  const dayWin = (day && periodWindow(day)) ?? [zonedWallToMs(date, 6, 0, c.timeZone), zonedWallToMs(date, 18, 0, c.timeZone)];
  const nightWin =
    (night && periodWindow(night)) ?? [zonedWallToMs(date, 18, 0, c.timeZone), zonedWallToMs(addDays(date, 1), 6, 0, c.timeZone)];
  const feelsHigh = stat(c.points, dayWin[0], dayWin[1], (p) => p.feelsLikeC, 'max');
  const feelsLow = stat(c.points, nightWin[0], nightWin[1], (p) => p.feelsLikeC, 'min');

  const highC = day?.tempC ?? (c.grid ? gridHighC(c.grid, date, c.timeZone) : null);
  const lowC = night?.tempC ?? (c.grid ? gridLowC(c.grid, date, c.timeZone) : null);
  const pop = maxOf([day?.precipChancePct, night?.precipChancePct]) ?? common.hourlyPop ?? gfs?.precipChancePct ?? null;
  const primary = day ?? night;

  return {
    date,
    source: 'nws',
    highC: round(highC),
    lowC: round(lowC),
    feelsLikeHighC: round(resolve(feelsHigh, gfs?.feelsLikeHighC)),
    feelsLikeLowC: round(resolve(feelsLow, gfs?.feelsLikeLowC)),
    precipChancePct: round(pop, 0),
    precipMm: common.precipMm,
    snowMm: common.snowMm,
    windKph: common.windKph,
    windGustKph: common.windGustKph,
    uvIndexMax: common.uvIndexMax,
    aqiMax: common.aqiMax,
    icon: primary?.icon ?? 'unknown',
    isDaytimeIcon: day !== null,
    summary: day?.shortForecast || night?.shortForecast || '',
    day,
    night,
    ...sunFor(date, c),
  };
}

function gfsDay(g: GfsDay, c: Ctx): DailyForecast {
  const common = commonStats(g.date, c);
  return {
    date: g.date,
    source: 'gfs',
    highC: round(g.highC),
    lowC: round(g.lowC),
    feelsLikeHighC: round(g.feelsLikeHighC),
    feelsLikeLowC: round(g.feelsLikeLowC),
    precipChancePct: round(g.precipChancePct, 0),
    precipMm: round(g.precipMm),
    snowMm: round(g.snowMm),
    windKph: round(g.windKph, 1),
    windGustKph: round(g.windGustKph, 1),
    uvIndexMax: round(g.uvIndexMax, 1),
    aqiMax: common.aqiMax,
    icon: iconFromWmo(g.weatherCode),
    isDaytimeIcon: true,
    summary: describeWmo(g.weatherCode),
    day: null,
    night: null,
    ...sunFor(g.date, c),
  };
}

/**
 * Fallback when the NWS period forecast is unavailable but hourly/grid data exist: one day per local
 * date in the series (today, plus any date with at least half a day of hours).
 */
function synthesizedDay(date: string, c: Ctx): DailyForecast | null {
  const from = startOfLocalDay(date, c.timeZone);
  const to = startOfLocalDay(addDays(date, 1), c.timeZone);
  const hours = c.points.filter((pt) => pt.ms >= from && pt.ms < to);
  if (hours.length === 0) return null;
  if (date !== c.today && hours.length < 12) return null;

  const common = commonStats(date, c);
  const temps = hours.map((h) => h.p.tempC);
  const feels = hours.map((h) => h.p.feelsLikeC);
  const daytime = hours.filter((h) => h.p.isDaytime);
  const basis = daytime.length > 0 ? daytime : hours;
  const icon = mostSignificant(basis.map((h) => h.p.icon));
  const rep = basis.find((h) => h.p.icon === icon) ?? basis[0];
  const gfs = c.gfsByDate.get(date);

  return {
    date,
    source: 'nws',
    highC: round((c.grid ? gridHighC(c.grid, date, c.timeZone) : null) ?? maxOf(temps)),
    lowC: round((c.grid ? gridLowC(c.grid, date, c.timeZone) : null) ?? minOf(temps)),
    feelsLikeHighC: round(maxOf(feels) ?? gfs?.feelsLikeHighC ?? null),
    feelsLikeLowC: round(minOf(feels) ?? gfs?.feelsLikeLowC ?? null),
    precipChancePct: round(common.hourlyPop ?? gfs?.precipChancePct ?? null, 0),
    precipMm: common.precipMm,
    snowMm: common.snowMm,
    windKph: common.windKph,
    windGustKph: common.windGustKph,
    uvIndexMax: common.uvIndexMax,
    aqiMax: common.aqiMax,
    icon,
    isDaytimeIcon: daytime.length > 0,
    summary: rep.p.shortForecast,
    day: null,
    night: null,
    ...sunFor(date, c),
  };
}

export function buildDaily(i: DailyInputs): DailyForecast[] {
  const max = i.maxDays ?? MAX_DAILY_DAYS;
  const today = localDateOf(i.now, i.timeZone);
  const points: Pt[] = [];
  for (const p of i.series) {
    const ms = parseTime(p.time);
    if (ms !== null) points.push({ ms, p });
  }
  const airNowByDate = new Map<string, number>();
  for (const d of i.airForecast) if (d.source === 'airnow' && d.aqi !== null) airNowByDate.set(d.date, d.aqi);

  const c: Ctx = {
    timeZone: i.timeZone,
    lat: i.lat,
    lon: i.lon,
    today,
    points,
    grid: i.grid,
    gfsByDate: new Map(i.gfs.map((g) => [g.date, g])),
    airNowByDate,
  };

  const days: DailyForecast[] = [];
  const slots = groupPeriods(i.periods, i.timeZone, today, i.now);
  if (slots.length > 0) {
    for (const slot of slots) {
      if (days.length >= max) break;
      days.push(nwsDay(slot, c));
    }
  } else {
    // No usable period forecast: derive days from the hourly/grid series.
    const dates = [...new Set(points.map((pt) => localDateOf(pt.ms, i.timeZone)))].filter((d) => d >= today).sort();
    for (const date of dates) {
      if (days.length >= max) break;
      const d = synthesizedDay(date, c);
      if (d) days.push(d);
    }
  }

  // Extended outlook: GFS days after the last NWS date, up to the limit.
  const lastDate = days.length > 0 ? days[days.length - 1].date : addDays(today, -1);
  for (const g of [...i.gfs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (days.length >= max) break;
    if (g.date > lastDate && g.date >= today) days.push(gfsDay(g, c));
  }
  return days;
}

