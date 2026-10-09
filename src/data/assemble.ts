/**
 * loadWeather: fetch every source and assemble a WeatherBundle.
 *
 * The NWS point lookup comes first (everything else needs its grid, zone and time zone); then all other
 * sources load in parallel. Individual failures become `problems` entries and the bundle is built from
 * whatever succeeded. Only a failed point lookup, or the forecast, hourly forecast and grid all being
 * unusable, is fatal.
 */
import { AirNowKeyError, loadAirNow, type AirNowResult } from './airnow';
import { currentFromHour, currentFromObservation } from './current';
import { buildDaily } from './daily';
import { buildHourlySeries } from './hourly';
import { classifyError, describeFailure, isAbortError, throwIfAborted, toLoadError } from './http';
import { loadAlerts } from './nws/alerts';
import { loadForecast, loadHourlyForecast, type NwsForecast, type NwsHourlyPeriod } from './nws/forecast';
import { buildHourlyGrid, loadGrid, type ParsedGrid } from './nws/grid';
import { loadCurrentObservation, type ParsedObservation } from './nws/observations';
import { loadPoint } from './nws/points';
import {
  currentAirFromOpenMeteo,
  dailyAirFromOpenMeteo,
  hourlyAqiMap,
  loadGfs,
  loadOpenMeteoAir,
  type GfsData,
  type OpenMeteoAir,
} from './openMeteo';
import { sunTimesForDate } from './sun';
import { HOUR_MS, floorToHour, localDateOf, parseTime } from './time';
import {
  WeatherLoadError,
  type AirQualityDay,
  type HourlyPoint,
  type Place,
  type PointInfo,
  type SourceProblem,
  type WeatherAlert,
  type WeatherBundle,
} from './types';

export interface LoadOptions {
  /** User's EPA AirNow key from settings; when absent, AQI comes from Open-Meteo. */
  airNowKey?: string;
  signal?: AbortSignal;
}

type Settled<T> = PromiseSettledResult<T>;

/** Outcome of every source request (the I/O half of loadWeather). */
export interface SourceResults {
  forecast: Settled<NwsForecast>;
  hourly: Settled<NwsHourlyPeriod[]>;
  grid: Settled<ParsedGrid>;
  observation: Settled<ParsedObservation | null>;
  alerts: Settled<WeatherAlert[]>;
  gfs: Settled<GfsData>;
  air: Settled<OpenMeteoAir>;
  /** null when no AirNow key was supplied. */
  airNow: Settled<AirNowResult> | null;
}

/** AirNow's official days take priority; Open-Meteo fills the dates AirNow doesn't forecast. */
export function mergeAirForecast(airNow: AirQualityDay[], openMeteo: AirQualityDay[]): AirQualityDay[] {
  const byDate = new Map<string, AirQualityDay>();
  for (const d of openMeteo) byDate.set(d.date, d);
  for (const d of airNow) byDate.set(d.date, d);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function fatalError(reasons: unknown[]): WeatherLoadError {
  // A server-side failure anywhere means NWS is the problem; otherwise report the first failure's kind.
  const err = reasons.find((r) => classifyError(r) === 'server') ?? reasons[0];
  return toLoadError(err);
}

/**
 * Pure assembly: turn settled source results into a bundle, recording non-fatal failures in `problems`.
 * Throws WeatherLoadError when nothing usable came back.
 */
export function assembleBundle(place: Place, point: PointInfo, now: number, results: SourceResults): WeatherBundle {
  const tz = point.timeZone;
  const today = localDateOf(now, tz);
  const problems: SourceProblem[] = [];

  const forecast = results.forecast.status === 'fulfilled' ? results.forecast.value : null;
  const nwsHourly = results.hourly.status === 'fulfilled' ? results.hourly.value : null;
  const parsedGrid = results.grid.status === 'fulfilled' ? results.grid.value : null;

  // A grid that ends before now (NWS occasionally serves stale grid data) is no better than a failed one.
  const hourlyGrid = parsedGrid ? buildHourlyGrid(parsedGrid) : null;
  const gridUsable = hourlyGrid !== null && hourlyGrid.endMs > now;
  const grid = gridUsable ? hourlyGrid : null;
  const gridForDaily = gridUsable ? parsedGrid : null;

  if (!forecast && !nwsHourly && !grid) {
    const reasons = [results.forecast, results.hourly, results.grid]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);
    throw reasons.length > 0
      ? fatalError(reasons)
      : new WeatherLoadError('nws-unavailable', 'The National Weather Service returned no usable forecast data.');
  }

  if (results.forecast.status === 'rejected') {
    problems.push({ source: 'nws-forecast', message: describeFailure(results.forecast.reason, 'the NWS written forecast') });
  }
  if (results.hourly.status === 'rejected') {
    problems.push({ source: 'nws-hourly', message: describeFailure(results.hourly.reason, 'the NWS hourly forecast') });
  }
  if (results.grid.status === 'rejected') {
    problems.push({ source: 'nws-grid', message: describeFailure(results.grid.reason, 'the NWS detailed forecast data') });
  } else if (!gridUsable) {
    problems.push({ source: 'nws-grid', message: 'NWS detailed forecast data is out of date.' });
  }

  if (results.observation.status === 'rejected') {
    problems.push({
      source: 'nws-observation',
      message: describeFailure(results.observation.reason, 'current station observations'),
    });
  }
  const observation = results.observation.status === 'fulfilled' ? results.observation.value : null;

  let alerts: WeatherAlert[] = [];
  if (results.alerts.status === 'fulfilled') alerts = results.alerts.value;
  else problems.push({ source: 'nws-alerts', message: 'Weather alerts could not be checked right now.' });

  const gfs = results.gfs.status === 'fulfilled' ? results.gfs.value : null;
  if (!gfs) {
    problems.push({ source: 'open-meteo-gfs', message: 'Days 8 to 10 of the outlook are unavailable.' });
    problems.push({ source: 'open-meteo-uv', message: 'The UV index forecast is unavailable.' });
  }

  const air = results.air.status === 'fulfilled' ? results.air.value : null;
  if (!air) problems.push({ source: 'open-meteo-aqi', message: 'The hourly air quality forecast is unavailable.' });

  let airNowResult: AirNowResult | null = null;
  if (results.airNow) {
    if (results.airNow.status === 'fulfilled') airNowResult = results.airNow.value;
    else {
      const reason = results.airNow.reason as unknown;
      problems.push({
        source: 'airnow',
        message: reason instanceof AirNowKeyError ? 'AirNow rejected the API key' : describeFailure(reason, 'AirNow'),
      });
    }
  }

  const airNow = airNowResult?.current ?? (air ? currentAirFromOpenMeteo(air, now) : null);
  const airForecast = mergeAirForecast(
    airNowResult?.forecast ?? [],
    air ? dailyAirFromOpenMeteo(air, tz, today) : [],
  );

  const series: HourlyPoint[] = buildHourlySeries({
    now,
    timeZone: tz,
    lat: place.lat,
    lon: place.lon,
    grid,
    nwsHourly,
    periods: forecast?.periods ?? null,
    uvByHour: gfs?.uvByHour ?? null,
    aqiByHour: air ? hourlyAqiMap(air) : null,
  });
  const thisHour = floorToHour(now);
  const hourly = series.filter((p) => (parseTime(p.time) ?? 0) >= thisHour);

  const daily = buildDaily({
    now,
    timeZone: tz,
    lat: place.lat,
    lon: place.lon,
    periods: forecast?.periods ?? [],
    series,
    grid: gridForDaily,
    gfs: gfs?.days ?? [],
    airForecast,
  });

  // The hour that contains "now" (or, if the series starts a little later, the first one within 2 hours).
  const first = hourly[0];
  const hourNow = first && (parseTime(first.time) ?? Infinity) - thisHour <= 2 * HOUR_MS ? first : null;
  const current = observation
    ? currentFromObservation(observation, place, hourNow)
    : hourNow
      ? currentFromHour(hourNow)
      : null;

  return {
    place,
    point,
    fetchedAt: new Date().toISOString(),
    forecastUpdatedAt: forecast?.updatedAt ?? null,
    current,
    hourly,
    daily,
    sun: sunTimesForDate(today, tz, place.lat, place.lon),
    airNow,
    airForecast,
    alerts,
    problems,
  };
}

/**
 * Fetch every source for a place and assemble a WeatherBundle.
 * Throws WeatherLoadError ('out-of-coverage' | 'network' | 'nws-unavailable' | 'unknown') when nothing
 * usable comes back, and an AbortError when `opts.signal` aborts.
 */
export async function loadWeather(place: Place, opts: LoadOptions = {}): Promise<WeatherBundle> {
  const { signal } = opts;
  throwIfAborted(signal);
  const now = Date.now();

  let nwsPoint;
  try {
    nwsPoint = await loadPoint(place.lat, place.lon, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw toLoadError(err);
  }
  const { info, urls } = nwsPoint;
  const tz = info.timeZone;
  const key = opts.airNowKey?.trim();

  const [forecast, hourly, grid, observation, alerts, gfs, air, airNow] = await Promise.allSettled([
    loadForecast(urls.forecast, signal),
    loadHourlyForecast(urls.forecastHourly, signal),
    loadGrid(urls.forecastGrid, signal),
    loadCurrentObservation(urls.stations, now, signal),
    loadAlerts(place.lat, place.lon, now, signal),
    loadGfs(place.lat, place.lon, tz, signal),
    loadOpenMeteoAir(place.lat, place.lon, tz, signal),
    key
      ? loadAirNow({ lat: place.lat, lon: place.lon, key, today: localDateOf(now, tz), timeZone: tz, now, signal })
      : Promise.resolve(null),
  ]);
  throwIfAborted(signal);

  return assembleBundle(place, info, now, {
    forecast,
    hourly,
    grid,
    observation,
    alerts,
    gfs,
    air,
    // No key -> no AirNow request; a rejected request is reported as a problem.
    airNow: key ? (airNow as Settled<AirNowResult>) : null,
  });
}
