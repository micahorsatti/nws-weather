/**
 * api.weather.gov forecast products for a grid point:
 *  - /forecast         12-hour day/night periods with the forecasters' written text (7 days)
 *  - /forecast/hourly  one entry per hour (~6.5 days) with icon, short text and basic numbers
 * US units are kept in the request (so the forecaster text reads naturally); numbers are converted here.
 */
import { fToC, mphToKph, knotsToKph, msToKph } from '../../lib/units';
import { BadResponseError, GEO_JSON, fetchJson } from '../http';
import { resolveIcon } from '../icons';
import { parseTime } from '../time';
import type { ForecastPeriod, WxIcon } from '../types';
import { arr, bool, compassToDeg, finite, obj, str } from '../util';
import { convertUom } from './uom';

export interface NwsForecast {
  /** properties.updateTime: when NWS last updated the forecast. */
  updatedAt: string | null;
  periods: ForecastPeriod[];
}

export interface NwsHourlyPeriod {
  startMs: number;
  endMs: number;
  isDaytime: boolean;
  tempC: number | null;
  precipChancePct: number | null;
  dewpointC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  windDirDeg: number | null;
  icon: WxIcon;
  shortForecast: string;
}

/** Temperature value + unit letter ("F" default) -> °C. */
function tempToC(value: unknown, unit: unknown): number | null {
  const v = finite(value);
  if (v === null) return null;
  return typeof unit === 'string' && unit.toUpperCase() === 'C' ? v : fToC(v);
}

/**
 * Wind speed text -> km/h. Ranges ("5 to 10 mph") give the upper bound; "Calm" is 0. Units default to mph.
 */
export function parseWindSpeedKph(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const t = text.toLowerCase();
  const numbers = t.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return /calm/.test(t) ? 0 : null;
  const top = Math.max(...numbers.map(Number));
  if (/km\/?h/.test(t)) return top;
  if (/m\/s/.test(t)) return msToKph(top);
  if (/\bkt|knot/.test(t)) return knotsToKph(top);
  return mphToKph(top);
}

function parsePeriod(raw: unknown): ForecastPeriod | null {
  const o = obj(raw);
  if (!o) return null;
  const startTime = str(o.startTime);
  const endTime = str(o.endTime);
  if (!startTime || !endTime || parseTime(startTime) === null || parseTime(endTime) === null) return null;

  const shortForecast = str(o.shortForecast) ?? '';
  const resolved = resolveIcon({ url: o.icon, text: shortForecast });
  const wind = [str(o.windDirection), str(o.windSpeed)].filter((s): s is string => s !== null).join(' ');
  return {
    name: str(o.name) ?? '',
    startTime,
    endTime,
    isDaytime: bool(o.isDaytime) ?? resolved.isDaytime ?? true,
    tempC: tempToC(o.temperature, o.temperatureUnit),
    precipChancePct: finite(obj(o.probabilityOfPrecipitation)?.value),
    windText: wind,
    shortForecast,
    detailedForecast: str(o.detailedForecast) ?? '',
    icon: resolved.icon,
  };
}

/** Parse a /forecast response into periods (chronological). Throws BadResponseError if there are none. */
export function parseForecast(json: unknown): NwsForecast {
  const props = obj(obj(json)?.properties);
  if (!props) throw new BadResponseError('NWS forecast response had no properties');
  const periods = arr(props.periods)
    .map(parsePeriod)
    .filter((p): p is ForecastPeriod => p !== null)
    .sort((a, b) => (parseTime(a.startTime) ?? 0) - (parseTime(b.startTime) ?? 0));
  if (periods.length === 0) throw new BadResponseError('NWS forecast response had no periods');
  return { updatedAt: str(props.updateTime) ?? str(props.generatedAt), periods };
}

export async function loadForecast(url: string, signal?: AbortSignal): Promise<NwsForecast> {
  return parseForecast(await fetchJson<unknown>(url, { signal, accept: GEO_JSON }));
}

function parseHourlyPeriod(raw: unknown): NwsHourlyPeriod | null {
  const o = obj(raw);
  if (!o) return null;
  const startMs = parseTime(o.startTime);
  if (startMs === null) return null;
  const endMs = parseTime(o.endTime) ?? startMs + 3_600_000;

  const shortForecast = str(o.shortForecast) ?? '';
  const resolved = resolveIcon({ url: o.icon, text: shortForecast });
  const dewpoint = obj(o.dewpoint);
  const humidity = obj(o.relativeHumidity);
  return {
    startMs,
    endMs,
    isDaytime: bool(o.isDaytime) ?? resolved.isDaytime ?? true,
    tempC: tempToC(o.temperature, o.temperatureUnit),
    precipChancePct: finite(obj(o.probabilityOfPrecipitation)?.value),
    dewpointC: convertUom(dewpoint?.value, dewpoint?.unitCode, 'temperature'),
    humidityPct: convertUom(humidity?.value, humidity?.unitCode, 'percent'),
    windKph: parseWindSpeedKph(o.windSpeed),
    windDirDeg: compassToDeg(o.windDirection),
    icon: resolved.icon,
    shortForecast,
  };
}

/** Parse a /forecast/hourly response (chronological). Throws BadResponseError if there are no hours. */
export function parseHourlyForecast(json: unknown): NwsHourlyPeriod[] {
  const props = obj(obj(json)?.properties);
  if (!props) throw new BadResponseError('NWS hourly forecast response had no properties');
  const periods = arr(props.periods)
    .map(parseHourlyPeriod)
    .filter((p): p is NwsHourlyPeriod => p !== null)
    .sort((a, b) => a.startMs - b.startMs);
  if (periods.length === 0) throw new BadResponseError('NWS hourly forecast response had no periods');
  return periods;
}

export async function loadHourlyForecast(url: string, signal?: AbortSignal): Promise<NwsHourlyPeriod[]> {
  return parseHourlyForecast(await fetchJson<unknown>(url, { signal, accept: GEO_JSON }));
}

