/**
 * Public API of the data layer. The UI imports ONLY from this file.
 *
 *   loadWeather          fetch every source for a place and assemble a WeatherBundle   (assemble.ts)
 *   useWeather           React hook: cached-then-fresh weather with auto refresh      (useWeather.ts)
 *   searchPlaces         US place search by city or ZIP                               (geocode.ts)
 *   getCurrentPosition   device location                                              (geolocation.ts)
 *   loadForecastDiscussion  the forecasters' Area Forecast Discussion                 (nws/discussion.ts)
 */
export * from './types';

export { loadWeather } from './assemble';
export type { LoadOptions } from './assemble';
export { useWeather } from './useWeather';
export { searchPlaces } from './geocode';
export { getCurrentPosition } from './geolocation';
export { loadForecastDiscussion } from './nws/discussion';
