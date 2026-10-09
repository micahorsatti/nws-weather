/**
 * Builds the hourly series: NWS gridpoint numbers (temperature, wind, precipitation, ...) merged by
 * hour with the NWS hourly forecast's icon/short text, Open-Meteo UV and AQI. Every source is optional;
 * an hour takes the first source that has a value (grid, then the hourly forecast feed).
 */
import { feelsLike, humidityFromDewpoint } from './feelsLike';
import type { HourlyGrid } from './nws/grid';
import type { NwsHourlyPeriod } from './nws/forecast';
import { describeIcon } from './icons';
import { HOUR_MS, floorToHour, isoZ, localDateOf, parseTime, startOfLocalDay } from './time';
import { isDaytimeAt } from './sun';
import type { ForecastPeriod, HourlyPoint, WxIcon } from './types';
import { round } from './util';

/** Longest series we will build (the grid covers ~7.5 days; Caribbean/Pacific offices a little more). */
const MAX_HOURS = 240;

export interface HourlyInputs {
  now: number;
  timeZone: string;
  lat: number;
  lon: number;
  grid: HourlyGrid | null;
  nwsHourly: NwsHourlyPeriod[] | null;
  /** 12-hour forecast periods: supply icon/text for hours beyond the hourly feed. */
  periods: ForecastPeriod[] | null;
  uvByHour: Map<number, number> | null;
  aqiByHour: Map<number, number> | null;
}

/** NWS sky-cover wording: <=5% clear, <=25% mostly clear, <=50% partly cloudy, <=87% mostly cloudy, else cloudy. */
export function iconFromSkyCover(skyCoverPct: number | null): WxIcon {
  if (skyCoverPct === null) return 'unknown';
  if (skyCoverPct <= 5) return 'clear';
  if (skyCoverPct <= 25) return 'mostly-clear';
  if (skyCoverPct <= 50) return 'partly-cloudy';
  if (skyCoverPct <= 87) return 'mostly-cloudy';
  return 'cloudy';
}

/** Last-resort icon from raw numbers when neither the hourly feed nor a forecast period covers an hour. */
export function iconFromGridValues(v: {
  skyCoverPct: number | null;
  precipChancePct: number | null;
  thunderChancePct: number | null;
  precipMm: number | null;
  snowMm: number | null;
  tempC: number | null;
}): WxIcon {
  if (v.thunderChancePct !== null && v.thunderChancePct >= 40) return 'thunderstorm';
  const pop = v.precipChancePct ?? 0;
  if (pop >= 50 || (v.precipMm ?? 0) >= 0.25) {
    const snowy = (v.snowMm ?? 0) > 0 || (v.tempC !== null && v.tempC <= 0);
    if (snowy) return 'snow';
    return pop < 70 ? 'rain-showers' : 'rain';
  }
  return iconFromSkyCover(v.skyCoverPct);
}

interface PeriodSpan {
  start: number;
  end: number;
  period: ForecastPeriod;
}

function spansOf(periods: ForecastPeriod[] | null): PeriodSpan[] {
  const out: PeriodSpan[] = [];
  for (const period of periods ?? []) {
    const start = parseTime(period.startTime);
    const end = parseTime(period.endTime);
    if (start !== null && end !== null) out.push({ start, end, period });
  }
  return out;
}

export function buildHourlySeries(i: HourlyInputs): HourlyPoint[] {
  const feed = new Map<number, NwsHourlyPeriod>();
  for (const p of i.nwsHourly ?? []) {
    for (let h = floorToHour(p.startMs); h < Math.max(p.endMs, p.startMs + HOUR_MS); h += HOUR_MS) feed.set(h, p);
  }

  let first = Infinity;
  let last = -Infinity;
  if (i.grid) {
    first = Math.min(first, i.grid.startMs);
    last = Math.max(last, i.grid.endMs);
  }
  for (const h of feed.keys()) {
    first = Math.min(first, h);
    last = Math.max(last, h + HOUR_MS);
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];

  // Start no earlier than local midnight today: that's all the daily summaries need.
  const dayStart = startOfLocalDay(localDateOf(i.now, i.timeZone), i.timeZone);
  const startMs = Math.max(first, dayStart);
  const endMs = Math.min(last, startMs + MAX_HOURS * HOUR_MS);
  const spans = spansOf(i.periods);
  const { grid } = i;

  const points: HourlyPoint[] = [];
  for (let h = startMs; h < endMs; h += HOUR_MS) {
    const f = feed.get(h);
    const g = (layer: Parameters<HourlyGrid['get']>[0]): number | null => (grid ? grid.get(layer, h) : null);

    const tempC = g('temperature') ?? f?.tempC ?? null;
    const dewpointC = g('dewpoint') ?? f?.dewpointC ?? null;
    let humidityPct = g('relativeHumidity') ?? f?.humidityPct ?? null;
    if (humidityPct === null && tempC !== null && dewpointC !== null) humidityPct = humidityFromDewpoint(tempC, dewpointC);
    const windKph = g('windSpeed') ?? f?.windKph ?? null;
    const feels = feelsLike({
      tempC,
      humidityPct,
      windKph,
      reportedHeatIndexC: g('heatIndex'),
      reportedWindChillC: g('windChill'),
      apparentC: g('apparentTemperature'),
    });

    const skyCoverPct = g('skyCover');
    const precipChancePct = g('probabilityOfPrecipitation') ?? f?.precipChancePct ?? null;
    const precipMm = g('quantitativePrecipitation');
    const snowMm = g('snowfallAmount');
    const thunderChancePct = g('probabilityOfThunder');

    // Conditions: hourly feed first, then the 12-hour period covering the hour, then derived from numbers.
    const daylight = isDaytimeAt(h + HOUR_MS / 2, i.lat, i.lon);
    const span = spans.find((s) => h >= s.start && h < s.end);
    let icon: WxIcon = 'unknown';
    let shortForecast = '';
    let isDaytime = daylight;
    if (f) {
      icon = f.icon;
      shortForecast = f.shortForecast;
      isDaytime = f.isDaytime;
    }
    if (icon === 'unknown' && span) {
      icon = span.period.icon;
      shortForecast = span.period.shortForecast;
    }
    if (icon === 'unknown') {
      icon = iconFromGridValues({ skyCoverPct, precipChancePct, thunderChancePct, precipMm, snowMm, tempC });
    }
    if (shortForecast === '' && icon !== 'unknown') shortForecast = describeIcon(icon, isDaytime);

    points.push({
      time: isoZ(h),
      isDaytime,
      icon,
      shortForecast,
      tempC: round(tempC),
      feelsLikeC: round(feels.feelsLikeC),
      feelsLikeKind: feels.kind,
      dewpointC: round(dewpointC),
      humidityPct: round(humidityPct, 1),
      skyCoverPct: round(skyCoverPct, 1),
      precipChancePct: round(precipChancePct, 1),
      precipMm: round(precipMm),
      snowMm: round(snowMm),
      thunderChancePct: round(thunderChancePct, 1),
      windKph: round(windKph, 1),
      windGustKph: round(g('windGust'), 1),
      windDirDeg: round(g('windDirection') ?? f?.windDirDeg ?? null, 0),
      uvIndex: round(i.uvByHour?.get(h) ?? null, 2),
      aqi: i.aqiByHour?.get(h) ?? null,
    });
  }
  return points;
}
