/** api.weather.gov /points: which forecast office/grid covers a location, plus its time zone. */
import { loadCachedPoint, POINT_TTL_MS, saveCachedPoint } from '../cache';
import { BadResponseError, GEO_JSON, HttpError, fetchJson, isAbortError } from '../http';
import { WeatherLoadError, type PointInfo } from '../types';
import { finite, obj, str } from '../util';

export const NWS_BASE = 'https://api.weather.gov';

/** PointInfo plus the endpoint URLs the loaders need (not part of the UI contract). */
export interface NwsPoint {
  info: PointInfo;
  urls: {
    forecast: string;
    forecastHourly: string;
    forecastGrid: string;
    stations: string;
  };
}

/** "lat,lon" with the 4-decimal precision /points accepts without redirecting. */
export function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Validate and normalise a /points response. Throws BadResponseError when essentials are missing. */
export function parsePoint(json: unknown): NwsPoint {
  const props = obj(obj(json)?.properties);
  if (!props) throw new BadResponseError('NWS point response had no properties');

  const wfo = str(props.gridId);
  const gridX = finite(props.gridX);
  const gridY = finite(props.gridY);
  const timeZone = str(props.timeZone);
  if (!wfo || gridX === null || gridY === null || !timeZone) {
    throw new BadResponseError('NWS point response was missing grid or time zone information');
  }

  const rel = obj(obj(props.relativeLocation)?.properties);
  const base = `${NWS_BASE}/gridpoints/${wfo}/${gridX},${gridY}`;
  return {
    info: {
      wfo,
      gridX,
      gridY,
      timeZone,
      city: str(rel?.city) ?? '',
      state: str(rel?.state) ?? '',
      radarStation: str(props.radarStation),
      forecastZone: str(props.forecastZone),
      county: str(props.county),
    },
    urls: {
      forecast: str(props.forecast) ?? `${base}/forecast`,
      forecastHourly: str(props.forecastHourly) ?? `${base}/forecast/hourly`,
      forecastGrid: str(props.forecastGridData) ?? base,
      stations: str(props.observationStations) ?? `${base}/stations`,
    },
  };
}

/**
 * Point metadata for a location. Cached on the device for ~7 days; if the network fails and an
 * older copy exists it is used rather than failing the whole load. A 404 means NWS doesn't cover
 * the location (outside the US and its territories) and becomes WeatherLoadError('out-of-coverage').
 */
export async function loadPoint(lat: number, lon: number, signal?: AbortSignal): Promise<NwsPoint> {
  const key = pointKey(lat, lon);
  const cached = loadCachedPoint(key);
  if (cached && Date.now() - cached.savedAt < POINT_TTL_MS) return cached.point;

  try {
    const json = await fetchJson<unknown>(`${NWS_BASE}/points/${key}`, { signal, accept: GEO_JSON });
    const point = parsePoint(json);
    saveCachedPoint(key, point);
    return point;
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (cached) return cached.point;
    if (err instanceof HttpError && err.status === 404) {
      throw new WeatherLoadError(
        'out-of-coverage',
        'The National Weather Service only covers the United States and its territories. Pick a location there.',
      );
    }
    throw err;
  }
}
