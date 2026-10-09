import type { WxIcon } from '../../data/types';

/**
 * Hero sky gradients by condition and day/night. White text sits on top of every one of them, so every
 * stop is verified to reach 4.5:1 contrast with white (see sky.test.ts), including the lighter bottom stop.
 */
export type SkyKey =
  | 'clear-day'
  | 'clear-night'
  | 'partly-day'
  | 'partly-night'
  | 'cloudy-day'
  | 'cloudy-night'
  | 'rain-day'
  | 'rain-night'
  | 'storm'
  | 'snow-day'
  | 'snow-night'
  | 'fog'
  | 'haze'
  | 'smoke'
  | 'wind'
  | 'hot'
  | 'cold';

export type SkyDecor = 'sun' | 'stars' | 'rain' | 'snow' | 'none';

export interface Sky {
  top: string;
  bottom: string;
  decor: SkyDecor;
}

export const SKIES: Record<SkyKey, Sky> = {
  'clear-day': { top: '#1757b0', bottom: '#2a72cc', decor: 'sun' },
  'clear-night': { top: '#0b1736', bottom: '#1f3a73', decor: 'stars' },
  'partly-day': { top: '#255fa8', bottom: '#3a76b6', decor: 'sun' },
  'partly-night': { top: '#12214a', bottom: '#34508a', decor: 'stars' },
  'cloudy-day': { top: '#3d4e66', bottom: '#5d6f87', decor: 'none' },
  'cloudy-night': { top: '#1b2536', bottom: '#3a475c', decor: 'none' },
  'rain-day': { top: '#2a4260', bottom: '#4d6683', decor: 'rain' },
  'rain-night': { top: '#141d2e', bottom: '#2d3d57', decor: 'rain' },
  storm: { top: '#23283f', bottom: '#4b4f73', decor: 'rain' },
  'snow-day': { top: '#456689', bottom: '#56759a', decor: 'snow' },
  'snow-night': { top: '#1f2e47', bottom: '#4a6286', decor: 'snow' },
  fog: { top: '#4d5d72', bottom: '#62728a', decor: 'none' },
  haze: { top: '#7d5f33', bottom: '#8e6f3a', decor: 'none' },
  smoke: { top: '#625246', bottom: '#7d6a5c', decor: 'none' },
  wind: { top: '#27607f', bottom: '#337c9b', decor: 'none' },
  hot: { top: '#a63f1b', bottom: '#b9551d', decor: 'sun' },
  cold: { top: '#2552a0', bottom: '#3b6bb2', decor: 'snow' },
};

export function skyKey(icon: WxIcon, isDay: boolean): SkyKey {
  switch (icon) {
    case 'clear':
    case 'mostly-clear':
      return isDay ? 'clear-day' : 'clear-night';
    case 'partly-cloudy':
      return isDay ? 'partly-day' : 'partly-night';
    case 'mostly-cloudy':
    case 'cloudy':
      return isDay ? 'cloudy-day' : 'cloudy-night';
    case 'fog':
      return 'fog';
    case 'haze':
      return isDay ? 'haze' : 'cloudy-night';
    case 'smoke':
    case 'dust':
      return 'smoke';
    case 'wind':
      return isDay ? 'wind' : 'cloudy-night';
    case 'drizzle':
    case 'rain-showers':
    case 'rain':
    case 'heavy-rain':
    case 'freezing-rain':
    case 'sleet':
    case 'rain-snow':
      return isDay ? 'rain-day' : 'rain-night';
    case 'thunderstorm':
    case 'severe-thunderstorm':
    case 'tornado':
    case 'tropical-storm':
    case 'hurricane':
      return 'storm';
    case 'snow-showers':
    case 'snow':
    case 'heavy-snow':
    case 'blizzard':
      return isDay ? 'snow-day' : 'snow-night';
    case 'hot':
      return 'hot';
    case 'cold':
      return 'cold';
    default:
      return isDay ? 'cloudy-day' : 'cloudy-night';
  }
}

export function skyFor(icon: WxIcon, isDay: boolean): Sky & { key: SkyKey } {
  const key = skyKey(icon, isDay);
  return { key, ...SKIES[key] };
}
