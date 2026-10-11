// @vitest-environment jsdom
/**
 * What the real data layer puts on the network for the real hook (only fetch is replaced): how many requests a
 * load and a refresh make, that React StrictMode doesn't double them, that a place switch aborts the old
 * place's requests, and that a dead network gets a bounded number of tries rather than a storm.
 * NWS asks clients to be gentle, so these counts are part of the product.
 */
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from './cache';
import { httpConfig } from './http';
import { fixtureNow, loadFixture, mockFetch, type Fixture } from './testing/fixtures';
import { placeIdFor, type Place } from './types';
import { REFRESH_INTERVAL_MS, useWeather } from './useWeather';

const placeOf = (fx: Fixture): Place => ({ id: placeIdFor(fx.lat, fx.lon), name: fx.name, lat: fx.lat, lon: fx.lon, kind: 'saved' });

// These tests parse real recorded responses; give them room when the whole suite runs its files in parallel.
vi.setConfig({ testTimeout: 30_000 });

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeAll(() => {
  httpConfig.backoffMs = [0, 0];
  httpConfig.jitterMs = 0;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  localStorage.clear();
  clearAllCaches();
  setOnline(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAllCaches();
});

// Generous timeouts: the whole suite runs its files in parallel, and these tests parse real recorded responses.
const WAIT = { timeout: 10_000 };
const ready = (result: { current: { status: string; refreshing: boolean } }) =>
  vi.waitFor(() => expect(result.current).toMatchObject({ status: 'ready', refreshing: false }), WAIT);

describe('requests for one place (Linn, KS)', () => {
  it('a load makes nine requests, each URL once, even under StrictMode, and the point comes first', async () => {
    const fx = loadFixture('linn-ks');
    vi.setSystemTime(fixtureNow(fx));
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const place = placeOf(fx);

    const { result } = renderHook(() => useWeather(place), { wrapper: StrictMode });
    await ready(result);

    // point, forecast, hourly, grid, stations, one station observation, alerts, GFS, air quality
    expect(mock.calls).toHaveLength(9);
    expect(new Set(mock.calls).size).toBe(9);
    expect(mock.calls[0]).toBe('https://api.weather.gov/points/39.7456,-97.0892');
    expect(mock.calls.filter((u) => u.includes('airnowapi')).length).toBe(0); // no key, no AirNow
  });

  it('a refresh asks for the point from the on-device cache, so it makes eight', async () => {
    const fx = loadFixture('linn-ks');
    vi.setSystemTime(fixtureNow(fx));
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const place = placeOf(fx);

    const { result } = renderHook(() => useWeather(place), { wrapper: StrictMode });
    await ready(result);
    expect(mock.calls).toHaveLength(9);

    act(() => result.current.refresh());
    await ready(result);
    expect(mock.calls).toHaveLength(9 + 8);
    expect(mock.count('points')).toBe(1);
    for (const route of ['forecast', 'hourly', 'grid', 'stations', 'alerts', 'gfs', 'aq'] as const) expect(mock.count(route), route).toBe(2);
  });

  it('with an AirNow key a load adds exactly two requests (current reading and forecast), all to AirNow', async () => {
    const fx = loadFixture('linn-ks');
    vi.setSystemTime(fixtureNow(fx));
    const mock = mockFetch(fx, { airnow: { status: 200, body: [] } });
    vi.stubGlobal('fetch', mock.fetch);
    const place = placeOf(fx);

    const { result } = renderHook(() => useWeather(place, { airNowKey: 'TEST-KEY-0123456789' }), { wrapper: StrictMode });
    await ready(result);
    expect(mock.calls).toHaveLength(11);
    expect(mock.count('airnow')).toBe(2);
    const keyed = mock.calls.filter((u) => u.includes('TEST-KEY-0123456789'));
    expect(keyed).toHaveLength(2);
    expect(keyed.every((u) => new URL(u).host === 'www.airnowapi.org')).toBe(true);
  });

  it('refreshes on a 10-minute timer only while visible, and each refresh is one round of requests', async () => {
    const fx = loadFixture('linn-ks');
    vi.setSystemTime(fixtureNow(fx));
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const place = placeOf(fx);
    // Real timers for the interval would take ten minutes: fake them from here on.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(fixtureNow(fx));

    renderHook(() => useWeather(place), { wrapper: StrictMode });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mock.calls).toHaveLength(9);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 100);
    });
    expect(mock.calls).toHaveLength(9 + 8);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    });
    expect(mock.calls).toHaveLength(9 + 8); // hidden: nothing
  });
});

describe('switching places', () => {
  it('aborts every in-flight request of the old place and sends only the new place\'s', async () => {
    const linn = loadFixture('linn-ks');
    const phoenix = loadFixture('phoenix-az');
    vi.setSystemTime(fixtureNow(linn));
    const linnMock = mockFetch(linn);
    const phoenixMock = mockFetch(phoenix);
    let phase: 'linn' | 'phoenix' = 'linn';
    const hung: AbortSignal[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (phase === 'phoenix') return phoenixMock.fetch(input, init);
      const url = String(input);
      if (url.includes('/points/')) return linnMock.fetch(input, init); // the point answers; everything after it hangs
      linnMock.calls.push(url);
      const signal = init?.signal;
      if (signal) hung.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const linnPlace = placeOf(linn);
    const phoenixPlace = placeOf(phoenix);
    const { result, rerender } = renderHook(({ place }: { place: Place }) => useWeather(place), {
      wrapper: StrictMode,
      initialProps: { place: linnPlace },
    });
    await vi.waitFor(() => expect(hung.length).toBeGreaterThanOrEqual(5), WAIT);
    expect(hung.every((s) => !s.aborted)).toBe(true);
    const linnRequests = linnMock.calls.length;

    phase = 'phoenix';
    rerender({ place: phoenixPlace });
    await ready(result);

    expect(hung.every((s) => s.aborted)).toBe(true); // all of Linn's in-flight requests were cancelled
    expect(linnMock.calls.length).toBe(linnRequests); // and Linn was not asked again
    expect(phoenixMock.calls[0]).toBe('https://api.weather.gov/points/33.4484,-112.0740');
    expect(phoenixMock.calls).toHaveLength(9);
    expect(result.current.bundle?.place.id).toBe(phoenixPlace.id);
  });
});

describe('a dead network', () => {
  it('makes no automatic attempts while the browser says it is offline, then one round of eight when it is back', async () => {
    const fx = loadFixture('linn-ks');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(fixtureNow(fx));
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const place = placeOf(fx);

    renderHook(() => useWeather(place), { wrapper: StrictMode });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mock.calls).toHaveLength(9);

    setOnline(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3 + 100); // three 10-minute ticks and a foreground return
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mock.calls).toHaveLength(9);

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mock.calls).toHaveLength(9 + 8);
  });

  it('gets a bounded number of tries per service, and no more until the next refresh', async () => {
    const fx = loadFixture('linn-ks');
    vi.setSystemTime(fixtureNow(fx));
    const good = mockFetch(fx);
    let dead = false;
    const deadCalls: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!dead) return good.fetch(input, init);
      deadCalls.push(String(input));
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const place = placeOf(fx);

    const { result } = renderHook(() => useWeather(place), { wrapper: StrictMode });
    await ready(result);
    const bundle = result.current.bundle;
    expect(bundle).not.toBeNull();

    dead = true;
    act(() => result.current.refresh());
    await vi.waitFor(() => expect(result.current.error).not.toBeNull(), WAIT);
    // Seven services (the point is cached), at most three tries each (the slow ones get two): 18 here.
    expect(deadCalls.length).toBeLessThanOrEqual(21);
    expect(deadCalls.length).toBeGreaterThanOrEqual(7);
    for (const url of new Set(deadCalls)) expect(deadCalls.filter((u) => u === url).length).toBeLessThanOrEqual(3);
    expect(result.current.bundle).toBe(bundle); // the old forecast stays on screen
    expect(result.current.status).toBe('ready');

    // Nothing more happens by itself...
    const tried = deadCalls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(deadCalls.length).toBe(tried);
  });
});
