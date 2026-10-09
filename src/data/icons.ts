/**
 * Condition icons: NWS icon URLs, Open-Meteo WMO weather codes and plain forecast text all map to
 * the app's WxIcon vocabulary (src/data/types.ts).
 */
import type { WxIcon } from './types';

/** NWS icon codes (https://api.weather.gov/icons) -> WxIcon. */
const NWS_CODE_ICON: Record<string, WxIcon> = {
  skc: 'clear',
  few: 'mostly-clear',
  sct: 'partly-cloudy',
  bkn: 'mostly-cloudy',
  ovc: 'cloudy',
  wind_skc: 'wind',
  wind_few: 'wind',
  wind_sct: 'wind',
  wind_bkn: 'wind',
  wind_ovc: 'wind',
  snow: 'snow',
  rain_snow: 'rain-snow',
  rain_sleet: 'sleet',
  snow_sleet: 'sleet',
  fzra: 'freezing-rain',
  rain_fzra: 'freezing-rain',
  snow_fzra: 'freezing-rain',
  sleet: 'sleet',
  rain: 'rain',
  rain_showers: 'rain-showers',
  rain_showers_hi: 'rain-showers',
  tsra: 'thunderstorm',
  tsra_sct: 'thunderstorm',
  tsra_hi: 'thunderstorm',
  tornado: 'tornado',
  hurricane: 'hurricane',
  tropical_storm: 'tropical-storm',
  dust: 'dust',
  smoke: 'smoke',
  haze: 'haze',
  hot: 'hot',
  cold: 'cold',
  blizzard: 'blizzard',
  fog: 'fog',
};

/** Higher = more significant; used to pick one icon when NWS gives two codes for a period. */
const SIGNIFICANCE: Record<WxIcon, number> = {
  unknown: 0,
  clear: 1,
  'mostly-clear': 2,
  'partly-cloudy': 3,
  'mostly-cloudy': 4,
  cloudy: 5,
  wind: 6,
  hot: 7,
  cold: 7,
  haze: 8,
  smoke: 9,
  dust: 9,
  fog: 10,
  drizzle: 11,
  'rain-showers': 12,
  'snow-showers': 12,
  rain: 13,
  snow: 14,
  sleet: 15,
  'rain-snow': 15,
  'freezing-rain': 16,
  'heavy-rain': 17,
  'heavy-snow': 18,
  thunderstorm: 20,
  'severe-thunderstorm': 21,
  blizzard: 22,
  'tropical-storm': 23,
  tornado: 25,
  hurricane: 26,
};

export function mostSignificant(icons: WxIcon[]): WxIcon {
  let best: WxIcon = 'unknown';
  for (const icon of icons) if (SIGNIFICANCE[icon] > SIGNIFICANCE[best]) best = icon;
  return best;
}

export interface ParsedNwsIcon {
  /** null when the URL has no day/night segment. */
  isDaytime: boolean | null;
  /** One or two NWS codes, e.g. ["tsra_hi", "ovc"]. */
  codes: string[];
}

/**
 * https://api.weather.gov/icons/land/{day|night}/{code}[,{pop}][/{code2}[,{pop2}]]?size=medium
 */
export function parseNwsIconUrl(url: unknown): ParsedNwsIcon | null {
  if (typeof url !== 'string') return null;
  const m = /\/icons\/(?:land|sea|ocean)\/(day|night)\/([^?#]+)/i.exec(url);
  if (!m) return null;
  const codes = m[2]
    .split('/')
    .map((seg) => seg.split(',')[0].toLowerCase().replace(/\.(png|jpe?g|gif)$/, ''))
    .filter((c) => c.length > 0);
  if (codes.length === 0) return null;
  return { isDaytime: m[1].toLowerCase() === 'day', codes };
}

/** Icon for a single NWS code, or 'unknown'. */
export function iconFromNwsCode(code: string): WxIcon {
  return NWS_CODE_ICON[code.toLowerCase()] ?? 'unknown';
}

/** WxIcon (+ day/night) for an NWS icon URL; null if the URL isn't an NWS icon or has no known code. */
export function iconFromNwsUrl(url: unknown): { icon: WxIcon; isDaytime: boolean | null } | null {
  const parsed = parseNwsIconUrl(url);
  if (!parsed) return null;
  const icon = mostSignificant(parsed.codes.map(iconFromNwsCode));
  return icon === 'unknown' ? null : { icon, isDaytime: parsed.isDaytime };
}

/** Keyword matching on forecast / observation text ("Chance Showers And Thunderstorms", "Mostly Clear"). */
export function iconFromText(text: unknown): WxIcon {
  if (typeof text !== 'string') return 'unknown';
  const t = text.toLowerCase();
  if (t.trim() === '') return 'unknown';
  if (/tornado/.test(t)) return 'tornado';
  if (/hurricane/.test(t)) return 'hurricane';
  if (/tropical storm/.test(t)) return 'tropical-storm';
  if (/blizzard/.test(t)) return 'blizzard';
  if (/thunder|t-storm/.test(t)) return /severe/.test(t) ? 'severe-thunderstorm' : 'thunderstorm';
  if (/freezing rain|freezing drizzle|ice storm/.test(t)) return 'freezing-rain';
  if (/sleet|ice pellets/.test(t)) return 'sleet';
  if (/wintry mix|rain and snow|snow and rain|rain\/snow|snow\/rain|rain or snow|snow or rain/.test(t)) return 'rain-snow';
  if (/heavy snow/.test(t)) return 'heavy-snow';
  if (/snow shower|flurr/.test(t)) return 'snow-showers';
  if (/snow/.test(t)) return 'snow';
  if (/heavy rain|torrential/.test(t)) return 'heavy-rain';
  if (/drizzle/.test(t)) return 'drizzle';
  if (/shower/.test(t)) return 'rain-showers';
  if (/rain/.test(t)) return 'rain';
  if (/fog|\bmist\b/.test(t)) return 'fog';
  if (/smoke/.test(t)) return 'smoke';
  if (/haze|hazy/.test(t)) return 'haze';
  if (/dust|sand/.test(t)) return 'dust';
  if (/mostly cloudy|considerable cloud|increasing clouds|becoming cloudy/.test(t)) return 'mostly-cloudy';
  if (/partly (cloudy|sunny)|decreasing clouds|partial clearing/.test(t)) return 'partly-cloudy';
  if (/mostly (sunny|clear)|a few clouds|few clouds/.test(t)) return 'mostly-clear';
  if (/overcast|cloudy/.test(t)) return 'cloudy';
  if (/sunny|clear|\bfair\b/.test(t)) return 'clear';
  if (/windy|breezy|blustery/.test(t)) return 'wind';
  if (/\bhot\b/.test(t)) return 'hot';
  if (/\bcold\b|frigid/.test(t)) return 'cold';
  return 'unknown';
}

/** NWS codes carry no intensity; the text ("Heavy Rain", "Snow Showers") sharpens the icon. */
export function refineIconWithText(icon: WxIcon, text: unknown): WxIcon {
  if (typeof text !== 'string') return icon;
  const t = text.toLowerCase();
  switch (icon) {
    case 'rain':
    case 'rain-showers':
      if (/heavy rain|torrential/.test(t)) return 'heavy-rain';
      if (icon === 'rain' && /drizzle/.test(t) && !/\brain\b/.test(t)) return 'drizzle';
      return icon;
    case 'snow':
      if (/heavy snow/.test(t)) return 'heavy-snow';
      if (/snow shower|flurr/.test(t)) return 'snow-showers';
      return icon;
    case 'thunderstorm':
      return /severe/.test(t) ? 'severe-thunderstorm' : icon;
    default:
      return icon;
  }
}

/** Best icon from an NWS icon URL (preferred) and/or description text. */
export function resolveIcon(input: { url?: unknown; text?: unknown }): { icon: WxIcon; isDaytime: boolean | null } {
  const fromUrl = iconFromNwsUrl(input.url);
  if (fromUrl) return { icon: refineIconWithText(fromUrl.icon, input.text), isDaytime: fromUrl.isDaytime };
  const dayNight = parseNwsIconUrl(input.url)?.isDaytime ?? null;
  return { icon: iconFromText(input.text), isDaytime: dayNight };
}

/** Open-Meteo / WMO weather interpretation codes (0-99). */
export function iconFromWmo(code: number | null | undefined): WxIcon {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'unknown';
  switch (Math.round(code)) {
    case 0:
      return 'clear';
    case 1:
      return 'mostly-clear';
    case 2:
      return 'partly-cloudy';
    case 3:
      return 'cloudy';
    case 45:
    case 48:
      return 'fog';
    case 51:
    case 53:
    case 55:
      return 'drizzle';
    case 56:
    case 57:
    case 66:
    case 67:
      return 'freezing-rain';
    case 61:
    case 63:
      return 'rain';
    case 65:
      return 'heavy-rain';
    case 71:
    case 73:
    case 77:
      return 'snow';
    case 75:
      return 'heavy-snow';
    case 80:
    case 81:
      return 'rain-showers';
    case 82:
      return 'heavy-rain';
    case 85:
    case 86:
      return 'snow-showers';
    case 95:
      return 'thunderstorm';
    case 96:
    case 99:
      return 'severe-thunderstorm';
    default:
      return 'unknown';
  }
}

const WMO_TEXT: Record<number, string> = {
  45: 'Fog',
  48: 'Freezing Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  56: 'Light Freezing Drizzle',
  57: 'Freezing Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  66: 'Light Freezing Rain',
  67: 'Freezing Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Light Rain Showers',
  81: 'Rain Showers',
  82: 'Heavy Rain Showers',
  85: 'Light Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms With Hail',
  99: 'Thunderstorms With Heavy Hail',
};

/** NWS-style one-line label for an icon: Sunny/Mostly Sunny by day, Clear/Mostly Clear at night. */
export function describeIcon(icon: WxIcon, isDaytime = true): string {
  switch (icon) {
    case 'clear':
      return isDaytime ? 'Sunny' : 'Clear';
    case 'mostly-clear':
      return isDaytime ? 'Mostly Sunny' : 'Mostly Clear';
    case 'partly-cloudy':
      return isDaytime ? 'Partly Sunny' : 'Partly Cloudy';
    case 'mostly-cloudy':
      return 'Mostly Cloudy';
    case 'cloudy':
      return 'Cloudy';
    case 'fog':
      return 'Fog';
    case 'haze':
      return 'Haze';
    case 'smoke':
      return 'Smoke';
    case 'dust':
      return 'Dust';
    case 'wind':
      return 'Windy';
    case 'drizzle':
      return 'Drizzle';
    case 'rain-showers':
      return 'Rain Showers';
    case 'rain':
      return 'Rain';
    case 'heavy-rain':
      return 'Heavy Rain';
    case 'thunderstorm':
      return 'Thunderstorms';
    case 'severe-thunderstorm':
      return 'Severe Thunderstorms';
    case 'snow-showers':
      return 'Snow Showers';
    case 'snow':
      return 'Snow';
    case 'heavy-snow':
      return 'Heavy Snow';
    case 'blizzard':
      return 'Blizzard';
    case 'sleet':
      return 'Sleet';
    case 'freezing-rain':
      return 'Freezing Rain';
    case 'rain-snow':
      return 'Rain And Snow';
    case 'hot':
      return 'Hot';
    case 'cold':
      return 'Cold';
    case 'tornado':
      return 'Tornado';
    case 'tropical-storm':
      return 'Tropical Storm';
    case 'hurricane':
      return 'Hurricane';
    default:
      return '';
  }
}

/** Description for a WMO weather code (daytime wording by default). */
export function describeWmo(code: number | null | undefined, isDaytime = true): string {
  if (typeof code !== 'number' || !Number.isFinite(code)) return '';
  const rounded = Math.round(code);
  return WMO_TEXT[rounded] ?? describeIcon(iconFromWmo(rounded), isDaytime);
}
