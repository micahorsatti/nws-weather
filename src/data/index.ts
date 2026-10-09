/**
 * Public API of the data layer. The UI imports ONLY from this file and ./types.
 * The data agent replaces these stubs with real implementations (same signatures).
 */
import type { ForecastDiscussion, Place, WeatherBundle, WeatherState } from './types';

export * from './types';

export interface LoadOptions {
  /** User's EPA AirNow key from settings; when absent, AQI comes from Open-Meteo. */
  airNowKey?: string;
  signal?: AbortSignal;
}

/** Fetch every source for a place and assemble a WeatherBundle. Throws WeatherLoadError when nothing usable comes back. */
export async function loadWeather(_place: Place, _opts: LoadOptions = {}): Promise<WeatherBundle> {
  throw new Error('loadWeather: not implemented yet');
}

/**
 * React hook: stale-while-revalidate weather for a place.
 * Restores the last bundle for the place from storage immediately, then refreshes from the network.
 * Auto-refreshes every 10 minutes while the page is visible, and when the app returns to the
 * foreground with data older than 5 minutes.
 */
export function useWeather(_place: Place | null, _opts: { airNowKey?: string } = {}): WeatherState {
  throw new Error('useWeather: not implemented yet');
}

/** Search US places by city name or ZIP code. */
export async function searchPlaces(_query: string, _signal?: AbortSignal): Promise<Place[]> {
  throw new Error('searchPlaces: not implemented yet');
}

/** Device location via the Geolocation API; rejects with a friendly Error message. */
export async function getCurrentPosition(): Promise<{ lat: number; lon: number; accuracyM: number }> {
  throw new Error('getCurrentPosition: not implemented yet');
}

/** Latest NWS Area Forecast Discussion for a forecast office (e.g. "TOP"). */
export async function loadForecastDiscussion(_wfo: string, _signal?: AbortSignal): Promise<ForecastDiscussion> {
  throw new Error('loadForecastDiscussion: not implemented yet');
}
