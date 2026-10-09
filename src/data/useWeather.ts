/**
 * useWeather: stale-while-revalidate weather for a place.
 *  - restores the last good bundle for the place from the on-device cache immediately (status 'ready',
 *    fromCache true), then fetches (refreshing true); with no cache the status is 'loading'
 *  - a failed refresh keeps the bundle and sets `error`; a failed first load is status 'error'
 *  - refreshes every 10 minutes while the page is visible, and on returning to the foreground / coming
 *    back online when the data is older than 5 minutes
 *  - aborts the in-flight request when the place changes or the component unmounts, and shares one request
 *    between effect re-runs (React StrictMode mounts, unmounts and re-mounts every effect in development)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadWeather } from './assemble';
import { loadCachedBundleFor, saveBundle } from './cache';
import { isAbortError, toLoadError } from './http';
import type { Place, WeatherBundle, WeatherLoadError, WeatherState, WeatherStatus } from './types';

export const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
export const STALE_AFTER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// One shared in-flight request per (place, key): the second effect run of a StrictMode mount joins
// the request the first run started instead of starting another. The request is aborted only once
// every subscriber has let go (checked a tick later, so a quick unsubscribe/resubscribe doesn't abort).

interface Shared {
  promise: Promise<WeatherBundle>;
  controller: AbortController;
  refs: number;
}

const inflight = new Map<string, Shared>();

/** Cheap non-cryptographic hash so the AirNow key itself is never used as a map key. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function requestKey(place: Place, airNowKey: string | undefined): string {
  return `${place.id}|${place.lat.toFixed(4)},${place.lon.toFixed(4)}|${airNowKey ? fingerprint(airNowKey) : '-'}`;
}

interface Subscription {
  promise: Promise<WeatherBundle>;
  release(): void;
}

function acquire(place: Place, airNowKey: string | undefined): Subscription {
  const key = requestKey(place, airNowKey);
  let shared = inflight.get(key);
  if (!shared) {
    const controller = new AbortController();
    const created: Shared = {
      controller,
      refs: 0,
      promise: loadWeather(place, { airNowKey, signal: controller.signal }).finally(() => {
        if (inflight.get(key) === created) inflight.delete(key);
      }),
    };
    created.promise.catch(() => undefined); // subscribers handle failures; this just prevents "unhandled rejection" after an abort
    inflight.set(key, created);
    shared = created;
  }
  const entry = shared;
  entry.refs += 1;

  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      setTimeout(() => {
        if (entry.refs > 0) return;
        entry.controller.abort();
        if (inflight.get(key) === entry) inflight.delete(key);
      }, 0);
    },
  };
}

// ---------------------------------------------------------------------------------------------

interface Internal {
  /** Which place this state belongs to (null = no place). */
  key: string | null;
  bundle: WeatherBundle | null;
  status: WeatherStatus;
  refreshing: boolean;
  error: WeatherLoadError | null;
  fromCache: boolean;
}

const IDLE: Internal = { key: null, bundle: null, status: 'idle', refreshing: false, error: null, fromCache: false };

/** Identity of a place for fetching purposes: its id plus ~100 m of position (GPS jitter doesn't refetch). */
function placeKeyOf(place: Place | null): string | null {
  return place ? `${place.id}|${place.lat.toFixed(3)},${place.lon.toFixed(3)}` : null;
}

function initialFor(place: Place | null, key: string | null): Internal {
  if (!place || key === null) return IDLE;
  const cached = loadCachedBundleFor(place);
  return cached
    ? { key, bundle: cached, status: 'ready', refreshing: true, error: null, fromCache: true }
    : { key, bundle: null, status: 'loading', refreshing: false, error: null, fromCache: false };
}

function ageMs(bundle: WeatherBundle): number {
  const t = Date.parse(bundle.fetchedAt);
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

export function useWeather(place: Place | null, opts: { airNowKey?: string } = {}): WeatherState {
  const airNowKey = opts.airNowKey?.trim() || undefined;
  const key = placeKeyOf(place);

  const [state, setState] = useState<Internal>(() => initialFor(place, key));
  const stateRef = useRef(state);
  const placeRef = useRef(place);
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stateRef.current = state;
    placeRef.current = place;
  });

  // While the effect below hasn't yet switched `state` to a newly selected place, never show the old place's data.
  const fallback = useMemo(() => (state.key === key ? null : initialFor(place, key)), [state.key, key]);
  const view = fallback ?? state;

  useEffect(() => {
    const target = placeRef.current;
    if (!target || key === null) {
      setState(IDLE);
      refreshRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let subscription: Subscription | null = null;

    // Keep the data already on screen when only the AirNow key changed; start fresh for a new place.
    const start = stateRef.current.key === key ? stateRef.current : initialFor(target, key);
    let latest: WeatherBundle | null = start.bundle;
    setState((prev) => (prev.key === key ? prev : start));

    const run = (): void => {
      if (cancelled || subscription) return;
      const sub = acquire(target, airNowKey);
      subscription = sub;
      setState((prev) => {
        if (prev.key !== key) return prev;
        return prev.bundle ? { ...prev, refreshing: true } : { ...prev, status: 'loading', error: null };
      });
      sub.promise.then(
        (bundle) => {
          if (cancelled) return;
          subscription = null;
          latest = bundle;
          saveBundle(bundle);
          setState({ key, bundle, status: 'ready', refreshing: false, error: null, fromCache: false });
        },
        (err: unknown) => {
          if (cancelled) return;
          subscription = null;
          if (isAbortError(err)) {
            setState((prev) => (prev.key === key ? { ...prev, refreshing: false } : prev));
            return;
          }
          const error = toLoadError(err);
          setState((prev) =>
            prev.key !== key ? prev : { ...prev, refreshing: false, error, status: prev.bundle ? 'ready' : 'error' },
          );
        },
      );
    };

    const visible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';
    const stale = (): boolean => latest === null || ageMs(latest) > STALE_AFTER_MS;
    const onVisibility = (): void => {
      if (visible() && stale()) run();
    };
    const onOnline = (): void => {
      if (stale()) run();
    };

    run();
    const timer = setInterval(() => {
      if (visible()) run();
    }, REFRESH_INTERVAL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    refreshRef.current = run;

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      subscription?.release();
      subscription = null;
      if (refreshRef.current === run) refreshRef.current = null;
    };
  }, [key, airNowKey]);

  const refresh = useCallback((): void => {
    refreshRef.current?.();
  }, []);

  return {
    bundle: view.bundle,
    status: view.status,
    refreshing: view.refreshing,
    error: view.error,
    fromCache: view.fromCache,
    refresh,
  };
}
