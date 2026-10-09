/** NWS Area Forecast Discussion (AFD): the forecasters' technical write-up for a forecast office. */
import { GEO_JSON, HttpError, fetchJson, isAbortError, toLoadError } from '../http';
import { WeatherLoadError, type ForecastDiscussion } from '../types';
import { arr, obj, str } from '../util';
import { NWS_BASE } from './points';

/** Human-readable page for a forecast office's AFD. */
export function discussionUrl(wfo: string): string {
  return `https://forecast.weather.gov/product.php?site=NWS&issuedby=${encodeURIComponent(wfo)}&product=AFD`;
}

/** Id of the newest AFD in a /products/types/AFD/locations/{wfo} response. */
export function newestProductId(json: unknown): string | null {
  const first = obj(arr(obj(json)?.['@graph'])[0]);
  return str(first?.id);
}

export function parseDiscussion(wfo: string, json: unknown): ForecastDiscussion | null {
  const p = obj(json);
  const text = typeof p?.productText === 'string' ? p.productText.trim() : '';
  const issuedAt = str(p?.issuanceTime);
  if (!p || text === '' || !issuedAt) return null;
  return { wfo, issuedAt, text, url: discussionUrl(wfo) };
}

/** Latest AFD for a forecast office code such as "TOP". Throws WeatherLoadError on failure. */
export async function loadForecastDiscussion(wfo: string, signal?: AbortSignal): Promise<ForecastDiscussion> {
  const office = wfo.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(office)) {
    throw new WeatherLoadError('unknown', `"${wfo}" is not a forecast office code.`);
  }
  const opts = { signal, accept: GEO_JSON };
  try {
    const list = await fetchJson<unknown>(`${NWS_BASE}/products/types/AFD/locations/${office}`, opts);
    const id = newestProductId(list);
    if (!id) throw new WeatherLoadError('unknown', `The ${office} forecast office has no forecast discussion right now.`);
    const product = await fetchJson<unknown>(`${NWS_BASE}/products/${encodeURIComponent(id)}`, opts);
    const discussion = parseDiscussion(office, product);
    if (!discussion) throw new WeatherLoadError('unknown', `The ${office} forecast discussion could not be read.`);
    return discussion;
  } catch (err) {
    if (isAbortError(err) || err instanceof WeatherLoadError) throw err;
    if (err instanceof HttpError && err.status === 404) {
      throw new WeatherLoadError('unknown', `The ${office} forecast office has no forecast discussion.`);
    }
    throw toLoadError(err);
  }
}
