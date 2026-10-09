// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWeather } from './assemble';
import { clearAllCaches, loadCachedBundle, saveBundle } from './cache';
import { makeBundle } from './testing/builders';
import { WeatherLoadError, type Place, type WeatherBundle } from './types';
import { REFRESH_INTERVAL_MS, STALE_AFTER_MS, useWeather } from './useWeather';

vi.mock('./assemble', () => ({ loadWeather: vi.fn() }));
const loadMock = vi.mocked(loadWeather);

const LINN: Place = { id: '39.7456,-97.0892', name: 'Linn, KS', lat: 39.7456, lon: -97.0892, kind: 'saved' };
const PHX: Place = { id: '33.4484,-112.0740', name: 'Phoenix, AZ', lat: 33.4484, lon: -112.074, kind: 'saved' };

const bundleFor = (place: Place, fetchedAt = new Date().toISOString()): WeatherBundle => makeBundle(place, fetchedAt);

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (r: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let resolved promises and the state updates they trigger settle. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockReset();
  localStorage.clear();
  clearAllCaches();
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useWeather', () => {
  it('is idle, with nothing loaded, when there is no place', async () => {
    const { result } = renderHook(() => useWeather(null));
    await flush();
    expect(result.current).toMatchObject({ bundle: null, status: 'idle', refreshing: false, error: null, fromCache: false });
    expect(loadMock).not.toHaveBeenCalled();
    expect(() => result.current.refresh()).not.toThrow();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('loads when there is nothing cached: loading, then ready', async () => {
    const d = deferred<WeatherBundle>();
    loadMock.mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useWeather(LINN));
    expect(result.current).toMatchObject({ bundle: null, status: 'loading', refreshing: false, fromCache: false, error: null });

    const fresh = bundleFor(LINN);
    await act(async () => {
      d.resolve(fresh);
      await d.promise;
    });
    expect(result.current).toMatchObject({ bundle: fresh, status: 'ready', refreshing: false, fromCache: false, error: null });
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadCachedBundle(LINN.id)).toEqual(fresh); // saved for next time
  });

  it('shows the cached bundle immediately, marks it as cached and refreshing, then swaps in the fresh one', async () => {
    const stale = bundleFor(LINN, new Date(Date.now() - 3 * 3_600_000).toISOString());
    saveBundle(stale);
    const d = deferred<WeatherBundle>();
    loadMock.mockReturnValueOnce(d.promise);

    const { result } = renderHook(() => useWeather(LINN));
    expect(result.current).toMatchObject({ bundle: stale, status: 'ready', refreshing: true, fromCache: true, error: null });

    const fresh = bundleFor(LINN);
    await act(async () => {
      d.resolve(fresh);
      await d.promise;
    });
    expect(result.current).toMatchObject({ bundle: fresh, status: 'ready', refreshing: false, fromCache: false, error: null });
  });

  it('passes the place, the AirNow key and an abort signal to the loader', async () => {
    loadMock.mockResolvedValue(bundleFor(LINN));
    renderHook(() => useWeather(LINN, { airNowKey: 'abc123' }));
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(1);
    const [place, opts] = loadMock.mock.calls[0];
    expect(place).toBe(LINN);
    expect(opts?.airNowKey).toBe('abc123');
    expect(opts?.signal?.aborted).toBe(false);
  });

  it('treats a blank AirNow key as no key', async () => {
    loadMock.mockResolvedValue(bundleFor(LINN));
    renderHook(() => useWeather(LINN, { airNowKey: '   ' }));
    await flush();
    expect(loadMock.mock.calls[0][1]?.airNowKey).toBeUndefined();
  });

  describe('failures', () => {
    it('a failed first load is status "error" and can be retried with refresh()', async () => {
      loadMock.mockRejectedValueOnce(new WeatherLoadError('network', "Can't reach the weather service."));
      const { result } = renderHook(() => useWeather(LINN));
      await flush();
      expect(result.current.status).toBe('error');
      expect(result.current.bundle).toBeNull();
      expect(result.current.error).toBeInstanceOf(WeatherLoadError);
      expect(result.current.error?.kind).toBe('network');
      expect(result.current.refreshing).toBe(false);

      const d = deferred<WeatherBundle>();
      loadMock.mockReturnValueOnce(d.promise);
      act(() => result.current.refresh());
      expect(result.current).toMatchObject({ status: 'loading', error: null, bundle: null });
      const fresh = bundleFor(LINN);
      await act(async () => {
        d.resolve(fresh);
        await d.promise;
      });
      expect(result.current).toMatchObject({ status: 'ready', bundle: fresh, error: null });
    });

    it('a failed refresh keeps the bundle and reports the error', async () => {
      const cached = bundleFor(LINN, new Date(Date.now() - 3_600_000).toISOString());
      saveBundle(cached);
      loadMock.mockRejectedValueOnce(new WeatherLoadError('nws-unavailable', 'NWS is down.'));
      const { result } = renderHook(() => useWeather(LINN));
      await flush();
      expect(result.current.status).toBe('ready');
      expect(result.current.bundle).toEqual(cached);
      expect(result.current.refreshing).toBe(false);
      expect(result.current.fromCache).toBe(true); // still the cached copy
      expect(result.current.error?.kind).toBe('nws-unavailable');

      const fresh = bundleFor(LINN);
      loadMock.mockResolvedValueOnce(fresh);
      act(() => result.current.refresh());
      await flush();
      expect(result.current).toMatchObject({ status: 'ready', bundle: fresh, error: null, fromCache: false });
    });

    it('wraps unexpected errors as WeatherLoadError', async () => {
      loadMock.mockRejectedValueOnce(new TypeError('boom'));
      const { result } = renderHook(() => useWeather(LINN));
      await flush();
      expect(result.current.status).toBe('error');
      expect(result.current.error).toBeInstanceOf(WeatherLoadError);
      expect(result.current.error?.kind).toBe('unknown');
    });
  });

  describe('changing place', () => {
    it('aborts the old request and never shows the old place under the new one', async () => {
      const first = deferred<WeatherBundle>();
      const second = deferred<WeatherBundle>();
      loadMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

      const { result, rerender } = renderHook(({ place }: { place: Place }) => useWeather(place), { initialProps: { place: LINN } });
      const firstSignal = loadMock.mock.calls[0][1]?.signal;
      const linnBundle = bundleFor(LINN);
      await act(async () => {
        first.resolve(linnBundle);
        await first.promise;
      });
      expect(result.current.bundle).toEqual(linnBundle);

      rerender({ place: PHX });
      // Straight away: nothing from Linn, and no cache for Phoenix yet.
      expect(result.current).toMatchObject({ bundle: null, status: 'loading', fromCache: false });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(loadMock.mock.calls[1][0]).toBe(PHX);
      expect(firstSignal?.aborted).toBe(false); // its request had already finished

      const phxBundle = bundleFor(PHX);
      await act(async () => {
        second.resolve(phxBundle);
        await second.promise;
      });
      expect(result.current.bundle).toEqual(phxBundle);
    });

    it('aborts an in-flight request when the place changes, and ignores its late answer', async () => {
      const first = deferred<WeatherBundle>();
      loadMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(bundleFor(PHX));
      const { result, rerender } = renderHook(({ place }: { place: Place }) => useWeather(place), { initialProps: { place: LINN } });
      const signal = loadMock.mock.calls[0][1]?.signal;

      rerender({ place: PHX });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5)); // the abort is deferred by a tick (StrictMode friendliness)
      });
      expect(signal?.aborted).toBe(true);

      await act(async () => {
        first.resolve(bundleFor(LINN)); // a late answer for the abandoned place
        await first.promise;
      });
      expect(result.current.bundle?.place.id).toBe(PHX.id);
    });

    it('shows the cached bundle of the place you switch to', async () => {
      const phxCached = bundleFor(PHX, new Date(Date.now() - 600_000).toISOString());
      saveBundle(phxCached);
      loadMock.mockResolvedValue(bundleFor(LINN));
      const { result, rerender } = renderHook(({ place }: { place: Place }) => useWeather(place), { initialProps: { place: LINN } });
      await flush();

      loadMock.mockReturnValueOnce(deferred<WeatherBundle>().promise);
      rerender({ place: PHX });
      expect(result.current).toMatchObject({ bundle: phxCached, status: 'ready', fromCache: true, refreshing: true });
    });

    it('aborts when the component unmounts', async () => {
      loadMock.mockReturnValueOnce(deferred<WeatherBundle>().promise);
      const { unmount } = renderHook(() => useWeather(LINN));
      const signal = loadMock.mock.calls[0][1]?.signal;
      unmount();
      await new Promise((r) => setTimeout(r, 5));
      expect(signal?.aborted).toBe(true);
    });

    it('goes back to idle when the place is cleared', async () => {
      loadMock.mockResolvedValue(bundleFor(LINN));
      const { result, rerender } = renderHook(({ place }: { place: Place | null }) => useWeather(place), {
        initialProps: { place: LINN as Place | null },
      });
      await flush();
      expect(result.current.status).toBe('ready');
      rerender({ place: null });
      expect(result.current).toMatchObject({ bundle: null, status: 'idle' });
      await flush();
      expect(result.current).toMatchObject({ bundle: null, status: 'idle' });
    });
  });

  describe('GPS places', () => {
    const gps = (lat: number, lon: number): Place => ({ id: 'gps', name: 'My location', lat, lon, kind: 'gps' });

    it('does not refetch for GPS jitter, but does when the device really moves', async () => {
      loadMock.mockResolvedValue(bundleFor(gps(39.7456, -97.0892)));
      const { rerender } = renderHook(({ place }: { place: Place }) => useWeather(place), { initialProps: { place: gps(39.7456, -97.0892) } });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(1);

      rerender({ place: gps(39.74562, -97.08925) });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(1);

      rerender({ place: gps(39.9, -97.0892) });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('does not show a cached GPS bundle from somewhere far away', async () => {
      saveBundle(bundleFor(gps(39.7456, -97.0892)));
      loadMock.mockReturnValueOnce(deferred<WeatherBundle>().promise);
      const { result } = renderHook(() => useWeather(gps(33.4484, -112.074)));
      expect(result.current).toMatchObject({ bundle: null, status: 'loading', fromCache: false });
    });
  });

  describe('StrictMode', () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => <StrictMode>{children}</StrictMode>;

    it('fetches once even though effects mount, unmount and mount again', async () => {
      const d = deferred<WeatherBundle>();
      loadMock.mockReturnValue(d.promise);
      const { result } = renderHook(() => useWeather(LINN), { wrapper });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(loadMock.mock.calls[0][1]?.signal?.aborted).toBe(false);

      const fresh = bundleFor(LINN);
      await act(async () => {
        d.resolve(fresh);
        await d.promise;
      });
      expect(result.current).toMatchObject({ bundle: fresh, status: 'ready', refreshing: false });
    });

    it('also fetches once with a cached bundle', async () => {
      saveBundle(bundleFor(LINN, new Date(Date.now() - 600_000).toISOString()));
      loadMock.mockResolvedValue(bundleFor(LINN));
      const { result } = renderHook(() => useWeather(LINN), { wrapper });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(result.current.fromCache).toBe(false);
    });
  });

  describe('AirNow key changes', () => {
    it('refetches in place, keeping the data on screen', async () => {
      const first = bundleFor(LINN);
      const second = deferred<WeatherBundle>();
      loadMock.mockResolvedValueOnce(first).mockReturnValueOnce(second.promise);
      const { result, rerender } = renderHook(({ key }: { key?: string }) => useWeather(LINN, { airNowKey: key }), {
        initialProps: { key: undefined as string | undefined },
      });
      await flush();
      expect(result.current.bundle).toEqual(first);

      rerender({ key: 'new-key' });
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(loadMock.mock.calls[1][1]?.airNowKey).toBe('new-key');
      expect(result.current).toMatchObject({ bundle: first, status: 'ready', refreshing: true });

      const updated = bundleFor(LINN);
      await act(async () => {
        second.resolve(updated);
        await second.promise;
      });
      expect(result.current).toMatchObject({ bundle: updated, refreshing: false });
    });
  });

  describe('automatic refresh', () => {
    it('refreshes every 10 minutes while the page is visible', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(loadMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
      });
      expect(loadMock).toHaveBeenCalledTimes(3);
    });

    it('skips the timer refresh while the page is hidden, and catches up when it returns if the data is stale', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);

      setVisibility('hidden');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1000);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);

      setVisibility('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(2); // older than 5 minutes: refreshed
    });

    it('does not refresh on return to the foreground if the data is under 5 minutes old', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS - 60_000);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 60_000);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('does nothing for visibilitychange while hidden', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1000);
      });
      setVisibility('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes when the browser comes back online, but only if the data is stale', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(1); // fresh

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1000);
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('retries on return to the foreground after a failed first load, whatever the age', async () => {
      vi.useFakeTimers();
      loadMock.mockRejectedValueOnce(new WeatherLoadError('network', 'offline')).mockResolvedValue(bundleFor(LINN));
      const { result } = renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe('error');
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('ready');
    });

    it('stops its timer and listeners on unmount', async () => {
      vi.useFakeTimers();
      loadMock.mockImplementation(async () => bundleFor(LINN, new Date(Date.now()).toISOString()));
      const { unmount } = renderHook(() => useWeather(LINN));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      unmount();
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(loadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh()', () => {
    it('forces a fetch even when the data is fresh', async () => {
      loadMock.mockImplementation(async () => bundleFor(LINN));
      const { result } = renderHook(() => useWeather(LINN));
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(1);
      act(() => result.current.refresh());
      await flush();
      expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('does not start a second request while one is in flight, and keeps a stable identity', async () => {
      const d = deferred<WeatherBundle>();
      loadMock.mockReturnValue(d.promise);
      const { result, rerender } = renderHook(() => useWeather(LINN));
      const refresh = result.current.refresh;
      act(() => result.current.refresh());
      act(() => result.current.refresh());
      expect(loadMock).toHaveBeenCalledTimes(1);
      rerender();
      expect(result.current.refresh).toBe(refresh);
      await act(async () => {
        d.resolve(bundleFor(LINN));
        await d.promise;
      });
    });

    it('shows refreshing while a refresh is in flight', async () => {
      loadMock.mockResolvedValueOnce(bundleFor(LINN));
      const { result } = renderHook(() => useWeather(LINN));
      await flush();
      const d = deferred<WeatherBundle>();
      loadMock.mockReturnValueOnce(d.promise);
      act(() => result.current.refresh());
      expect(result.current).toMatchObject({ status: 'ready', refreshing: true });
      await act(async () => {
        d.resolve(bundleFor(LINN));
        await d.promise;
      });
      expect(result.current.refreshing).toBe(false);
    });
  });
});
