import { useSyncExternalStore } from 'react';
import type { UnitSystem } from '../lib/units';
import { createStore } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  units: UnitSystem;
  theme: ThemePref;
  /** EPA AirNow API key. Stays on this device; only ever sent to AirNow by the data layer. */
  airNowKey: string;
}

export const DEFAULT_SETTINGS: Settings = { units: 'imperial', theme: 'system', airNowKey: '' };

/** localStorage keys owned by the UI. "Clear cached data" must leave these alone. */
export const SETTINGS_KEY = 'nwsw.settings';

/** Validate whatever was stored; anything unexpected falls back to the default for that field. */
export function parseSettings(raw: unknown): Settings {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    units: o.units === 'metric' ? 'metric' : 'imperial',
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : 'system',
    airNowKey: typeof o.airNowKey === 'string' ? o.airNowKey.replace(/\s+/g, '').slice(0, 80) : '',
  };
}

export const settingsStore = createStore<Settings>(SETTINGS_KEY, parseSettings);

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((prev) => parseSettings({ ...prev, ...patch }));
}
