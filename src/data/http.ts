/**
 * Fetch wrapper for every network call in the data layer: JSON parsing, a per-request timeout
 * combined with the caller's AbortSignal, and retry with backoff for transient failures
 * (network errors, timeouts, HTTP 5xx/408/425/429). NWS in particular returns intermittent 5xx.
 *
 * Only CORS-simple requests are made: no custom headers except `Accept` (safelisted), so browsers
 * never send a preflight. Error messages never include query strings (AirNow keys live there).
 */
import { WeatherLoadError } from './types';

/** Tunables. Tests shrink the delays; nothing else should touch these. */
export const httpConfig = {
  timeoutMs: 12_000,
  /** Delay before the 2nd, 3rd, ... attempt (a little random jitter is added). */
  backoffMs: [500, 1_500],
  jitterMs: 250,
  random: Math.random as () => number,
};

export const GEO_JSON = 'application/geo+json';

/** The server answered with a non-2xx status (after any retries). */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, where: string) {
    super(`HTTP ${status} from ${where}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** The request never produced a usable answer: offline, DNS/TLS failure, or timeout. */
export class NetworkError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut = false) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = timedOut;
  }
}

/** A 2xx answer whose body was not the JSON we expected. */
export class BadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadResponseError';
  }
}

export function abortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('The operation was aborted.', 'AbortError');
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** host + path only: never the query string, which may hold a secret (AirNow API_KEY) or a location. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'the server';
  }
}

export interface FetchJsonOptions {
  signal?: AbortSignal;
  /** Total tries including the first (default 3). */
  attempts?: number;
  /** Per-request timeout (default httpConfig.timeoutMs). */
  timeoutMs?: number;
  /** Sent as the Accept header (CORS-safelisted). */
  accept?: string;
}

/** Resolves after `ms`, or rejects with an AbortError as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError || err instanceof BadResponseError) return true;
  if (err instanceof HttpError) {
    return err.status >= 500 || err.status === 408 || err.status === 425 || err.status === 429;
  }
  return false;
}

function backoffDelay(failedAttempt: number): number {
  const base = httpConfig.backoffMs[Math.min(failedAttempt, httpConfig.backoffMs.length - 1)] ?? 0;
  return base === 0 ? 0 : base + Math.floor(httpConfig.random() * httpConfig.jitterMs);
}

async function fetchOnce<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const where = describeUrl(url);
  const { signal } = opts;
  throwIfAborted(signal);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? httpConfig.timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  const failure = (what: string): Error => {
    if (signal?.aborted) return abortError();
    if (timedOut) return new NetworkError(`${where} did not respond in time`, true);
    return new NetworkError(`${what} ${where}`);
  };

  try {
    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        signal: controller.signal,
        ...(opts.accept ? { headers: { Accept: opts.accept } } : {}),
      });
    } catch {
      throw failure('Could not reach');
    }
    if (!res.ok) throw new HttpError(res.status, where);
    try {
      return (await res.json()) as T;
    } catch {
      if (signal?.aborted || timedOut) throw failure('Interrupted while reading');
      throw new BadResponseError(`${where} returned something other than JSON`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** GET a URL and parse JSON, retrying transient failures. Throws HttpError / NetworkError / BadResponseError / AbortError. */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetchOnce<T>(url, opts);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      if (!isRetryable(err) || attempt === attempts - 1) break;
      await sleep(backoffDelay(attempt), opts.signal);
    }
  }
  throw lastError;
}

export type FailureKind = 'network' | 'server' | 'not-found' | 'client' | 'other';

/** Coarse classification of any thrown value, for messages and WeatherLoadError mapping. */
export function classifyError(err: unknown): FailureKind {
  if (err instanceof NetworkError) return 'network';
  if (err instanceof BadResponseError) return 'server';
  if (err instanceof HttpError) {
    if (err.status === 404) return 'not-found';
    if (err.status >= 500 || err.status === 408 || err.status === 429) return 'server';
    return 'client';
  }
  return 'other';
}

/** Turn a failure into the fatal WeatherLoadError the UI understands. */
export function toLoadError(err: unknown): WeatherLoadError {
  if (err instanceof WeatherLoadError) return err;
  switch (classifyError(err)) {
    case 'network':
      return new WeatherLoadError('network', "Can't reach the weather service. Check your connection and try again.");
    case 'server':
      return new WeatherLoadError(
        'nws-unavailable',
        'The National Weather Service is having trouble right now. Try again in a few minutes.',
      );
    default:
      return new WeatherLoadError('unknown', 'Something went wrong while loading the weather.');
  }
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A short, secret-free sentence about why a source failed, for SourceProblem.message.
 * `what` is a noun phrase ("the NWS hourly forecast"); it is capitalised where a sentence starts with it.
 */
export function describeFailure(err: unknown, what: string): string {
  switch (classifyError(err)) {
    case 'network':
      return `Couldn't reach ${what}.`;
    case 'server':
      return `${capitalize(what)} is temporarily unavailable.`;
    case 'not-found':
      return `${capitalize(what)} has no data for this location.`;
    default:
      // The status makes a changed or retired service diagnosable from a screenshot.
      return err instanceof HttpError
        ? `${capitalize(what)} returned an unexpected response (HTTP ${err.status}).`
        : `${capitalize(what)} returned an unexpected response.`;
  }
}
