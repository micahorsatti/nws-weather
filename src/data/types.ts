/**
 * DATA CONTRACT shared by the data layer (src/data/**, producer) and the UI (src/ui/**, consumer).
 * Do not change shapes without the orchestrator's agreement — both sides are built against this file.
 *
 * Canonical units (convert for display with src/lib/units.ts):
 *   temperature °C · wind km/h · precipitation & snow mm · pressure Pa · visibility m · percentages 0–100
 * Times are ISO-8601 strings that always carry an offset or Z.
 * Dates ('YYYY-MM-DD') are calendar dates in the forecast location's time zone (PointInfo.timeZone),
 * never the device's time zone.
 * Missing values are null — never NaN, never undefined for required keys.
 */

/** Normalized weather condition. Pair with an isDaytime flag to choose sun vs. moon artwork. */
export type WxIcon =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'mostly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'haze'
  | 'smoke'
  | 'dust'
  | 'wind'
  | 'drizzle'
  | 'rain-showers'
  | 'rain'
  | 'heavy-rain'
  | 'thunderstorm'
  | 'severe-thunderstorm'
  | 'snow-showers'
  | 'snow'
  | 'heavy-snow'
  | 'blizzard'
  | 'sleet'
  | 'freezing-rain'
  | 'rain-snow'
  | 'hot'
  | 'cold'
  | 'tornado'
  | 'tropical-storm'
  | 'hurricane'
  | 'unknown';

export interface Place {
  /** Stable id from placeIdFor(lat, lon), or GPS_PLACE_ID for the live device location. */
  id: string;
  /** Display name, e.g. "Linn, KS". */
  name: string;
  lat: number;
  lon: number;
  kind: 'gps' | 'saved' | 'search';
}

export const GPS_PLACE_ID = 'gps';

/** Stable place id: coordinates rounded to 4 decimals (the precision api.weather.gov accepts). */
export function placeIdFor(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** What NWS /points tells us about a location. */
export interface PointInfo {
  /** Forecast office, e.g. "TOP". */
  wfo: string;
  gridX: number;
  gridY: number;
  /** IANA zone, e.g. "America/Chicago". Use it for every local date/time computation. */
  timeZone: string;
  /** NWS relativeLocation: the nearest named place. */
  city: string;
  state: string;
  radarStation: string | null;
  forecastZone: string | null;
  county: string | null;
}

/**
 * Which value "Feels like" shows. The UI always labels it "Feels like";
 * kind only explains where the number came from.
 *   heat-index: air temp >= 80°F and NWS heat index available/computed
 *   wind-chill: air temp <= 50°F and wind >= 3 mph
 *   actual:     neither applies, so feelsLikeC equals the air temperature
 */
export type FeelsLikeKind = 'heat-index' | 'wind-chill' | 'actual';

export interface CurrentConditions {
  /** 'forecast' when the station report is missing or stale (> 90 min) and the current forecast hour is used. */
  source: 'observation' | 'forecast';
  observedAt: string;
  stationId: string | null;
  stationName: string | null;
  /** e.g. "Partly Cloudy" */
  description: string;
  icon: WxIcon;
  isDaytime: boolean;
  tempC: number | null;
  feelsLikeC: number | null;
  feelsLikeKind: FeelsLikeKind;
  dewpointC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  windGustKph: number | null;
  /** Direction the wind blows FROM, degrees true (0 = north). */
  windDirDeg: number | null;
  pressurePa: number | null;
  visibilityM: number | null;
}

export interface HourlyPoint {
  /** Start of the hour. */
  time: string;
  isDaytime: boolean;
  icon: WxIcon;
  /** e.g. "Chance Showers And Thunderstorms" */
  shortForecast: string;
  tempC: number | null;
  feelsLikeC: number | null;
  feelsLikeKind: FeelsLikeKind;
  dewpointC: number | null;
  humidityPct: number | null;
  skyCoverPct: number | null;
  precipChancePct: number | null;
  /** Liquid-equivalent precipitation expected during this hour. */
  precipMm: number | null;
  snowMm: number | null;
  thunderChancePct: number | null;
  windKph: number | null;
  windGustKph: number | null;
  windDirDeg: number | null;
  /** Open-Meteo hourly UV index forecast. */
  uvIndex: number | null;
  /** Open-Meteo hourly US AQI forecast (null beyond its ~5-day horizon). */
  aqi: number | null;
}

/** One NWS day or night forecast period, including the forecaster's written text. */
export interface ForecastPeriod {
  /** "Tonight", "Thursday", "Thursday Night" */
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  tempC: number | null;
  precipChancePct: number | null;
  /** NWS wind text, e.g. "S 5 to 10 mph" (as NWS wrote it). */
  windText: string;
  shortForecast: string;
  /** The forecaster's written forecast for this period. */
  detailedForecast: string;
  icon: WxIcon;
}

export interface DailyForecast {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** 'gfs' = extended outlook from NOAA's GFS model via Open-Meteo (days 8–10); lower confidence. */
  source: 'nws' | 'gfs';
  highC: number | null;
  lowC: number | null;
  feelsLikeHighC: number | null;
  feelsLikeLowC: number | null;
  precipChancePct: number | null;
  precipMm: number | null;
  snowMm: number | null;
  /** Max sustained wind. */
  windKph: number | null;
  windGustKph: number | null;
  uvIndexMax: number | null;
  aqiMax: number | null;
  /** Daytime icon when there is a day period, otherwise the night icon. */
  icon: WxIcon;
  isDaytimeIcon: boolean;
  /** Short summary, e.g. "Mostly Sunny". */
  summary: string;
  /** NWS periods (null for 'gfs' days, and day is null when the forecast starts at "Tonight"). */
  day: ForecastPeriod | null;
  night: ForecastPeriod | null;
  sunrise: string | null;
  sunset: string | null;
}

export type AqiSource = 'airnow' | 'open-meteo';

export interface AirQualityNow {
  source: AqiSource;
  /** US EPA AQI (0–500). */
  aqi: number;
  /** "PM2.5", "O3", "PM10" ... */
  primaryPollutant: string | null;
  observedAt: string;
  /** AirNow reporting area, e.g. "Topeka". */
  reportingArea: string | null;
}

export interface AirQualityDay {
  date: string;
  /** May be null when the agency issued only a category. */
  aqi: number | null;
  /** EPA category 1–6 when known. */
  categoryNumber: number | null;
  primaryPollutant: string | null;
  /** AirNow forecaster discussion, when provided. */
  discussion: string | null;
  source: AqiSource;
}

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface AlertGeometry {
  type: 'Polygon' | 'MultiPolygon';
  /** GeoJSON coordinates ([lon, lat] order). */
  coordinates: number[][][] | number[][][][];
}

export interface WeatherAlert {
  id: string;
  /** "Tornado Warning" */
  event: string;
  headline: string;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  areaDesc: string;
  senderName: string;
  description: string;
  instruction: string | null;
  /** Link to the alert on api.weather.gov / weather.gov. */
  url: string | null;
  /** Warning polygon when NWS provides one (zone-based alerts often have none). */
  geometry: AlertGeometry | null;
}

/** Sun times for one day; null fields during polar day or night. */
export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
  solarNoon: string | null;
  civilDawn: string | null;
  civilDusk: string | null;
  daylightMinutes: number | null;
}

export type DataSource =
  | 'nws-points'
  | 'nws-forecast'
  | 'nws-hourly'
  | 'nws-grid'
  | 'nws-observation'
  | 'nws-alerts'
  | 'open-meteo-gfs'
  | 'open-meteo-uv'
  | 'open-meteo-aqi'
  | 'airnow';

/** A non-fatal partial failure; the rest of the bundle is still usable. */
export interface SourceProblem {
  source: DataSource;
  message: string;
}

export interface WeatherBundle {
  place: Place;
  point: PointInfo;
  /** When this bundle was assembled on the device. */
  fetchedAt: string;
  /** When NWS last updated the forecast (forecast updateTime), if known. */
  forecastUpdatedAt: string | null;
  current: CurrentConditions | null;
  /** From the current hour forward through the end of NWS grid data (~7 days). */
  hourly: HourlyPoint[];
  /** Today first: up to 7 NWS days, then GFS days to reach 10 when available. */
  daily: DailyForecast[];
  /** Today's sun times. */
  sun: SunTimes;
  airNow: AirQualityNow | null;
  airForecast: AirQualityDay[];
  /** Active alerts for the point, most severe first, then by onset. */
  alerts: WeatherAlert[];
  problems: SourceProblem[];
}

/** NWS Area Forecast Discussion (the forecasters' technical write-up), loaded on demand. */
export interface ForecastDiscussion {
  wfo: string;
  issuedAt: string;
  /** Plain preformatted text, as NWS publishes it. */
  text: string;
  /** Human-readable page on forecast.weather.gov. */
  url: string;
}

export type WeatherErrorKind = 'out-of-coverage' | 'network' | 'nws-unavailable' | 'unknown';

/** Fatal load failure (no usable bundle could be built). */
export class WeatherLoadError extends Error {
  readonly kind: WeatherErrorKind;
  constructor(kind: WeatherErrorKind, message: string) {
    super(message);
    this.name = 'WeatherLoadError';
    this.kind = kind;
  }
}

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What useWeather() returns. */
export interface WeatherState {
  /** Newest data available; may be restored from the on-device cache before the network answers. */
  bundle: WeatherBundle | null;
  /** idle: no place · loading: no bundle yet, fetching · ready: bundle present · error: no bundle and the fetch failed */
  status: WeatherStatus;
  /** A background refresh is in flight while an existing bundle is shown. */
  refreshing: boolean;
  /** Most recent fetch failure (set with status 'ready' when a background refresh failed). */
  error: WeatherLoadError | null;
  /** True while `bundle` is a cached copy that has not been refreshed yet in this session. */
  fromCache: boolean;
  refresh: () => void;
}
