/**
 * Latest station observations. Stations come nearest-first; reports are often partly null or stale,
 * so the nearest few are tried until one has a recent air temperature.
 */
import { GEO_JSON, fetchJson, isAbortError } from '../http';
import { MINUTE_MS, parseTime } from '../time';
import { arr, obj, str } from '../util';
import { NWS_BASE } from './points';
import { convertUom, type Quantity } from './uom';

/** An observation older than this is not "current conditions". */
export const OBSERVATION_MAX_AGE_MS = 90 * MINUTE_MS;
/** How many of the nearest stations to try. */
export const MAX_STATIONS_TRIED = 3;

export interface StationRef {
  id: string;
  name: string | null;
}

export interface ParsedObservation {
  stationId: string | null;
  stationName: string | null;
  observedAtMs: number;
  /** textDescription, e.g. "Partly Cloudy". */
  description: string | null;
  /** The observation's icon URL (null for many stations). */
  iconUrl: string | null;
  tempC: number | null;
  dewpointC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  pressurePa: number | null;
  visibilityM: number | null;
  /** As reported by the station feed; only meaningful when the heat-index rule applies. */
  heatIndexC: number | null;
  /** As reported by the station feed; only meaningful when the wind-chill rule applies. */
  windChillC: number | null;
}

export function parseStations(json: unknown): StationRef[] {
  const out: StationRef[] = [];
  for (const f of arr(obj(json)?.features)) {
    const props = obj(obj(f)?.properties);
    const id = str(props?.stationIdentifier);
    if (id) out.push({ id, name: str(props?.name) });
  }
  return out;
}

/** A {value, unitCode, qualityControl} field in canonical units; QC-rejected values count as missing. */
function field(raw: unknown, quantity: Quantity): number | null {
  const f = obj(raw);
  if (!f) return null;
  const qc = str(f.qualityControl);
  if (qc === 'X' || qc === 'B') return null;
  return convertUom(f.value, f.unitCode, quantity);
}

/** Parse /stations/{id}/observations/latest. Null when the report has no usable timestamp. */
export function parseObservation(json: unknown, station?: StationRef): ParsedObservation | null {
  const props = obj(obj(json)?.properties);
  if (!props) return null;
  const observedAtMs = parseTime(props.timestamp);
  if (observedAtMs === null) return null;

  const humidity = field(props.relativeHumidity, 'percent');
  return {
    stationId: str(props.stationId) ?? station?.id ?? null,
    stationName: str(props.stationName) ?? station?.name ?? null,
    observedAtMs,
    description: str(props.textDescription),
    iconUrl: str(props.icon),
    tempC: field(props.temperature, 'temperature'),
    dewpointC: field(props.dewpoint, 'temperature'),
    humidityPct: humidity === null ? null : Math.min(100, Math.max(0, humidity)),
    windKph: field(props.windSpeed, 'speed'),
    windGustKph: field(props.windGust, 'speed'),
    windDirDeg: field(props.windDirection, 'angle'),
    pressurePa: field(props.barometricPressure, 'pressure') ?? field(props.seaLevelPressure, 'pressure'),
    visibilityM: field(props.visibility, 'distance'),
    heatIndexC: field(props.heatIndex, 'temperature'),
    windChillC: field(props.windChill, 'temperature'),
  };
}

/** True when the report has an air temperature and is recent enough to call "current". */
export function isUsableObservation(obs: ParsedObservation, now: number): boolean {
  return obs.tempC !== null && now - obs.observedAtMs < OBSERVATION_MAX_AGE_MS;
}

/**
 * The first of the nearest stations with a recent, non-null temperature; null when none qualifies
 * (the caller then falls back to the forecast hour). Throws only when no station answered at all.
 */
export async function loadCurrentObservation(
  stationsUrl: string,
  now: number,
  signal?: AbortSignal,
): Promise<ParsedObservation | null> {
  const opts = { signal, accept: GEO_JSON, attempts: 2, timeoutMs: 8_000 };
  const stations = parseStations(await fetchJson<unknown>(stationsUrl, opts));

  let lastError: unknown = null;
  let answered = false;
  for (const station of stations.slice(0, MAX_STATIONS_TRIED)) {
    try {
      const json = await fetchJson<unknown>(
        `${NWS_BASE}/stations/${encodeURIComponent(station.id)}/observations/latest`,
        opts,
      );
      answered = true;
      const obs = parseObservation(json, station);
      if (obs && isUsableObservation(obs, now)) return obs;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
    }
  }
  if (!answered && lastError !== null) throw lastError;
  return null;
}
