/**
 * Open-Meteo (no API key), used for what NWS does not provide:
 *  - NOAA GFS model: days 8-10 of the 10-day outlook and the hourly UV index
 *  - hourly US AQI forecast (also the AQI fallback when there is no AirNow key)
 * Both requests use timeformat=unixtime so hourly values are exact instants, and the location's
 * IANA zone so daily buckets line up with NWS local dates.
 */
import { BadResponseError, fetchJson } from './http';
import { HOUR_MS, floorToHour, isoZ, localDateOf } from './time';
import type { AirQualityDay, AirQualityNow } from './types';
import { arr, finite, obj, type Obj } from './util';

const GFS_ENDPOINT = 'https://api.open-meteo.com/v1/gfs';
const AIR_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const GFS_DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'uv_index_max',
];

/** Daily values for one local date from the GFS model (canonical units; snowfall already converted from cm to mm). */
export interface GfsDay {
  date: string;
  weatherCode: number | null;
  highC: number | null;
  lowC: number | null;
  feelsLikeHighC: number | null;
  feelsLikeLowC: number | null;
  precipChancePct: number | null;
  precipMm: number | null;
  snowMm: number | null;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  uvIndexMax: number | null;
}

export interface GfsData {
  days: GfsDay[];
  /** Hourly UV index keyed by the start of the hour (epoch ms). */
  uvByHour: Map<number, number>;
}

export function gfsUrl(lat: number, lon: number, timeZone: string): string {
  return (
    `${GFS_ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&daily=${GFS_DAILY_VARS.join(',')}&hourly=uv_index&forecast_days=11` +
    `&timezone=${encodeURIComponent(timeZone)}&timeformat=unixtime`
  );
}

function column(section: Obj | null, name: string): unknown[] {
  return arr(section?.[name]);
}

/** Parse a GFS response. Throws BadResponseError when neither daily nor hourly data is present. */
export function parseGfs(json: unknown, timeZone: string): GfsData {
  const root = obj(json);
  const daily = obj(root?.daily);
  const hourly = obj(root?.hourly);
  const dayTimes = column(daily, 'time');
  const hourTimes = column(hourly, 'time');
  if (dayTimes.length === 0 && hourTimes.length === 0) throw new BadResponseError('Open-Meteo GFS response had no data');

  const col = (name: string, i: number): number | null => finite(column(daily, name)[i]);
  const days: GfsDay[] = [];
  dayTimes.forEach((t, i) => {
    const seconds = finite(t);
    if (seconds === null) return;
    // `time` is local midnight; looking 6 hours in keeps the date right even across tz-database quirks.
    const date = localDateOf(seconds * 1000 + 6 * HOUR_MS, timeZone);
    const snowCm = col('snowfall_sum', i);
    days.push({
      date,
      weatherCode: col('weather_code', i),
      highC: col('temperature_2m_max', i),
      lowC: col('temperature_2m_min', i),
      feelsLikeHighC: col('apparent_temperature_max', i),
      feelsLikeLowC: col('apparent_temperature_min', i),
      precipChancePct: col('precipitation_probability_max', i),
      precipMm: col('precipitation_sum', i),
      snowMm: snowCm === null ? null : snowCm * 10,
      windKph: col('wind_speed_10m_max', i),
      windGustKph: col('wind_gusts_10m_max', i),
      windDirDeg: col('wind_direction_10m_dominant', i),
      uvIndexMax: col('uv_index_max', i),
    });
  });

  const uvByHour = new Map<number, number>();
  const uv = column(hourly, 'uv_index');
  hourTimes.forEach((t, i) => {
    const seconds = finite(t);
    const value = finite(uv[i]);
    if (seconds !== null && value !== null) uvByHour.set(floorToHour(seconds * 1000), value);
  });

  return { days, uvByHour };
}

export async function loadGfs(lat: number, lon: number, timeZone: string, signal?: AbortSignal): Promise<GfsData> {
  return parseGfs(await fetchJson<unknown>(gfsUrl(lat, lon, timeZone), { signal, attempts: 2, timeoutMs: 10_000 }), timeZone);
}

// ---------------------------------------------------------------------------------------------
// Air quality

/** Hourly US AQI and the sub-indices we can name a primary pollutant from. */
export interface AirQualityHour {
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  ozone: number | null;
}

export interface OpenMeteoAir {
  /** Model "current" value (null when Open-Meteo returned none). */
  current: { aqi: number; atMs: number } | null;
  /** Keyed by the start of the hour (epoch ms); about 5 days. */
  hourly: Map<number, AirQualityHour>;
}

export function airQualityUrl(lat: number, lon: number, timeZone: string): string {
  return (
    `${AIR_ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone&current=us_aqi&forecast_days=5` +
    `&timezone=${encodeURIComponent(timeZone)}&timeformat=unixtime`
  );
}

export function parseAirQuality(json: unknown): OpenMeteoAir {
  const root = obj(json);
  const hourly = obj(root?.hourly);
  const times = column(hourly, 'time');
  if (times.length === 0 && !obj(root?.current)) throw new BadResponseError('Open-Meteo air quality response had no data');

  const aqi = column(hourly, 'us_aqi');
  const pm25 = column(hourly, 'us_aqi_pm2_5');
  const pm10 = column(hourly, 'us_aqi_pm10');
  const ozone = column(hourly, 'us_aqi_ozone');
  const byHour = new Map<number, AirQualityHour>();
  times.forEach((t, i) => {
    const seconds = finite(t);
    if (seconds === null) return;
    byHour.set(floorToHour(seconds * 1000), {
      aqi: finite(aqi[i]),
      pm25: finite(pm25[i]),
      pm10: finite(pm10[i]),
      ozone: finite(ozone[i]),
    });
  });

  const cur = obj(root?.current);
  const curAqi = finite(cur?.us_aqi);
  const curTime = finite(cur?.time);
  return {
    current: curAqi !== null && curTime !== null ? { aqi: curAqi, atMs: curTime * 1000 } : null,
    hourly: byHour,
  };
}

export async function loadOpenMeteoAir(lat: number, lon: number, timeZone: string, signal?: AbortSignal): Promise<OpenMeteoAir> {
  return parseAirQuality(await fetchJson<unknown>(airQualityUrl(lat, lon, timeZone), { signal, attempts: 2, timeoutMs: 10_000 }));
}

/** EPA category number 1-6 for an AQI value. */
export function aqiCategoryNumber(aqi: number): number {
  if (aqi <= 50) return 1;
  if (aqi <= 100) return 2;
  if (aqi <= 150) return 3;
  if (aqi <= 200) return 4;
  if (aqi <= 300) return 5;
  return 6;
}

/** The pollutant with the largest sub-index in an hour, using AirNow's names. */
export function primaryPollutantOf(hour: AirQualityHour | undefined): string | null {
  if (!hour) return null;
  const candidates: Array<[string, number | null]> = [
    ['PM2.5', hour.pm25],
    ['PM10', hour.pm10],
    ['O3', hour.ozone],
  ];
  let best: [string, number] | null = null;
  for (const [name, value] of candidates) {
    if (value !== null && (best === null || value > best[1])) best = [name, value];
  }
  return best === null ? null : best[0];
}

/** Open-Meteo's current AQI as the app's AirQualityNow (the AirNow fallback). */
export function currentAirFromOpenMeteo(air: OpenMeteoAir, now: number): AirQualityNow | null {
  const hourKey = air.current ? floorToHour(air.current.atMs) : floorToHour(now);
  const hour = air.hourly.get(hourKey);
  const aqi = air.current?.aqi ?? hour?.aqi ?? null;
  if (aqi === null) return null;
  return {
    source: 'open-meteo',
    aqi: Math.round(aqi),
    primaryPollutant: primaryPollutantOf(hour),
    observedAt: isoZ(air.current?.atMs ?? hourKey),
    reportingArea: null,
  };
}

/** Daily worst-hour AQI per local date (today onward) from the hourly forecast. */
export function dailyAirFromOpenMeteo(air: OpenMeteoAir, timeZone: string, fromDate: string): AirQualityDay[] {
  const best = new Map<string, { aqi: number; hour: AirQualityHour }>();
  for (const [hourMs, hour] of [...air.hourly.entries()].sort((a, b) => a[0] - b[0])) {
    if (hour.aqi === null) continue;
    const date = localDateOf(hourMs, timeZone);
    if (date < fromDate) continue;
    const prev = best.get(date);
    if (!prev || hour.aqi > prev.aqi) best.set(date, { aqi: hour.aqi, hour });
  }
  return [...best.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, { aqi, hour }]) => ({
      date,
      aqi: Math.round(aqi),
      categoryNumber: aqiCategoryNumber(aqi),
      primaryPollutant: primaryPollutantOf(hour),
      discussion: null,
      source: 'open-meteo' as const,
    }));
}

/** Hourly AQI by hour start, for HourlyPoint.aqi. */
export function hourlyAqiMap(air: OpenMeteoAir): Map<number, number> {
  const out = new Map<number, number>();
  for (const [hourMs, hour] of air.hourly) if (hour.aqi !== null) out.set(hourMs, Math.round(hour.aqi));
  return out;
}
