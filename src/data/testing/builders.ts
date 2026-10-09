/** Test builders for synthetic data-layer inputs (forecast periods, hourly points, GFS days). */
import { fToC } from '../../lib/units';
import type { GfsDay } from '../openMeteo';
import { HOUR_MS, addDays, isoZ, zonedWallToMs } from '../time';
import type { ForecastPeriod, HourlyPoint, Place, WeatherBundle } from '../types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export type StartKind = 'today' | 'afternoon' | 'tonight' | 'overnight';

interface Spec {
  name: string;
  date: string;
  startHour: number;
  isDaytime: boolean;
  /** Whole hours long. */
  hours: number;
}

/**
 * The 14 periods NWS issues, as it would at different times of day:
 *  today      Today, Tonight, Friday, Friday Night, ...
 *  afternoon  This Afternoon, Tonight, Friday, ...
 *  tonight    Tonight, Friday, Friday Night, ...
 *  overnight  Overnight (after midnight), Today, Tonight, ...
 * Day periods run 06:00-18:00 local, night periods 18:00-06:00. Day temperatures are 80, 81, ... °F by
 * period index, night temperatures 60, 61, ... °F, so tests can tell the periods apart.
 */
export function makePeriods(kind: StartKind, today: string, timeZone: string, count = 14): ForecastPeriod[] {
  const specs: Spec[] = [];
  const push = (s: Spec): void => {
    specs.push(s);
  };

  let date = today;
  if (kind === 'overnight') push({ name: 'Overnight', date, startHour: 2, isDaytime: false, hours: 4 });
  if (kind === 'afternoon') push({ name: 'This Afternoon', date, startHour: 14, isDaytime: true, hours: 4 });
  else if (kind !== 'tonight') push({ name: 'Today', date, startHour: 6, isDaytime: true, hours: 12 });
  push({ name: 'Tonight', date, startHour: kind === 'tonight' ? 21 : 18, isDaytime: false, hours: kind === 'tonight' ? 9 : 12 });
  while (specs.length < count) {
    date = addDays(date, 1);
    const weekday = weekdayOf(date);
    push({ name: weekday, date, startHour: 6, isDaytime: true, hours: 12 });
    push({ name: `${weekday} Night`, date, startHour: 18, isDaytime: false, hours: 12 });
  }

  let dayN = 0;
  let nightN = 0;
  return specs.slice(0, count).map((s) => {
    const start = zonedWallToMs(s.date, s.startHour, 0, timeZone);
    const tempF = s.isDaytime ? 80 + dayN++ : 60 + nightN++;
    return {
      name: s.name,
      startTime: isoZ(start),
      endTime: isoZ(start + s.hours * HOUR_MS),
      isDaytime: s.isDaytime,
      tempC: fToC(tempF),
      precipChancePct: s.isDaytime ? 10 : 30,
      windText: 'S 5 to 10 mph',
      shortForecast: s.isDaytime ? 'Sunny' : 'Clear',
      detailedForecast: `${s.name}: ${s.isDaytime ? 'Sunny' : 'Clear'}, around ${tempF}.`,
      icon: 'clear',
    };
  });
}

/** An HourlyPoint with every field null unless overridden. */
export function hourPoint(ms: number, over: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    time: isoZ(ms),
    isDaytime: true,
    icon: 'clear',
    shortForecast: 'Sunny',
    tempC: null,
    feelsLikeC: null,
    feelsLikeKind: 'actual',
    dewpointC: null,
    humidityPct: null,
    skyCoverPct: null,
    precipChancePct: null,
    precipMm: null,
    snowMm: null,
    thunderChancePct: null,
    windKph: null,
    windGustKph: null,
    windDirDeg: null,
    uvIndex: null,
    aqi: null,
    ...over,
  };
}

/** `count` consecutive hourly points starting at local `date` `hour`:00, with fields from `fields(i)`. */
export function hourRun(
  date: string,
  hour: number,
  count: number,
  timeZone: string,
  fields: (i: number, ms: number) => Partial<HourlyPoint>,
): HourlyPoint[] {
  const start = zonedWallToMs(date, hour, 0, timeZone);
  return Array.from({ length: count }, (_, i) => hourPoint(start + i * HOUR_MS, fields(i, start + i * HOUR_MS)));
}

/** GFS daily rows for `count` consecutive dates; values vary by index so tests can tell them apart. */
export function gfsDays(startDate: string, count: number): GfsDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: addDays(startDate, i),
    weatherCode: [0, 3, 61, 95, 71][i % 5],
    highC: 20 + i,
    lowC: 10 + i,
    feelsLikeHighC: 19 + i,
    feelsLikeLowC: 9 + i,
    precipChancePct: 5 * i,
    precipMm: i,
    snowMm: i === 4 ? 25 : 0,
    windKph: 20 + i,
    windGustKph: 35 + i,
    windDirDeg: 180,
    uvIndexMax: 5 - (i % 3),
  }));
}

/** A minimal but structurally valid WeatherBundle (what the cache and hook tests store and restore). */
export function makeBundle(
  place: { id: string; name?: string; lat: number; lon: number; kind?: Place['kind'] },
  fetchedAt = '2026-10-09T02:40:00.000Z',
): WeatherBundle {
  return {
    place: { id: place.id, name: place.name ?? place.id, lat: place.lat, lon: place.lon, kind: place.kind ?? 'saved' },
    point: {
      wfo: 'TOP',
      gridX: 32,
      gridY: 81,
      timeZone: 'America/Chicago',
      city: 'Linn',
      state: 'KS',
      radarStation: 'KTWX',
      forecastZone: null,
      county: null,
    },
    fetchedAt,
    forecastUpdatedAt: null,
    current: null,
    hourly: [],
    daily: [],
    sun: { sunrise: null, sunset: null, solarNoon: null, civilDawn: null, civilDusk: null, daylightMinutes: null },
    airNow: null,
    airForecast: [],
    alerts: [],
    problems: [],
  };
}
