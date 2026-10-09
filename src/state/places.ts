import { useSyncExternalStore } from 'react';
import { GPS_PLACE_ID, placeIdFor } from '../data/types';
import type { Place } from '../data/types';
import { createStore } from './storage';

export interface PlacesState {
  /** Places the user starred, in the order they were added. */
  saved: Place[];
  /** The place currently shown (may be saved, a search result, or the GPS place). null = first run. */
  selected: Place | null;
  /** Last device location fix. Kept so the app can show cached weather instantly after a restart. */
  gps: Place | null;
}

/** localStorage key owned by the UI. "Clear cached data" must leave it alone. */
export const PLACES_KEY = 'nwsw.places';

export const MAX_SAVED_PLACES = 12;
export const GPS_DEFAULT_NAME = 'Current location';

const EMPTY: PlacesState = { saved: [], selected: null, gps: null };

function parsePlace(raw: unknown): Place | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const { id, name, lat, lon, kind } = o;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (kind !== 'gps' && kind !== 'saved' && kind !== 'search') return null;
  return { id, name: name.slice(0, 120), lat, lon, kind };
}

export function parsePlaces(raw: unknown): PlacesState {
  if (raw === null || typeof raw !== 'object') return EMPTY;
  const o = raw as Record<string, unknown>;
  const saved: Place[] = [];
  if (Array.isArray(o.saved)) {
    for (const item of o.saved) {
      const p = parsePlace(item);
      if (p && !saved.some((s) => s.id === p.id)) saved.push({ ...p, kind: 'saved' });
    }
  }
  return {
    saved: saved.slice(0, MAX_SAVED_PLACES),
    selected: parsePlace(o.selected),
    gps: parsePlace(o.gps),
  };
}

export const placesStore = createStore<PlacesState>(PLACES_KEY, parsePlaces);

export function usePlaces(): PlacesState {
  return useSyncExternalStore(placesStore.subscribe, placesStore.get, placesStore.get);
}

/** Show a place (a saved one, a search result, or the GPS place). */
export function selectPlace(place: Place): void {
  placesStore.set((s) => {
    const saved = s.saved.find((p) => p.id === place.id);
    return { ...s, selected: saved ?? place, gps: place.kind === 'gps' ? place : s.gps };
  });
}

/** Use the device location. The name is replaced with the city and state once the forecast loads. */
export function selectGps(lat: number, lon: number): void {
  const previous = placesStore.get().gps;
  const keepName = previous && Math.abs(previous.lat - lat) < 0.02 && Math.abs(previous.lon - lon) < 0.02;
  const gps: Place = {
    id: GPS_PLACE_ID,
    name: keepName ? previous.name : GPS_DEFAULT_NAME,
    lat,
    lon,
    kind: 'gps',
  };
  placesStore.set((s) => ({ ...s, gps, selected: gps }));
}

/** Give the GPS place a human name (called when the forecast reveals the nearest city). */
export function setGpsName(name: string): void {
  const s = placesStore.get();
  if (!s.gps || s.gps.name === name) return;
  const gps = { ...s.gps, name };
  placesStore.set({ ...s, gps, selected: s.selected?.id === GPS_PLACE_ID ? gps : s.selected });
}

/**
 * Star a place. A GPS place is saved as a regular place at those coordinates (it would otherwise
 * follow the device around), named after the nearest city.
 */
export function savePlace(place: Place, nameOverride?: string): Place {
  const isGps = place.kind === 'gps' || place.id === GPS_PLACE_ID;
  const saved: Place = {
    id: isGps ? placeIdFor(place.lat, place.lon) : place.id,
    name: (nameOverride ?? place.name).trim() || place.name,
    lat: place.lat,
    lon: place.lon,
    kind: 'saved',
  };
  placesStore.set((s) => {
    if (s.saved.some((p) => p.id === saved.id)) return s;
    const savedList = [...s.saved, saved].slice(-MAX_SAVED_PLACES);
    const selected = s.selected && (s.selected.id === place.id || s.selected.id === saved.id) ? saved : s.selected;
    return { ...s, saved: savedList, selected };
  });
  return saved;
}

export function removePlace(id: string): void {
  placesStore.set((s) => {
    const saved = s.saved.filter((p) => p.id !== id);
    let selected = s.selected;
    if (selected?.id === id) selected = s.gps ?? saved[0] ?? null;
    return { ...s, saved, selected };
  });
}

export function isSaved(state: PlacesState, place: Place | null): boolean {
  if (!place) return false;
  const id = place.kind === 'gps' ? placeIdFor(place.lat, place.lon) : place.id;
  return state.saved.some((p) => p.id === id);
}
