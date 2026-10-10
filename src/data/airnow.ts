/**
 * EPA AirNow (official AQI). Needs the user's free API key (Settings), passed in the API_KEY query
 * parameter. The key is never logged, cached, or put in an error message: errors use describeUrl()
 * (host + path only) and this module never formats a URL into text.
 *
 * AirNow retired its latitude/longitude observation and forecast services on 2026-09-30 (they now
 * answer HTTP 410). This module uses their replacements:
 *   - Current Observations by Latitude/Longitude or ZIP Code: /aq/observation/current/ziplatlong/
 *     (one NowCast record per pollutant from the closest monitor within 50 miles, camelCase fields:
 *     nowcastAQI, parameterName, aqiCategoryName, reportingAreaName, dateObserved, hourObserved "14:00",
 *     localTimeZone).
 *   - Current Forecasts by Reporting Area: /aq/forecast/current/ (looked up by latitude/longitude).
 * Field names are matched case-insensitively and both the new camelCase and the retired PascalCase
 * spellings are understood, so either shape reads.
 */
import { HttpError, describeFailure, fetchJson, isAbortError } from './http';
import { HOUR_MS, isoZ, zonedWallToMs } from './time';
import type { AirQualityDay, AirQualityNow } from './types';
import { aqiCategoryNumber } from './openMeteo';
import { arr, obj, str } from './util';

const AIRNOW_BASE = 'https://www.airnowapi.org/aq';

/** AirNow refused the key (HTTP 401/403 or an error body naming the key). */
export class AirNowKeyError extends Error {
  constructor() {
    super('AirNow rejected the API key');
    this.name = 'AirNowKeyError';
  }
}

/** AirNow answered with its own error message (a "WebServiceError" body) that isn't about the key. */
export class AirNowServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AirNowServiceError';
  }
}

export function currentUrl(lat: number, lon: number, key: string): string {
  return (
    `${AIRNOW_BASE}/observation/current/ziplatlong/?format=application/json` +
    `&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&API_KEY=${encodeURIComponent(key)}`
  );
}

export function forecastUrl(lat: number, lon: number, key: string): string {
  return (
    `${AIRNOW_BASE}/forecast/current/?format=application/json` +
    `&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&API_KEY=${encodeURIComponent(key)}`
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

/** The first of `names` present on `o` (compared case-insensitively), skipping null values. */
function field(o: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const want = name.toLowerCase();
    for (const k of Object.keys(o)) {
      if (k.toLowerCase() === want && o[k] !== null && o[k] !== undefined) return o[k];
    }
  }
  return undefined;
}

/** A finite number, also from a numeric string ("42"). */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 14, "14" or "14:00" -> 14. */
function hourOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < 24 ? v : null;
  const m = typeof v === 'string' ? /^\s*(\d{1,2})(?::\d{2})?\s*$/.exec(v) : null;
  const h = m ? Number(m[1]) : NaN;
  return h >= 0 && h < 24 ? h : null;
}

/** The new services spell ozone "OZONE"; the UI (and the retired services) use "O3". */
const POLLUTANTS: Record<string, string> = { OZONE: 'O3', O3: 'O3', 'PM2.5': 'PM2.5', PM25: 'PM2.5', PM10: 'PM10' };

function pollutantName(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return POLLUTANTS[s.toUpperCase().replace(/\s+/g, '')] ?? s;
}

const CATEGORY_NAMES = ['good', 'moderate', 'unhealthy for sensitive groups', 'unhealthy', 'very unhealthy', 'hazardous'];

/** EPA category number (1–6) from its name ("Unhealthy for Sensitive Groups" -> 3). */
function categoryFromName(v: unknown): number | null {
  const s = str(v)?.toLowerCase();
  const i = s ? CATEGORY_NAMES.indexOf(s) : -1;
  return i === -1 ? null : i + 1;
}

/** AirNow's text for an error body, without anything that looks like a key, kept short. */
function serviceMessage(errs: unknown): string {
  const parts: string[] = [];
  for (const e of arr(errs)) {
    const o = obj(e);
    const text = o ? str(field(o, 'Message', 'Error')) : str(e);
    if (text) parts.push(text);
  }
  const joined = (parts.join(' ') || 'AirNow reported an error')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return joined.length > 140 ? `${joined.slice(0, 139)}…` : joined;
}

/** AirNow error bodies look like {"WebServiceError":[{"Message":"Invalid API key"}]} (sometimes inside an array). */
function throwIfServiceError(json: unknown): void {
  const first = obj(arr(json)[0]) ?? obj(json);
  const errs = first ? field(first, 'WebServiceError') : undefined;
  if (errs === undefined) return;
  const text = JSON.stringify(errs).toLowerCase();
  if (text.includes('key') || text.includes('unauthorized') || text.includes('authenticat')) throw new AirNowKeyError();
  throw new AirNowServiceError(serviceMessage(errs));
}

function observedAtIso(
  dateObserved: unknown,
  hourObserved: unknown,
  zone: unknown,
  fallbackTz: string,
  fallbackIso: string,
): string {
  const date = typeof dateObserved === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateObserved.trim()) : null;
  const hour = hourOf(hourObserved);
  if (!date || hour === null) return fallbackIso;
  const offset = typeof zone === 'string' ? ZONE_OFFSET_HOURS[zone.trim().toUpperCase()] : undefined;
  if (offset !== undefined) {
    return isoZ(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), hour) - offset * HOUR_MS);
  }
  return isoZ(zonedWallToMs(`${date[1]}-${date[2]}-${date[3]}`, hour, 0, fallbackTz));
}

/**
 * Current observations -> overall AQI (the worst pollutant). A null or negative AQI means "unknown" and is
 * ignored. Returns null when no pollutant has a value (for example, no monitor within 50 miles).
 */
export function parseAirNowCurrent(json: unknown, fallbackTz: string, fallbackIso: string): AirQualityNow | null {
  throwIfServiceError(json);
  let worst: { aqi: number; entry: Record<string, unknown> } | null = null;
  for (const raw of arr(json)) {
    const entry = obj(raw);
    const aqi = entry ? num(field(entry, 'nowcastAQI', 'AQI')) : null;
    if (!entry || aqi === null || aqi < 0) continue;
    if (worst === null || aqi > worst.aqi) worst = { aqi, entry };
  }
  if (!worst) return null;
  const e = worst.entry;
  return {
    source: 'airnow',
    aqi: Math.round(worst.aqi),
    primaryPollutant: pollutantName(field(e, 'parameterName')),
    observedAt: observedAtIso(
      field(e, 'dateObserved'),
      field(e, 'hourObserved'),
      field(e, 'localTimeZone'),
      fallbackTz,
      fallbackIso,
    ),
    reportingArea: str(field(e, 'reportingAreaName', 'reportingArea')),
  };
}

/** Records that carry a forecast date, wherever they sit in the answer (a flat array, or nested lists). */
function forecastRecords(json: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const o = obj(v);
    if (!o) return;
    if (field(o, 'dateForecast', 'forecastDate') !== undefined) {
      out.push(o);
      return;
    }
    for (const value of Object.values(o)) if (typeof value === 'object' && value !== null) visit(value, depth + 1);
  };
  visit(json, 0);
  return out;
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
  for (const e of forecastRecords(json)) {
    const rawDate = field(e, 'dateForecast', 'forecastDate');
    const date = typeof rawDate === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(rawDate.trim())?.[0] : undefined;
    if (!date) continue;
    const aqiRaw = num(field(e, 'aqi', 'forecastAQI', 'aqiValue'));
    const aqi = aqiRaw !== null && aqiRaw >= 0 ? Math.round(aqiRaw) : null;
    const categoryObj = obj(field(e, 'category'));
    const category =
      num(categoryObj ? field(categoryObj, 'number') : undefined) ??
      num(field(e, 'aqiCategoryNumber', 'categoryNumber')) ??
      categoryFromName(field(e, 'aqiCategoryName', 'categoryName') ?? (categoryObj ? field(categoryObj, 'name') : undefined)) ??
      (aqi !== null ? aqiCategoryNumber(aqi) : null);
    if (aqi === null && category === null) continue;
    const list = byDate.get(date) ?? [];
    list.push({ aqi, category, pollutant: pollutantName(field(e, 'parameterName')), discussion: str(field(e, 'discussion')) });
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
  /** A short, key-free sentence when the official reading couldn't be loaded; the caller falls back to Open-Meteo. */
  problem: string | null;
}

function isKeyError(err: unknown): boolean {
  return err instanceof AirNowKeyError || (err instanceof HttpError && (err.status === 401 || err.status === 403));
}

/** AirNow's own words when it sent some, otherwise the usual sentence for the kind of failure. Never includes the key. */
export function describeAirNowFailure(err: unknown): string {
  if (err instanceof AirNowServiceError) return `AirNow: ${err.message}`;
  if (err instanceof HttpError && err.status === 410) {
    return 'AirNow has retired the service this app uses (HTTP 410), so the app needs an update.';
  }
  return describeFailure(err, 'AirNow');
}

/**
 * Current AQI plus AirNow's current forecast, fetched in parallel. Throws AirNowKeyError when the key is
 * rejected; any other failure comes back as `problem` with whatever did load. The forecast is a bonus
 * (Open-Meteo covers the days AirNow doesn't), so a forecast failure alone stays quiet.
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

  const [currentR, forecastR] = await Promise.allSettled([
    fetchJson<unknown>(currentUrl(lat, lon, key), opts).then((json) => parseAirNowCurrent(json, timeZone, isoZ(now))),
    fetchJson<unknown>(forecastUrl(lat, lon, key), opts).then(parseAirNowForecast),
  ]);

  for (const r of [currentR, forecastR]) if (r.status === 'rejected' && isAbortError(r.reason)) throw r.reason;
  for (const r of [currentR, forecastR]) if (r.status === 'rejected' && isKeyError(r.reason)) throw new AirNowKeyError();

  return {
    current: currentR.status === 'fulfilled' ? currentR.value : null,
    forecast: forecastR.status === 'fulfilled' ? forecastR.value.filter((d) => d.date >= today) : [],
    problem: currentR.status === 'rejected' ? describeAirNowFailure(currentR.reason) : null,
  };
}
