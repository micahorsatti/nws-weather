import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadResponseError,
  HttpError,
  NetworkError,
  abortError,
  classifyError,
  describeFailure,
  describeUrl,
  fetchJson,
  httpConfig,
  isAbortError,
  sleep,
  toLoadError,
} from './http';
import { WeatherLoadError } from './types';

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number): Response => new Response(JSON.stringify({ title: 'nope' }), { status: code });

beforeEach(() => {
  httpConfig.backoffMs = [0, 0];
  httpConfig.jitterMs = 0;
  httpConfig.timeoutMs = 12_000;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('returns parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ a: 1 })));
    await expect(fetchJson('https://api.weather.gov/x')).resolves.toEqual({ a: 1 });
  });

  it('sends no custom headers (avoids CORS preflights) except an Accept when asked', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({}));
    vi.stubGlobal('fetch', fetchMock);
    await fetchJson('https://api.open-meteo.com/v1/gfs');
    await fetchJson('https://api.weather.gov/points/1,2', { accept: 'application/geo+json' });
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined();
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Accept: 'application/geo+json' });
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('retries 5xx with backoff and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(status(502))
      .mockResolvedValueOnce(ok({ done: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('https://api.weather.gov/x')).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after three attempts with the last HTTP status', async () => {
    const fetchMock = vi.fn(async () => status(500));
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://api.weather.gov/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honours the attempts option', async () => {
    const fetchMock = vi.fn(async () => status(500));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('https://x.test/a', { attempts: 1 })).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404])('does not retry HTTP %i', async (code) => {
    const fetchMock = vi.fn(async () => status(code));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('https://api.weather.gov/x')).rejects.toMatchObject({ name: 'HttpError', status: code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429])('retries HTTP %i', async (code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(status(code)).mockResolvedValueOnce(ok(1));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('https://api.weather.gov/x')).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries network errors, then reports a NetworkError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://api.weather.gov/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const recovering = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok('back'));
    vi.stubGlobal('fetch', recovering);
    await expect(fetchJson('https://api.weather.gov/x')).resolves.toBe('back');
  });

  it('waits between attempts (about the configured backoff)', async () => {
    httpConfig.backoffMs = [40, 40];
    const fetchMock = vi.fn(async () => status(503));
    vi.stubGlobal('fetch', fetchMock);
    const started = Date.now();
    await fetchJson('https://api.weather.gov/x').catch(() => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('times out a request that never answers, and retries it', async () => {
    httpConfig.timeoutMs = 20;
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://api.weather.gov/x', { attempts: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
    expect(isAbortError(err)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a per-call timeout overrides the default', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://x.test/a', { attempts: 1, timeoutMs: 15 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
  });

  it('rejects immediately with an AbortError when the signal is already aborted', async () => {
    const fetchMock = vi.fn(async () => ok(1));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const err = await fetchJson('https://api.weather.gov/x', { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request without retrying', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = fetchJson('https://api.weather.gov/x', { signal: controller.signal }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const err = await pending;
    expect(isAbortError(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts promptly while waiting to retry', async () => {
    httpConfig.backoffMs = [10_000, 10_000];
    vi.stubGlobal('fetch', vi.fn(async () => status(503)));
    const controller = new AbortController();
    const started = Date.now();
    const pending = fetchJson('https://api.weather.gov/x', { signal: controller.signal }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('treats a 200 that is not JSON as a bad response (and retries it)', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>Gateway timeout</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://api.weather.gov/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never puts a query string (e.g. an API key) in an error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(500)));
    const err = (await fetchJson('https://www.airnowapi.org/aq/forecast/latLong/?API_KEY=SECRET123&latitude=1').catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.message).not.toContain('SECRET123');
    expect(err.message).toBe('HTTP 500 from www.airnowapi.org/aq/forecast/latLong/');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const net = (await fetchJson('https://www.airnowapi.org/aq/x?API_KEY=SECRET123').catch((e: unknown) => e)) as Error;
    expect(net.message).not.toContain('SECRET123');
  });
});

describe('error helpers', () => {
  it('classifies failures', () => {
    expect(classifyError(new NetworkError('x'))).toBe('network');
    expect(classifyError(new BadResponseError('x'))).toBe('server');
    expect(classifyError(new HttpError(503, 'h'))).toBe('server');
    expect(classifyError(new HttpError(429, 'h'))).toBe('server');
    expect(classifyError(new HttpError(404, 'h'))).toBe('not-found');
    expect(classifyError(new HttpError(401, 'h'))).toBe('client');
    expect(classifyError(new Error('x'))).toBe('other');
    expect(classifyError('boom')).toBe('other');
  });

  it('maps failures to WeatherLoadError kinds', () => {
    expect(toLoadError(new NetworkError('x')).kind).toBe('network');
    expect(toLoadError(new HttpError(503, 'h')).kind).toBe('nws-unavailable');
    expect(toLoadError(new BadResponseError('x')).kind).toBe('nws-unavailable');
    expect(toLoadError(new HttpError(400, 'h')).kind).toBe('unknown');
    expect(toLoadError(new Error('x')).kind).toBe('unknown');
    const already = new WeatherLoadError('out-of-coverage', 'x');
    expect(toLoadError(already)).toBe(already);
  });

  it('writes short secret-free sentences', () => {
    expect(describeFailure(new NetworkError('x'), 'the NWS hourly forecast')).toBe("Couldn't reach the NWS hourly forecast.");
    expect(describeFailure(new HttpError(500, 'h'), 'the NWS hourly forecast')).toBe('The NWS hourly forecast is temporarily unavailable.');
    expect(describeFailure(new HttpError(503, 'h'), 'AirNow')).toBe('AirNow is temporarily unavailable.');
    expect(describeFailure(new HttpError(404, 'h'), 'AirNow')).toBe('AirNow has no data for this location.');
    expect(describeFailure(new Error('x'), 'AirNow')).toBe('AirNow returned an unexpected response.');
  });

  it('describeUrl keeps host and path only', () => {
    expect(describeUrl('https://a.test/p/q?secret=1#frag')).toBe('a.test/p/q');
    expect(describeUrl('not a url')).toBe('the server');
  });

  it('abort errors are recognisable and sleep honours the signal', async () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    const controller = new AbortController();
    const p = sleep(10_000, controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(isAbortError(await p)).toBe(true);
    controller.abort();
    expect(isAbortError(await sleep(5, controller.signal).catch((e: unknown) => e))).toBe(true);
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
