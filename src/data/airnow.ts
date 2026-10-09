/**
 * EPA AirNow (official AQI). Needs the user's free API key (Settings), passed in the API_KEY query
 * parameter. The key is never logged, cached, or put in an error message: errors use describeUrl()
 * (host + path only) and this module never formats a URL into text.
 */
import { HttpError, fetchJson, isAbortError } from './http';
import { HOUR_MS, addDays, isoZ, zonedWallToMs } from './time';
import type { AirQualityDay, AirQualityNow } from './types';
import { aqiCategoryNumber } from './openMeteo';
import { arr, finite, obj, str } from './util';

const AIRNOW_BASE = 'https://www.airnowapi.org/aq';
/** Search radius (miles) for the nearest reporting area. */
const DISTANCE_MILES = 50;

/** AirNow refused the key (HTTP 401/403 or a "WebServiceError" naming the key). */
export class AirNowKeyError extends Error {
  constructor() {
    super('AirNow rejected the API key');
    this.name = 'AirNowKeyError';
  }
}

export function currentUrl(lat: number, lon: number, key: string): string {
  return (
    `${AIRNOW_BASE}/observation/latLong/current/?format=application/json` +
    `&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&distance=${DISTANCE_MILES}&API_KEY=${encodeURIComponent(key)}`
  );
}

export function forecastUrl(lat: number, lon: number, date: string, key: string): string {
  return (
    `${AIRNOW_BASE}/forecast/latLong/?format=application/json` +
    `&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&date=${date}&distance=${DISTANCE_MILES}&API_KEY=${encodeURIComponent(key)}`
  );
}

/** AirNow reports time in the named local zone (usually *standard* time): fixed UTC offsets in hours. */
const ZONE_OFFSET_HOURS: Record<string, number> = {
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  AKST: -9,
  AKDT: -8,
  HST: -10,
  HDT: -9,
  AST: -4,
  ADT: -3,
  SST: -11,
  CHST: 10,
  GMT: 0,
  UTC: 0,
};

/** AirNow error bodies look like [{"WebServiceError":[{"Error":"Invalid API_KEY"}]}]. */
function throwIfServiceError(json: unknown): void {
  const first = obj(arr(json)[0]) ?? obj(json);
  const errs = first?.WebServiceError;
  if (errs === undefined) return;
  const text = JSON.stringify(errs).toLowerCase();
  if (text.includes('key') || text.includes('unauthorized')) throw new AirNowKeyError();
  throw new Error('AirNow reported an error');
}

function observedAtIso(
  dateObserved: unknown,
  hourObserved: unknown,
  zone: unknown,
  fallbackTz: string,
  fallbackIso: string,
): string {
  const date = typeof dateObserved === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateObserved.trim()) : null;
  const hour = finite(hourObserved);
  if (!date || hour === null) return fallbackIso;
  const offset = typeof zone === 'string' ? ZONE_OFFSET_HOURS[zone.trim().toUpperCase()] : undefined;
  if (offset !== undefined) {
    return isoZ(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), hour) - offset * HOUR_MS);
  }
  return isoZ(zonedWallToMs(`${date[1]}-${date[2]}-${date[3]}`, hour, 0, fallbackTz));
}

/**
 * Current observations -> overall AQI (the worst pollutant). AQI -1 means "unknown" and is ignored.
 * Returns null when no pollutant has a value.
 */
export function parseAirNowCurrent(json: unknown, fallbackTz: string, fallbackIso: string): AirQualityNow | null {
  throwIfServiceError(json);
  let worst: { aqi: number; entry: Record<string, unknown> } | null = null;
  for (const raw of arr(json)) {
    const entry = obj(raw);
    const aqi = finite(entry?.AQI);
    if (!entry || aqi === null || aqi < 0) continue;
    if (worst === null || aqi > worst.aqi) worst = { aqi, entry };
  }
  if (!worst) return null;
  const e = worst.entry;
  return {
    source: 'airnow',
    aqi: Math.round(worst.aqi),
    primaryPollutant: str(e.ParameterName),
    observedAt: observedAtIso(e.DateObserved, e.HourObserved, e.LocalTimeZone, fallbackTz, fallbackIso),
    reportingArea: str(e.ReportingArea),
  };
}

interface ForecastEntry {
  aqi: number | null;
  category: number | null;
  pollutant: string | null;
  discussion: string | null;
}

/** Forecast entries (one per pollutant per date) -> one AirQualityDay per date, worst pollutant first. */
export function parseAirNowForecast(json: unknown): AirQualityDay[] {
  throwIfServiceError(json);
  const byDate = new Map<string, ForecastEntry[]>();
  for (const raw of arr(json)) {
    const e = obj(raw);
    const date = typeof e?.DateForecast === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(e.DateForecast.trim())?.[0] : undefined;
    if (!e || !date) continue;
    const aqiRaw = finite(e.AQI);
    const aqi = aqiRaw !== null && aqiRaw >= 0 ? Math.round(aqiRaw) : null;
    const category = finite(obj(e.Category)?.Number) ?? (aqi !== null ? aqiCategoryNumber(aqi) : null);
    if (aqi === null && category === null) continue;
    const list = byDate.get(date) ?? [];
    list.push({ aqi, category, pollutant: str(e.ParameterName), discussion: str(e.Discussion) });
    byDate.set(date, list);
  }

  const days: AirQualityDay[] = [];
  for (const [date, entries] of byDate) {
    const worst = [...entries].sort(
      (a, b) => (b.category ?? 0) - (a.category ?? 0) || (b.aqi ?? -1) - (a.aqi ?? -1),
    )[0];
    days.push({
      date,
      aqi: worst.aqi,
      categoryNumber: worst.category,
      primaryPollutant: worst.pollutant,
      discussion: entries.map((e) => e.discussion).find((d) => d !== null) ?? null,
      source: 'airnow',
    });
  }
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface AirNowResult {
  current: AirQualityNow | null;
  forecast: AirQualityDay[];
}

function asKeyError(err: unknown): unknown {
  return err instanceof HttpError && (err.status === 401 || err.status === 403) ? new AirNowKeyError() : err;
}

/**
 * Current AQI plus today/tomorrow/day-after forecasts. Throws AirNowKeyError when the key is
 * rejected, and the underlying error when nothing at all could be loaded; partial results are returned
 * quietly (the caller falls back to Open-Meteo for whatever is missing).
 */
export async function loadAirNow(args: {
  lat: number;
  lon: number;
  key: string;
  /** Today's local date ('YYYY-MM-DD') at the place. */
  today: string;
  timeZone: string;
  now: number;
  signal?: AbortSignal;
}): Promise<AirNowResult> {
  const { lat, lon, key, today, timeZone, now, signal } = args;
  const opts = { signal, attempts: 2, timeoutMs: 10_000 };
  const dates = [today, addDays(today, 1), addDays(today, 2)];

  const [currentR, ...forecastRs] = await Promise.allSettled([
    fetchJson<unknown>(currentUrl(lat, lon, key), opts),
    ...dates.map((d) => fetchJson<unknown>(forecastUrl(lat, lon, d, key), opts)),
  ]);

  const failures = [currentR, ...forecastRs].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const f of failures) if (isAbortError(f.reason)) throw f.reason;
  for (const f of failures) if (asKeyError(f.reason) instanceof AirNowKeyError) throw new AirNowKeyError();
  if (failures.length === 4) throw failures[0].reason;

  let current: AirQualityNow | null = null;
  if (currentR.status === 'fulfilled') {
    current = parseAirNowCurrent(currentR.value, timeZone, isoZ(now));
  }

  const byDate = new Map<string, AirQualityDay>();
  for (const r of forecastRs) {
    if (r.status !== 'fulfilled') continue;
    for (const day of parseAirNowForecast(r.value)) {
      // The same date can appear in several responses; keep the most informative (numeric AQI wins).
      const prev = byDate.get(day.date);
      if (!prev || (prev.aqi === null && day.aqi !== null)) byDate.set(day.date, day);
    }
  }
  const forecast = [...byDate.values()].filter((d) => d.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { current, forecast };
}
