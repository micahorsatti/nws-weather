/**
 * Builds a complete WeatherBundle from a Scenario. Everything is derived from `now`, so the series
 * always starts at the current hour and "today" is always today. Deterministic for a given `now`.
 */
import type {
  AirQualityDay,
  AirQualityNow,
  CurrentConditions,
  DailyForecast,
  FeelsLikeKind,
  ForecastDiscussion,
  ForecastPeriod,
  HourlyPoint,
  Place,
  PointInfo,
  SourceProblem,
  WeatherAlert,
  WeatherBundle,
  WxIcon,
} from '../data/types';
import { addDaysToKey, HOUR_MS, isoInZone, localDateKey, localHour, weekdayOfKey, zonedToMs } from '../ui/lib/time';
import { bump, clamp, fToC, heatIndexF, interpolate, relativeHumidity, round1, roundTo, windChillF, wobble } from './model';
import { detailedForecast, windText } from './text';
import type { PeriodStats } from './text';

export type MockName = 'summer' | 'winter';
export const MOCK_NAMES: readonly MockName[] = ['summer', 'winter'];

export interface DayPlan {
  hiF: number;
  loF: number;
  /** Typical dew point that day, °F. */
  dewF: number;
  /** Background sky cover %. */
  cloud: number;
  /** Background chance of precipitation %. */
  precip: number;
  /** Typical sustained wind, km/h. */
  windKph: number;
  /** Prevailing direction the wind comes from, degrees. */
  dir: number;
}

export interface Storm {
  /** Epoch ms of peak intensity. */
  center: number;
  /** Gaussian width in hours. */
  widthH: number;
  /** 0–1 */
  intensity: number;
  type: 'thunder' | 'rain' | 'snow';
  severe?: boolean;
}

export interface ScenarioCtx {
  now: number;
  tz: string;
  /** Local dates for today and the next nine days. */
  dayKeys: string[];
  /** Start of the current hour (epoch ms). */
  hourStart: number;
}

export interface Scenario {
  name: MockName;
  place: Place;
  point: PointInfo;
  /** Local [hour, minute] of sunrise/sunset (held constant across the 10 days). */
  sunrise: [number, number];
  sunset: [number, number];
  noonAltDeg: number;
  /** Clear-sky UV index at solar noon. */
  uvClear: number;
  /** Always exactly 10 entries: today first. */
  days: DayPlan[];
  storms: (ctx: ScenarioCtx) => Storm[];
  /** Snow:liquid ratio when precipitation falls as snow. */
  slr: number;
  station: { id: string; name: string };
  pressurePa: number;
  visibilityM: number;
  aqiAt: (ctx: ScenarioCtx, t: number) => number;
  airNow: (ctx: ScenarioCtx) => AirQualityNow;
  airForecast: (ctx: ScenarioCtx, dailyAqiMax: (number | null)[]) => AirQualityDay[];
  alerts: (ctx: ScenarioCtx) => WeatherAlert[];
  /** Partial failures to report (the matching data is nulled out by the generator). */
  problems?: SourceProblem[];
  /** Simulate an Open-Meteo UV outage: no hourly UV, no daily UV maximum. */
  omitUv?: boolean;
  discussion: (ctx: ScenarioCtx) => ForecastDiscussion;
}

interface HourState {
  t: number;
  dateKey: string;
  hour: number;
  tF: number;
  dewF: number;
  rh: number;
  cloud: number;
  chance: number;
  precipMm: number;
  snowMm: number;
  thunder: number;
  windKph: number;
  gustKph: number;
  dir: number;
  isDay: boolean;
  uv: number;
  aqi: number | null;
  feelsF: number;
  feelsKind: FeelsLikeKind;
  icon: WxIcon;
  short: string;
  severity: number;
}

const SERIES_HOURS = 240;
export const MOCK_HOURLY_COUNT = 156;
const AQI_HORIZON_HOURS = 120;

/** How alarming each icon is; used to pick the representative hour for a day or night. */
const SEVERITY: Partial<Record<WxIcon, number>> = {
  'severe-thunderstorm': 12,
  blizzard: 11,
  thunderstorm: 10,
  'heavy-snow': 9,
  'heavy-rain': 8,
  snow: 7,
  rain: 6,
  'rain-showers': 5,
  'snow-showers': 5,
  drizzle: 4,
  cloudy: 3,
  'mostly-cloudy': 2,
  'partly-cloudy': 1,
};

function classify(h: {
  cloud: number;
  chance: number;
  precipMm: number;
  snowMm: number;
  thunder: number;
  tF: number;
  windKph: number;
  isDay: boolean;
  severe: boolean;
}): { icon: WxIcon; short: string } {
  const snowy = h.tF <= 33;
  const tier = h.chance >= 70 ? 'likely' : h.chance >= 40 ? 'chance' : h.chance >= 20 ? 'slight' : null;
  if (tier && !snowy && h.thunder >= 30) {
    if (h.severe && h.chance >= 60) return { icon: 'severe-thunderstorm', short: 'Severe Thunderstorms' };
    if (h.thunder >= 60 && tier === 'likely') return { icon: 'thunderstorm', short: 'Thunderstorms' };
    const label = tier === 'likely' ? 'Showers And Thunderstorms Likely' : tier === 'chance' ? 'Chance Showers And Thunderstorms' : 'Slight Chance Showers And Thunderstorms';
    return { icon: 'thunderstorm', short: label };
  }
  if (tier && snowy) {
    if (h.snowMm >= 8 && h.windKph >= 45) return { icon: 'blizzard', short: 'Blizzard' };
    if (h.snowMm >= 8) return { icon: 'heavy-snow', short: 'Heavy Snow' };
    if (tier === 'likely') return { icon: 'snow', short: 'Snow Likely' };
    return { icon: 'snow-showers', short: tier === 'chance' ? 'Chance Snow Showers' : 'Slight Chance Snow Showers' };
  }
  if (tier && !snowy) {
    if (tier === 'likely') return h.precipMm >= 2.5 ? { icon: 'heavy-rain', short: 'Heavy Rain' } : { icon: 'rain', short: 'Rain Likely' };
    if (tier === 'chance') return { icon: 'rain-showers', short: 'Chance Rain Showers' };
    return h.cloud >= 85 ? { icon: 'drizzle', short: 'Slight Chance Light Rain' } : { icon: 'rain-showers', short: 'Slight Chance Rain Showers' };
  }
  if (h.cloud < 12) return { icon: 'clear', short: h.isDay ? 'Sunny' : 'Clear' };
  if (h.cloud < 32) return { icon: 'mostly-clear', short: h.isDay ? 'Mostly Sunny' : 'Mostly Clear' };
  if (h.cloud < 58) return { icon: 'partly-cloudy', short: h.isDay ? 'Partly Sunny' : 'Partly Cloudy' };
  if (h.cloud < 83) return { icon: 'mostly-cloudy', short: 'Mostly Cloudy' };
  return { icon: 'cloudy', short: 'Cloudy' };
}

export function makeContext(sc: Scenario, now: number): ScenarioCtx {
  const tz = sc.point.timeZone;
  const today = localDateKey(now, tz);
  const dayKeys = Array.from({ length: 10 }, (_, d) => addDaysToKey(today, d));
  return { now, tz, dayKeys, hourStart: Math.floor(now / HOUR_MS) * HOUR_MS };
}

function buildSeries(sc: Scenario, ctx: ScenarioCtx): HourState[] {
  const { tz, dayKeys } = ctx;
  const storms = sc.storms(ctx);
  const planOf = (index: number): DayPlan => sc.days[clamp(index, 0, sc.days.length - 1)];
  const keyList = Array.from({ length: 12 }, (_, i) => ({ d: i - 1, key: addDaysToKey(dayKeys[0], i - 1) }));

  const at = (hourOfDay: number, pick: (p: DayPlan) => number) =>
    keyList.map(({ d, key }) => ({ x: zonedToMs(key, hourOfDay, 0, tz), y: pick(planOf(d)) }));

  const tempPts = [...at(5, (p) => p.loF), ...at(16, (p) => p.hiF)].sort((a, b) => a.x - b.x);
  const dewPts = at(14, (p) => p.dewF);
  const cloudPts = at(12, (p) => p.cloud);
  const precipPts = at(12, (p) => p.precip);
  const windPts = at(14, (p) => p.windKph);
  const dirPts = at(12, (p) => p.dir);

  const sun = new Map<string, { sr: number; ss: number }>();
  for (const { key } of keyList) {
    sun.set(key, { sr: zonedToMs(key, sc.sunrise[0], sc.sunrise[1], tz), ss: zonedToMs(key, sc.sunset[0], sc.sunset[1], tz) });
  }
  const noonSin = Math.sin((sc.noonAltDeg * Math.PI) / 180);

  const start = zonedToMs(dayKeys[0], 0, 0, tz);
  const series: HourState[] = [];
  for (let i = 0; i < SERIES_HOURS; i++) {
    const t = start + i * HOUR_MS;
    const dateKey = localDateKey(t, tz);
    const hour = localHour(t, tz);
    const weights = storms.map((s) => ({ s, w: bump((t - s.center) / HOUR_MS, 0, s.widthH), wide: bump((t - s.center) / HOUR_MS, 0, s.widthH * 1.7) }));

    let cool = 0;
    for (const { s, w } of weights) cool += w * s.intensity * (s.type === 'thunder' ? 9 : s.type === 'rain' ? 4 : 2);
    const tF = interpolate(tempPts, t) + wobble(i) * 0.7 - cool;
    const dewF = Math.min(tF - 0.4, interpolate(dewPts, t) + wobble(i, 5) * 0.9 + weights.reduce((a, { w, s }) => a + w * s.intensity * 1.5, 0));
    const rh = relativeHumidity(fToC(tF), fToC(dewF));

    let cloud = interpolate(cloudPts, t) + wobble(i, 1) * 7;
    let chance = interpolate(precipPts, t);
    let liquidMm = 0;
    let thunder = 0;
    let gustBoost = 0;
    for (const { s, w, wide } of weights) {
      cloud += s.intensity * (97 - cloud) * bump((t - s.center) / HOUR_MS, 0, s.widthH * 1.3);
      chance += s.intensity * (96 - chance) * wide;
      const peak = s.type === 'thunder' ? 9 : s.type === 'rain' ? 4 : 1.7;
      liquidMm += s.intensity * peak * w;
      if (s.type === 'thunder') thunder += s.intensity * 88 * bump((t - s.center) / HOUR_MS, 0, s.widthH * 1.4);
      gustBoost += s.intensity * 24 * w;
    }
    cloud = clamp(cloud, 0, 100);
    chance = clamp(roundTo(chance, 5), 0, 100);
    thunder = clamp(roundTo(thunder + (sc.name === 'summer' ? 10 * bump(hour, 16, 3.5) : 0), 5), 0, 100);
    if (liquidMm < 0.05) liquidMm = 0;
    const snowy = tF <= 33;
    const snowMm = snowy ? liquidMm * sc.slr : 0;

    const diurnalWind = 0.8 + 0.3 * bump(hour, 15, 5);
    const windKph = Math.max(0, interpolate(windPts, t) * diurnalWind + wobble(i, 2) * 4 + gustBoost * 0.3);
    const gustKph = windKph * 1.45 + Math.abs(wobble(i, 3)) * 6 + gustBoost;
    const dir = (interpolate(dirPts, t) + wobble(i, 4) * 14 + 360) % 360;

    const { sr, ss } = sun.get(dateKey) ?? { sr: 0, ss: 0 };
    const isDay = t >= sr && t < ss;
    const u = isDay ? (t + HOUR_MS / 2 - sr) / (ss - sr) : 0;
    const altSin = isDay ? Math.sin(Math.PI * clamp(u, 0, 1)) * Math.sin(((sc.noonAltDeg) * Math.PI) / 180) : 0;
    const uvRaw = isDay ? sc.uvClear * Math.pow(Math.max(0, altSin) / noonSin, 1.2) * (1 - 0.5 * Math.pow(cloud / 100, 1.6)) : 0;
    const uv = round1(Math.max(0, uvRaw));

    const offset = Math.round((t - ctx.hourStart) / HOUR_MS);
    const aqi = offset >= AQI_HORIZON_HOURS ? null : Math.round(clamp(sc.aqiAt(ctx, t), 5, 300));

    const mph = windKph / 1.609344;
    let feelsF = tF;
    let feelsKind: FeelsLikeKind = 'actual';
    if (tF >= 80) {
      feelsF = heatIndexF(tF, rh);
      feelsKind = 'heat-index';
    } else if (tF <= 50 && mph >= 3) {
      feelsF = windChillF(tF, mph);
      feelsKind = 'wind-chill';
    }

    const severe = weights.some(({ s, w }) => s.severe === true && w > 0.45);
    const { icon, short } = classify({ cloud, chance, precipMm: liquidMm, snowMm, thunder, tF, windKph, isDay, severe });
    series.push({
      t,
      dateKey,
      hour,
      tF,
      dewF,
      rh,
      cloud,
      chance,
      precipMm: liquidMm,
      snowMm,
      thunder,
      windKph,
      gustKph,
      dir,
      isDay,
      uv,
      aqi,
      feelsF,
      feelsKind,
      icon,
      short,
      severity: SEVERITY[icon] ?? 0,
    });
  }
  return series;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

function worstHour(hs: HourState[], prefer: (h: HourState) => number): HourState {
  let best = hs[0];
  for (const h of hs) {
    if (h.severity > best.severity || (h.severity === best.severity && prefer(h) < prefer(best))) best = h;
  }
  return best;
}

function statsFor(hs: HourState[], isDay: boolean): PeriodStats {
  const heat = hs.filter((h) => h.feelsKind === 'heat-index').map((h) => h.feelsF);
  const chill = hs.filter((h) => h.feelsKind === 'wind-chill').map((h) => h.feelsF);
  const peak = hs.reduce((a, h) => (h.chance > a.chance ? h : a), hs[0]);
  const sinSum = sum(hs.map((h) => Math.sin((h.dir * Math.PI) / 180)));
  const cosSum = sum(hs.map((h) => Math.cos((h.dir * Math.PI) / 180)));
  const tempF = isDay ? Math.max(...hs.map((h) => h.tF)) : Math.min(...hs.map((h) => h.tF));
  return {
    isDay,
    tempF,
    cloud: avg(hs.map((h) => h.cloud)),
    chance: Math.max(...hs.map((h) => h.chance)),
    thunder: Math.max(...hs.map((h) => h.thunder)),
    rainIn: sum(hs.map((h) => h.precipMm)) / 25.4,
    snowIn: sum(hs.map((h) => h.snowMm)) / 25.4,
    windMph: avg(hs.map((h) => h.windKph)) / 1.609344,
    gustMph: Math.max(...hs.map((h) => h.gustKph)) / 1.609344,
    dirDeg: (Math.atan2(sinSum, cosSum) * 180) / Math.PI + (Math.atan2(sinSum, cosSum) < 0 ? 360 : 0),
    heatIndexF: heat.length ? Math.max(...heat) : null,
    windChillF: chill.length ? Math.min(...chill) : null,
    snowy: hs.some((h) => h.snowMm > 0.2) || (tempF <= 33 && Math.max(...hs.map((h) => h.chance)) >= 20),
    peakHour: peak.hour,
    severe: hs.some((h) => h.icon === 'severe-thunderstorm'),
  };
}

export function generateBundle(sc: Scenario, now: number = Date.now()): WeatherBundle {
  const ctx = makeContext(sc, now);
  const { tz, dayKeys } = ctx;
  const iso = (ms: number): string => isoInZone(ms, tz);
  const series = buildSeries(sc, ctx);

  // ---- hourly: from the current hour forward
  const hourly: HourlyPoint[] = series
    .filter((h) => h.t >= ctx.hourStart)
    .slice(0, MOCK_HOURLY_COUNT)
    .map((h) => ({
      time: iso(h.t),
      isDaytime: h.isDay,
      icon: h.icon,
      shortForecast: h.short,
      tempC: round1(fToC(h.tF)),
      feelsLikeC: round1(fToC(h.feelsF)),
      feelsLikeKind: h.feelsKind,
      dewpointC: round1(fToC(h.dewF)),
      humidityPct: Math.round(h.rh),
      skyCoverPct: Math.round(h.cloud),
      precipChancePct: h.chance,
      precipMm: round1(h.precipMm * 100) / 100,
      snowMm: h.snowMm > 0 ? round1(h.snowMm) : 0,
      thunderChancePct: h.thunder,
      windKph: Math.round(h.windKph),
      windGustKph: h.gustKph - h.windKph >= 9 ? Math.round(h.gustKph) : null,
      windDirDeg: Math.round(h.dir / 5) * 5 % 360,
      uvIndex: sc.omitUv ? null : h.uv,
      aqi: h.aqi,
    }));

  // ---- daily: ten local days, 7 from "NWS" with periods + text, 3 from "GFS"
  const nowHour = localHour(now, tz);
  const daily: DailyForecast[] = dayKeys.map((key, d) => {
    const nextKey = dayKeys[d + 1] ?? addDaysToKey(key, 1);
    const dayHours = series.filter((h) => h.dateKey === key);
    const sunrise = zonedToMs(key, sc.sunrise[0], sc.sunrise[1], tz);
    const sunset = zonedToMs(key, sc.sunset[0], sc.sunset[1], tz);
    const highF = Math.max(...dayHours.map((h) => h.tF));
    const lowF = Math.min(...dayHours.map((h) => h.tF));
    const aqis = dayHours.map((h) => h.aqi).filter((v): v is number => v !== null);
    const nws = d < 7;

    const dayPart = series.filter((h) => h.dateKey === key && h.hour >= 6 && h.hour < 18);
    const nightPart = series.filter((h) => (h.dateKey === key && h.hour >= 18) || (h.dateKey === nextKey && h.hour < 6));
    const dayRep = dayPart.length ? worstHour(dayPart, (h) => Math.abs(h.hour - 13)) : null;
    const nightRep = nightPart.length ? worstHour(nightPart, (h) => Math.min(h.hour, 24 - h.hour)) : null;

    const makePeriod = (hs: HourState[], rep: HourState, isDay: boolean, name: string, startMs: number, endMs: number): ForecastPeriod => {
      const st = statsFor(hs, isDay);
      return {
        name,
        startTime: iso(startMs),
        endTime: iso(endMs),
        isDaytime: isDay,
        tempC: round1(fToC(st.tempF)),
        precipChancePct: Math.round(st.chance / 10) * 10,
        windText: windText(st.windMph, st.dirDeg),
        shortForecast: rep.short,
        detailedForecast: detailedForecast(st),
        icon: rep.icon,
      };
    };

    const weekday = weekdayOfKey(key, 'long');
    let day: ForecastPeriod | null = null;
    let night: ForecastPeriod | null = null;
    if (nws) {
      const dayStart = zonedToMs(key, 6, 0, tz);
      const dayEnd = zonedToMs(key, 18, 0, tz);
      const nightEnd = zonedToMs(nextKey, 6, 0, tz);
      const todayEvening = d === 0 && nowHour >= 18;
      if (dayRep && !todayEvening) {
        const name = d === 0 ? (nowHour < 12 ? 'Today' : 'This Afternoon') : weekday;
        day = makePeriod(dayPart, dayRep, true, name, d === 0 ? Math.max(dayStart, ctx.hourStart) : dayStart, dayEnd);
      }
      if (nightRep) {
        night = makePeriod(nightPart, nightRep, false, d === 0 ? 'Tonight' : `${weekday} Night`, zonedToMs(key, 18, 0, tz), nightEnd);
      }
    }

    const repForIcon = day && dayRep ? dayRep : nightRep ?? dayRep ?? dayHours[0];
    const iconRep = !nws && dayRep ? dayRep : repForIcon;
    const isDaytimeIcon = day !== null || (!nws && dayRep !== null);

    return {
      date: key,
      source: nws ? 'nws' : 'gfs',
      highC: round1(fToC(highF)),
      lowC: round1(fToC(lowF)),
      feelsLikeHighC: round1(fToC(Math.max(...dayHours.map((h) => h.feelsF)))),
      feelsLikeLowC: round1(fToC(Math.min(...dayHours.map((h) => h.feelsF)))),
      precipChancePct: Math.round(Math.max(...dayHours.map((h) => h.chance)) / 10) * 10,
      precipMm: round1(sum(dayHours.map((h) => h.precipMm))),
      snowMm: round1(sum(dayHours.map((h) => h.snowMm))),
      windKph: Math.round(Math.max(...dayHours.map((h) => h.windKph))),
      windGustKph: Math.round(Math.max(...dayHours.map((h) => h.gustKph))),
      uvIndexMax: sc.omitUv ? null : round1(Math.max(...dayHours.map((h) => h.uv))),
      aqiMax: aqis.length ? Math.max(...aqis) : null,
      icon: iconRep.icon,
      isDaytimeIcon,
      summary: iconRep.short,
      day,
      night,
      sunrise: iso(sunrise),
      sunset: iso(sunset),
    };
  });

  // ---- current conditions: the model at "now", reported by a nearby station a few minutes ago
  const idx = clamp(Math.floor((now - series[0].t) / HOUR_MS), 0, series.length - 1);
  const h = series[idx];
  const obsTempF = h.tF + 0.4;
  const obsTempC = round1(fToC(obsTempF));
  const mph = h.windKph / 1.609344;
  let feelsF = obsTempF;
  let feelsKind: FeelsLikeKind = 'actual';
  if (obsTempF >= 80) {
    feelsF = heatIndexF(obsTempF, h.rh);
    feelsKind = 'heat-index';
  } else if (obsTempF <= 50 && mph >= 3) {
    feelsF = windChillF(obsTempF, mph);
    feelsKind = 'wind-chill';
  }
  const current: CurrentConditions = {
    source: 'observation',
    observedAt: iso(now - 9 * 60_000),
    stationId: sc.station.id,
    stationName: sc.station.name,
    description: h.short.replace(/^Slight Chance /, '').replace(/^Chance /, ''),
    icon: h.icon,
    isDaytime: h.isDay,
    tempC: obsTempC,
    feelsLikeC: round1(fToC(feelsF)),
    feelsLikeKind: feelsKind,
    dewpointC: round1(fToC(h.dewF)),
    humidityPct: Math.round(h.rh),
    windKph: Math.round(h.windKph),
    windGustKph: h.gustKph - h.windKph >= 9 ? Math.round(h.gustKph) : null,
    windDirDeg: Math.round(h.dir / 10) * 10 % 360,
    pressurePa: sc.pressurePa,
    visibilityM: h.chance >= 70 ? 6400 : sc.visibilityM,
  };

  const todaySrSs = { sr: zonedToMs(dayKeys[0], sc.sunrise[0], sc.sunrise[1], tz), ss: zonedToMs(dayKeys[0], sc.sunset[0], sc.sunset[1], tz) };
  const sun = {
    sunrise: iso(todaySrSs.sr),
    sunset: iso(todaySrSs.ss),
    solarNoon: iso(Math.round((todaySrSs.sr + todaySrSs.ss) / 2)),
    civilDawn: iso(todaySrSs.sr - 28 * 60_000),
    civilDusk: iso(todaySrSs.ss + 28 * 60_000),
    daylightMinutes: Math.round((todaySrSs.ss - todaySrSs.sr) / 60_000),
  };

  return {
    place: sc.place,
    point: sc.point,
    fetchedAt: iso(now - 4 * 60_000),
    forecastUpdatedAt: iso(now - 38 * 60_000),
    current,
    hourly,
    daily,
    sun,
    airNow: sc.airNow(ctx),
    airForecast: sc.airForecast(
      ctx,
      daily.map((d) => d.aqiMax),
    ),
    alerts: sc.alerts(ctx),
    problems: sc.problems ?? [],
  };
}
