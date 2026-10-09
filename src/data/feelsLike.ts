/**
 * "Feels like": NWS heat index (WPC Rothfusz regression with the Steadman pre-check and the low/high
 * humidity adjustments) and the NWS 2001 wind chill. The UI always labels the result "Feels like";
 * `kind` only records which formula applied.
 */
import { cToF, fToC, kphToMph } from '../lib/units';
import type { FeelsLikeKind } from './types';
import { clamp, finite } from './util';

/** Heat index applies from this air temperature (°F). */
export const HEAT_INDEX_MIN_F = 80;
/** Wind chill applies up to this air temperature (°F)... */
export const WIND_CHILL_MAX_F = 50;
/** ...and from this wind speed (mph). */
export const WIND_CHILL_MIN_MPH = 3;

const EPS = 1e-6;

/** NWS heat index in °F for air temperature `tF` (°F) and relative humidity `rh` (%). */
export function heatIndexF(tF: number, rhPct: number): number {
  const rh = clamp(rhPct, 0, 100);
  // Steadman's simple formula first; the full regression is only used when it says it's hot.
  const simple = 0.5 * (tF + 61.0 + (tF - 68.0) * 1.2 + rh * 0.094);
  if ((simple + tF) / 2 < 80) return simple;

  let hi =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh;

  if (rh < 13 && tF >= 80 && tF <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt(Math.max(0, (17 - Math.abs(tF - 95)) / 17));
  } else if (rh > 85 && tF >= 80 && tF <= 87) {
    hi += ((rh - 85) / 10) * ((87 - tF) / 5);
  }
  return hi;
}

/** NWS (2001) wind chill in °F for air temperature `tF` (°F) and wind `vMph` (mph). */
export function windChillF(tF: number, vMph: number): number {
  const v16 = Math.pow(vMph, 0.16);
  return 35.74 + 0.6215 * tF - 35.75 * v16 + 0.4275 * tF * v16;
}

export const heatIndexC = (tC: number, rhPct: number): number => fToC(heatIndexF(cToF(tC), rhPct));
export const windChillC = (tC: number, windKph: number): number => fToC(windChillF(cToF(tC), kphToMph(windKph)));

/** Which "feels like" rule applies at this air temperature and wind. */
export function feelsLikeKind(tempC: number, windKph: number | null | undefined): FeelsLikeKind {
  const tF = cToF(tempC);
  if (tF >= HEAT_INDEX_MIN_F - EPS) return 'heat-index';
  const wind = finite(windKph);
  if (tF <= WIND_CHILL_MAX_F + EPS && wind !== null && kphToMph(wind) >= WIND_CHILL_MIN_MPH - EPS) return 'wind-chill';
  return 'actual';
}

/** Relative humidity (%) from air temperature and dew point (°C) via the Magnus formula. */
export function humidityFromDewpoint(tempC: number, dewpointC: number): number {
  const a = 17.625;
  const b = 243.04;
  const rh = (100 * Math.exp((a * dewpointC) / (b + dewpointC))) / Math.exp((a * tempC) / (b + tempC));
  return clamp(rh, 0, 100);
}

export interface FeelsLikeInput {
  tempC: number | null;
  humidityPct?: number | null;
  windKph?: number | null;
  /** Heat index NWS reported (grid layer or station). Used only when the heat-index rule applies. */
  reportedHeatIndexC?: number | null;
  /** Wind chill NWS reported. Used only when the wind-chill rule applies. */
  reportedWindChillC?: number | null;
  /** NWS apparentTemperature: last resort when the formula's inputs are missing. */
  apparentC?: number | null;
}

export interface FeelsLikeResult {
  feelsLikeC: number | null;
  kind: FeelsLikeKind;
}

/**
 * Decide the rule from the air temperature (°F >= 80 heat index; <= 50 and wind >= 3 mph wind chill;
 * otherwise the actual temperature), then prefer NWS's own value for that rule and compute it when
 * NWS didn't report one. NWS stations report heatIndex even in mild weather, so the rule gates it.
 */
export function feelsLike(input: FeelsLikeInput): FeelsLikeResult {
  const tempC = finite(input.tempC);
  if (tempC === null) return { feelsLikeC: null, kind: 'actual' };
  const actual: FeelsLikeResult = { feelsLikeC: tempC, kind: 'actual' };

  const windKph = finite(input.windKph);
  const kind = feelsLikeKind(tempC, windKph);
  if (kind === 'actual') return actual;

  if (kind === 'heat-index') {
    const reported = finite(input.reportedHeatIndexC);
    if (reported !== null) return { feelsLikeC: reported, kind };
    const rh = finite(input.humidityPct);
    if (rh !== null) return { feelsLikeC: heatIndexC(tempC, rh), kind };
  } else {
    const reported = finite(input.reportedWindChillC);
    if (reported !== null) return { feelsLikeC: reported, kind };
    if (windKph !== null) return { feelsLikeC: windChillC(tempC, windKph), kind };
  }
  const apparent = finite(input.apparentC);
  return apparent !== null ? { feelsLikeC: apparent, kind } : actual;
}
