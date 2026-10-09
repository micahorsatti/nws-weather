/**
 * Mock WeatherBundles for development, screenshots and tests. Loaded only in dev (`?mock=summer` or
 * `?mock=winter`); the production build never imports this module.
 */
import type { ForecastDiscussion, WeatherBundle } from '../data/types';
import { generateBundle, makeContext, MOCK_NAMES } from './generate';
import type { MockName } from './generate';
import { SUMMER, WINTER } from './scenarios';

export { MOCK_NAMES };
export type { MockName };

const SCENARIOS = { summer: SUMMER, winter: WINTER } as const;

export function isMockName(value: string | null | undefined): value is MockName {
  return value === 'summer' || value === 'winter';
}

/** A fresh bundle whose hourly series starts at the current hour of `now`. */
export function getMockBundle(name: MockName, now: number = Date.now()): WeatherBundle {
  return generateBundle(SCENARIOS[name], now);
}

/** Stand-in for loadForecastDiscussion() while a mock is active. */
export async function getMockDiscussion(name: MockName, now: number = Date.now()): Promise<ForecastDiscussion> {
  const sc = SCENARIOS[name];
  return sc.discussion(makeContext(sc, now));
}

export { generateBundle, SUMMER, WINTER };
