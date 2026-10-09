/** Forecast prose in the NWS house style, generated from numbers so the mock text always matches the mock data. */
import { dir16, dirWord, clamp } from './model';

export interface PeriodStats {
  isDay: boolean;
  /** Air temperature extreme for the period in °F (high for day, low for night). */
  tempF: number;
  cloud: number;
  chance: number;
  thunder: number;
  /** Total liquid-equivalent precipitation, inches. */
  rainIn: number;
  /** Total snowfall, inches. */
  snowIn: number;
  windMph: number;
  gustMph: number;
  dirDeg: number;
  /** Heat index maximum / wind chill minimum over the period, °F (null when not applicable). */
  heatIndexF: number | null;
  windChillF: number | null;
  snowy: boolean;
  /** Hour (0-23) of peak precipitation chance, for "mainly after 3pm". */
  peakHour: number;
  severe: boolean;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function skyWord(cloud: number, isDay: boolean): string {
  if (cloud < 12) return isDay ? 'Sunny' : 'Clear';
  if (cloud < 32) return isDay ? 'Mostly sunny' : 'Mostly clear';
  if (cloud < 58) return isDay ? 'Partly sunny' : 'Partly cloudy';
  if (cloud < 83) return 'Mostly cloudy';
  return 'Cloudy';
}

/** "10 to 15 mph" style range, NWS rounding (steps of 5). */
export function windRange(mph: number): string {
  if (mph < 3) return 'calm';
  if (mph < 6) return 'around 5 mph';
  const lo = Math.floor(mph / 5) * 5;
  return `${lo} to ${lo + 5} mph`;
}

export function windText(mph: number, deg: number): string {
  const r = windRange(mph);
  return r === 'calm' ? 'Calm' : `${dir16(deg)} ${r}`;
}

function hourWord(h: number): string {
  const suffix = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

function rainAmount(inches: number): string | null {
  if (inches < 0.04) return null;
  if (inches < 0.12) return 'New rainfall amounts less than a tenth of an inch possible.';
  if (inches < 0.3) return 'New rainfall amounts between a tenth and quarter of an inch possible.';
  if (inches < 0.6) return 'New rainfall amounts between a quarter and half of an inch possible, except higher amounts possible in thunderstorms.';
  if (inches < 1.1) return 'New rainfall amounts between a half and three quarters of an inch possible, except higher amounts possible in thunderstorms.';
  return 'New rainfall amounts between one and two inches possible, except higher amounts possible in thunderstorms.';
}

function snowAmount(inches: number): string | null {
  if (inches < 0.3) return null;
  if (inches < 1) return 'Little or no snow accumulation expected.';
  const lo = Math.max(1, Math.round(inches * 0.6));
  const hi = Math.max(lo + 1, Math.round(inches * 1.25));
  return `New snow accumulation of ${lo} to ${hi} inches possible.`;
}

/** The forecaster's detailedForecast for one day or night period. */
export function detailedForecast(s: PeriodStats): string {
  const out: string[] = [];
  const chance = Math.round(s.chance / 10) * 10;
  const likely = s.chance >= 60;
  const thundery = s.thunder >= 30 && !s.snowy;

  if (s.chance >= 20) {
    const when = s.isDay
      ? s.peakHour >= 12
        ? `, mainly after ${hourWord(Math.max(12, s.peakHour - 2))}`
        : `, mainly before ${hourWord(Math.min(12, s.peakHour + 3))}`
      : s.peakHour >= 18 || s.peakHour <= 1
        ? ', mainly before midnight'
        : `, mainly after ${hourWord(Math.max(1, s.peakHour - 1))}`;
    if (thundery) {
      out.push(`${likely ? 'Showers and thunderstorms likely' : s.chance >= 40 ? 'A chance of showers and thunderstorms' : 'A slight chance of showers and thunderstorms'}${when}.`);
      if (s.severe || (s.thunder >= 55 && s.chance >= 50)) out.push('Some storms could be severe, with damaging winds and large hail possible.');
    } else if (s.snowy) {
      out.push(`${likely ? 'Snow likely' : s.chance >= 40 ? 'A chance of snow showers' : 'A slight chance of snow showers'}${when}.`);
    } else {
      out.push(`${likely ? 'Rain likely' : s.chance >= 40 ? 'A chance of rain showers' : 'A slight chance of rain showers'}${when}.`);
    }
  }

  const sky = skyWord(s.cloud, s.isDay);
  const t = Math.round(s.tempF);
  if (s.isDay) {
    out.push(`${s.chance >= 60 && s.cloud >= 83 ? 'Cloudy' : sky}, with a high near ${t}.`);
  } else {
    out.push(`${s.chance >= 60 && s.cloud >= 83 ? 'Cloudy' : sky}, with a low around ${t}.`);
  }

  if (s.heatIndexF !== null && s.heatIndexF >= 95) out.push(`Heat index values as high as ${Math.round(s.heatIndexF)}.`);
  if (s.windChillF !== null && s.windChillF <= 5) out.push(`Wind chill values as low as ${Math.round(s.windChillF)}.`);

  const range = windRange(s.windMph);
  if (range === 'calm') {
    out.push('Calm wind.');
  } else {
    const gust = s.gustMph >= s.windMph + 8 ? `, with gusts as high as ${Math.round(s.gustMph / 5) * 5} mph` : '';
    out.push(`${cap(dirWord(s.dirDeg).toLowerCase())} wind ${range}${gust}.`);
  }

  if (s.chance >= 20) out.push(`Chance of precipitation is ${clamp(chance, 20, 100)}%.`);
  const amount = s.snowy ? snowAmount(s.snowIn) : rainAmount(s.rainIn);
  if (amount && s.chance >= 30) out.push(amount);
  return out.join(' ');
}

/** "Showers And Thunderstorms Likely" style short forecast. */
export function titleCaseWords(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
