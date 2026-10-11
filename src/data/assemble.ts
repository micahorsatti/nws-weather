/**
 * loadWeather: fetch every source and assemble a WeatherBundle.
 *
 * The NWS point lookup comes first (everything else needs its grid, zone and time zone); then all other
 * sources load in parallel. Individual failures become `problems` entries and the bundle is built from
 * whatever succeeded. Only a failed point lookup, or the forecast, hourly forecast and grid all being
 * unusable, is fatal.
 *
 * A slow optional source must not hold the whole screen hostage: once the forecast data and alerts are in,
 * the station observation, GFS days / UV and air quality get OPTIONAL_GRACE_MS more; if they are still out,
 * `onPartial` receives a bundle built without them (nothing is reported as a problem yet) and the returned
 * promise resolves with the complete bundle when they have all answered or failed.
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

/** How long the optional sources get, after the forecast data and alerts are in, before a first bundle is built without them. */
export const OPTIONAL_GRACE_MS = 3_000;

export interface LoadOptions {
  /** User's EPA AirNow key from settings; when absent, AQI comes from Open-Meteo. */
  airNowKey?: string;
  signal?: AbortSignal;
  /**
   * Called at most once, only when optional sources (station observation, GFS days and UV, air quality) are
   * still out OPTIONAL_GRACE_MS after the forecast arrived, with a bundle built from what has answered so far.
   * The promise returned by loadWeather still resolves with the complete bundle. Never called when everything
   * answers in time.
   */
  onPartial?: (bundle: WeatherBundle) => void;
}

type Settled<T> = PromiseSettledResult<T>;

/**
 * Outcome of every source request (the I/O half of loadWeather). For the optional sources, `null` means
 * "has not answered yet": it produces neither data nor a problem (for airNow it also means "no key, not asked").
 */
export interface SourceResults {
  forecast: Settled<NwsForecast>;
  hourly: Settled<NwsHourlyPeriod[]>;
  grid: Settled<ParsedGrid>;
  alerts: Settled<WeatherAlert[]>;
  observation: Settled<ParsedObservation | null> | null;
  gfs: Settled<GfsData> | null;
  air: Settled<OpenMeteoAir> | null;
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

  if (results.observation?.status === 'rejected') {
    problems.push({
      source: 'nws-observation',
      message: describeFailure(results.observation.reason, 'current station observations'),
    });
  }
  const observation = results.observation?.status === 'fulfilled' ? results.observation.value : null;

  let alerts: WeatherAlert[] = [];
  if (results.alerts.status === 'fulfilled') alerts = results.alerts.value;
  else problems.push({ source: 'nws-alerts', message: 'Weather alerts could not be checked right now.' });

  const gfs = results.gfs?.status === 'fulfilled' ? results.gfs.value : null;
  if (results.gfs?.status === 'rejected') {
    problems.push({ source: 'open-meteo-gfs', message: 'Days 8 to 10 of the outlook are unavailable.' });
    problems.push({ source: 'open-meteo-uv', message: 'The UV index forecast is unavailable.' });
  }

  const air = results.air?.status === 'fulfilled' ? results.air.value : null;
  if (results.air?.status === 'rejected') {
    problems.push({ source: 'open-meteo-aqi', message: 'The hourly air quality forecast is unavailable.' });
  }

  let airNowResult: AirNowResult | null = null;
  if (results.airNow) {
    if (results.airNow.status === 'fulfilled') {
      airNowResult = results.airNow.value;
      if (airNowResult.problem) problems.push({ source: 'airnow', message: airNowResult.problem });
    } else {
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

/** A request's outcome, filled in the moment it settles (null until then). */
interface Tracked<T> {
  result: Settled<T> | null;
  done: Promise<void>;
}

function track<T>(request: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = { result: null, done: Promise.resolve() };
  tracked.done = request.then(
    (value) => {
      tracked.result = { status: 'fulfilled', value };
    },
    (reason: unknown) => {
      tracked.result = { status: 'rejected', reason };
    },
  );
  return tracked;
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

  // Every request starts now, in this order; each outcome is recorded the moment it settles.
  const forecast = track(loadForecast(urls.forecast, signal));
  const hourly = track(loadHourlyForecast(urls.forecastHourly, signal));
  const grid = track(loadGrid(urls.forecastGrid, signal));
  const observation = track(loadCurrentObservation(urls.stations, now, signal));
  const alerts = track(loadAlerts(place.lat, place.lon, now, signal));
  const gfs = track(loadGfs(place.lat, place.lon, tz, signal));
  const air = track(loadOpenMeteoAir(place.lat, place.lon, tz, signal));
  // No key -> no AirNow request; a failed request is reported as a problem.
  const airNow = key
    ? track(loadAirNow({ lat: place.lat, lon: place.lon, key, today: localDateOf(now, tz), timeZone: tz, now, signal }))
    : null;

  const results = (): SourceResults => ({
    forecast: forecast.result as Settled<NwsForecast>,
    hourly: hourly.result as Settled<NwsHourlyPeriod[]>,
    grid: grid.result as Settled<ParsedGrid>,
    alerts: alerts.result as Settled<WeatherAlert[]>,
    observation: observation.result,
    gfs: gfs.result,
    air: air.result,
    airNow: airNow ? airNow.result : null,
  });

  // The forecast data and the alerts are the screen: wait for them.
  await Promise.all([forecast.done, hourly.done, grid.done, alerts.done]);
  throwIfAborted(signal);

  const optional = [observation, gfs, air, ...(airNow ? [airNow] : [])];
  const optionalDone = Promise.all(optional.map((t) => t.done));
  if (opts.onPartial && optional.some((t) => t.result === null)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const graceOver = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), OPTIONAL_GRACE_MS);
    });
    const allIn = await Promise.race([optionalDone.then(() => true as const), graceOver]);
    clearTimeout(timer);
    throwIfAborted(signal);
    if (!allIn) {
      try {
        opts.onPartial(assembleBundle(place, info, now, results()));
      } catch {
        // Nothing usable yet (the complete bundle below will say why), or the callback failed: the load goes on.
      }
    }
  }
  await optionalDone;
  throwIfAborted(signal);

  return assembleBundle(place, info, now, results());
}
