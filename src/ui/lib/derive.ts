/**
 * View-model helpers that turn a WeatherBundle into what the screens show *right now*.
 * Cached bundles can be hours old, so everything is filtered against the current time at render time.
 */
import type {
  CurrentConditions,
  DailyForecast,
  FeelsLikeKind,
  HourlyPoint,
  WeatherAlert,
  WeatherBundle,
  WxIcon,
} from '../../data/types';
import { HOUR_MS, localDateKey, parseTime } from './time';

/** A station report older than this is replaced by the forecast hour for "now" (matches the data layer). */
export const STALE_OBSERVATION_MS = 90 * 60_000;

/** Hours that have not finished yet: the first one is "now". */
export function futureHours(hourly: readonly HourlyPoint[], now: number): HourlyPoint[] {
  return hourly.filter((h) => {
    const t = parseTime(h.time);
    return t !== null && t + HOUR_MS > now;
  });
}

export interface CurrentView {
  source: 'observation' | 'forecast';
  observedAt: string | null;
  stationName: string | null;
  description: string;
  icon: WxIcon;
  isDaytime: boolean;
  tempC: number | null;
  feelsLikeC: number | null;
  feelsLikeKind: FeelsLikeKind;
  dewpointC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  pressurePa: number | null;
  visibilityM: number | null;
}

function fromHour(h: HourlyPoint): CurrentView {
  return {
    source: 'forecast',
    observedAt: h.time,
    stationName: null,
    description: h.shortForecast,
    icon: h.icon,
    isDaytime: h.isDaytime,
    tempC: h.tempC,
    feelsLikeC: h.feelsLikeC,
    feelsLikeKind: h.feelsLikeKind,
    dewpointC: h.dewpointC,
    humidityPct: h.humidityPct,
    windKph: h.windKph,
    windGustKph: h.windGustKph,
    windDirDeg: h.windDirDeg,
    pressurePa: null,
    visibilityM: null,
  };
}

function fromObservation(c: CurrentConditions): CurrentView {
  return { ...c, observedAt: c.observedAt, stationName: c.stationName };
}

/**
 * The "current conditions" to show: the station observation when it is recent, otherwise the forecast
 * for the current hour (so a cached bundle never presents a stale reading as current).
 */
export function currentView(bundle: WeatherBundle, now: number, hours: readonly HourlyPoint[]): CurrentView | null {
  const c = bundle.current;
  if (c) {
    const at = parseTime(c.observedAt);
    const stale = c.source === 'observation' && at !== null && now - at > STALE_OBSERVATION_MS;
    if (!stale || hours.length === 0) return fromObservation(c);
  }
  return hours.length > 0 ? fromHour(hours[0]) : null;
}

/** Alerts that have not ended yet (a cached bundle can hold alerts that expired while it sat on disk). */
export function activeAlerts(alerts: readonly WeatherAlert[], now: number): WeatherAlert[] {
  return alerts.filter((a) => {
    const end = parseTime(a.ends ?? a.expires);
    return end === null || end > now;
  });
}

/** Daily rows from today on, in the location's time zone. */
export function upcomingDays(daily: readonly DailyForecast[], now: number, tz: string): DailyForecast[] {
  const today = localDateKey(now, tz);
  return daily.filter((d) => d.date >= today);
}

export function todayEntry(daily: readonly DailyForecast[], now: number, tz: string): DailyForecast | null {
  const today = localDateKey(now, tz);
  return daily.find((d) => d.date === today) ?? null;
}

export interface SunView {
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number | null;
  daylightMinutes: number | null;
}

/** Today's sunrise/sunset: from the matching daily row when present, else the bundle's sun block. */
export function sunView(bundle: WeatherBundle, now: number, tz: string): SunView {
  const day = todayEntry(bundle.daily, now, tz);
  let sunrise = parseTime(day?.sunrise);
  let sunset = parseTime(day?.sunset);
  let daylightMinutes: number | null = bundle.sun.daylightMinutes;
  if (sunrise === null && sunset === null) {
    // Only trust the bundle's sun block if it describes today (a stale cache describes another day).
    const bundleSunrise = parseTime(bundle.sun.sunrise);
    const bundleSunset = parseTime(bundle.sun.sunset);
    const ref = bundleSunrise ?? bundleSunset;
    if (ref !== null && localDateKey(ref, tz) === localDateKey(now, tz)) {
      sunrise = bundleSunrise;
      sunset = bundleSunset;
    } else {
      daylightMinutes = null;
    }
  }
  // bundle.sun.solarNoon may describe a stale day, so derive it from the times we are actually using.
  let solarNoon: number | null = null;
  if (sunrise !== null && sunset !== null) {
    daylightMinutes = Math.round((sunset - sunrise) / 60_000);
    solarNoon = Math.round((sunrise + sunset) / 2);
  }
  return { sunrise, sunset, solarNoon, daylightMinutes };
}

/** Largest value of a nullable series, or null when there is none. */
export function maxOf(values: Iterable<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

export function minOf(values: Iterable<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && (best === null || v < best)) best = v;
  }
  return best;
}
