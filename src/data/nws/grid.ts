/**
 * api.weather.gov raw gridpoint data (forecastGridData): a time series per weather element, each
 * value valid for an ISO-8601 interval ("2026-10-08T17:00:00+00:00/PT6H"). Intervals vary in length
 * (1 hour up to days), so layers are converted to canonical units and expanded to hourly values:
 * state values (temperature, probabilities, wind...) repeat across their interval, accumulations
 * (precipitation, snowfall) are spread evenly over the hours they cover.
 */
import { BadResponseError, GEO_JSON, fetchJson } from '../http';
import { HOUR_MS, floorToHour, localDateOf, localHourOf, parseValidTime } from '../time';
import { arr, obj } from '../util';
import { convertUom, type Quantity } from './uom';

export type GridLayerName =
  | 'temperature'
  | 'dewpoint'
  | 'relativeHumidity'
  | 'apparentTemperature'
  | 'heatIndex'
  | 'windChill'
  | 'skyCover'
  | 'windDirection'
  | 'windSpeed'
  | 'windGust'
  | 'probabilityOfPrecipitation'
  | 'quantitativePrecipitation'
  | 'snowfallAmount'
  | 'probabilityOfThunder'
  | 'maxTemperature'
  | 'minTemperature';

type ExpandMode = 'state' | 'accumulation' | 'interval';

/** How each layer is converted (quantity) and expanded (mode). 'interval' layers are kept as intervals. */
export const GRID_LAYERS: Record<GridLayerName, { quantity: Quantity; mode: ExpandMode }> = {
  temperature: { quantity: 'temperature', mode: 'state' },
  dewpoint: { quantity: 'temperature', mode: 'state' },
  relativeHumidity: { quantity: 'percent', mode: 'state' },
  apparentTemperature: { quantity: 'temperature', mode: 'state' },
  heatIndex: { quantity: 'temperature', mode: 'state' },
  windChill: { quantity: 'temperature', mode: 'state' },
  skyCover: { quantity: 'percent', mode: 'state' },
  windDirection: { quantity: 'angle', mode: 'state' },
  windSpeed: { quantity: 'speed', mode: 'state' },
  windGust: { quantity: 'speed', mode: 'state' },
  probabilityOfPrecipitation: { quantity: 'percent', mode: 'state' },
  quantitativePrecipitation: { quantity: 'precip', mode: 'accumulation' },
  snowfallAmount: { quantity: 'precip', mode: 'accumulation' },
  probabilityOfThunder: { quantity: 'percent', mode: 'state' },
  maxTemperature: { quantity: 'temperature', mode: 'interval' },
  minTemperature: { quantity: 'temperature', mode: 'interval' },
};

export interface GridInterval {
  /** Epoch ms, inclusive. */
  start: number;
  /** Epoch ms, exclusive. */
  end: number;
  /** In the canonical unit for the layer's quantity. */
  value: number;
}

export interface ParsedGrid {
  updateTime: string | null;
  /** Layers that had at least one usable value, sorted by start time. */
  layers: Partial<Record<GridLayerName, GridInterval[]>>;
}

/** Convert one raw layer ({uom, values:[{validTime, value}]}) to canonical-unit intervals. */
export function parseGridLayer(raw: unknown, quantity: Quantity): GridInterval[] {
  const layer = obj(raw);
  if (!layer) return [];
  const out: GridInterval[] = [];
  for (const entry of arr(layer.values)) {
    const e = obj(entry);
    if (!e) continue;
    const span = parseValidTime(e.validTime);
    const value = convertUom(e.value, layer.uom, quantity);
    if (span && value !== null) out.push({ start: span.start, end: span.end, value });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Parse a gridpoint response. Throws BadResponseError when no layer has usable data. */
export function parseGrid(json: unknown): ParsedGrid {
  const props = obj(obj(json)?.properties);
  if (!props) throw new BadResponseError('NWS grid response had no properties');
  const layers: ParsedGrid['layers'] = {};
  let any = false;
  for (const name of Object.keys(GRID_LAYERS) as GridLayerName[]) {
    const intervals = parseGridLayer(props[name], GRID_LAYERS[name].quantity);
    if (intervals.length > 0) {
      layers[name] = intervals;
      any = true;
    }
  }
  if (!any) throw new BadResponseError('NWS grid response had no usable data');
  return { updateTime: typeof props.updateTime === 'string' ? props.updateTime : null, layers };
}

export async function loadGrid(url: string, signal?: AbortSignal): Promise<ParsedGrid> {
  return parseGrid(await fetchJson<unknown>(url, { signal, accept: GEO_JSON }));
}

/**
 * Expand intervals to a map keyed by the start of each hour (epoch ms).
 * 'accumulation' divides each interval's amount evenly across the hours it overlaps; later intervals win on overlap.
 */
export function expandToHours(intervals: GridInterval[], mode: 'state' | 'accumulation'): Map<number, number> {
  const out = new Map<number, number>();
  for (const iv of intervals) {
    const first = floorToHour(iv.start);
    const hours: number[] = [];
    for (let t = first; t < iv.end; t += HOUR_MS) hours.push(t);
    if (hours.length === 0) continue;
    const each = mode === 'accumulation' ? iv.value / hours.length : iv.value;
    for (const h of hours) out.set(h, each);
  }
  return out;
}

/** A parsed grid expanded to hourly values, with O(1) lookups by hour. */
export interface HourlyGrid {
  /** First hour (epoch ms) with temperature data (or any state data when there is no temperature layer). */
  startMs: number;
  /** End (exclusive) of that coverage: where "the end of grid data" is. */
  endMs: number;
  has(layer: GridLayerName): boolean;
  get(layer: GridLayerName, hourMs: number): number | null;
}

export function buildHourlyGrid(grid: ParsedGrid): HourlyGrid | null {
  const hourly = new Map<GridLayerName, Map<number, number>>();
  for (const name of Object.keys(GRID_LAYERS) as GridLayerName[]) {
    const mode = GRID_LAYERS[name].mode;
    const intervals = grid.layers[name];
    if (mode === 'interval' || !intervals) continue;
    hourly.set(name, expandToHours(intervals, mode));
  }

  // Coverage comes from temperature when present, else from the widest state layer.
  let coverage = hourly.get('temperature');
  if (!coverage || coverage.size === 0) {
    coverage = undefined;
    for (const [name, map] of hourly) {
      if (GRID_LAYERS[name].mode !== 'state') continue;
      if (!coverage || map.size > coverage.size) coverage = map;
    }
  }
  if (!coverage || coverage.size === 0) return null;

  let startMs = Infinity;
  let lastHour = -Infinity;
  for (const h of coverage.keys()) {
    if (h < startMs) startMs = h;
    if (h > lastHour) lastHour = h;
  }

  return {
    startMs,
    endMs: lastHour + HOUR_MS,
    has: (layer) => (hourly.get(layer)?.size ?? 0) > 0,
    get: (layer, hourMs) => hourly.get(layer)?.get(hourMs) ?? null,
  };
}

/**
 * NWS's forecast high for a local date: the maxTemperature interval that starts that morning/afternoon.
 * (The first interval may be partly in the past; the value is still the day's forecast high.)
 */
export function gridHighC(grid: ParsedGrid, date: string, tz: string): number | null {
  let best: number | null = null;
  for (const iv of grid.layers.maxTemperature ?? []) {
    if (localDateOf(iv.start, tz) === date && localHourOf(iv.start, tz) < 18) {
      if (best === null || iv.value > best) best = iv.value;
    }
  }
  return best;
}

/** NWS's forecast low for the night that starts on a local date (the minTemperature interval beginning that evening). */
export function gridLowC(grid: ParsedGrid, date: string, tz: string): number | null {
  let best: number | null = null;
  for (const iv of grid.layers.minTemperature ?? []) {
    if (localDateOf(iv.start, tz) === date && localHourOf(iv.start, tz) >= 12) {
      if (best === null || iv.value < best) best = iv.value;
    }
  }
  return best;
}
