/**
 * Test support (not imported by the app): recorded API responses and a fetch mock that replays them.
 * Fixtures are recorded by scripts/record-fixtures.mjs into src/data/__fixtures__/<slug>.json.
 */

export interface FixtureResponse {
  status: number;
  body: unknown;
}

export interface Fixture {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  /** ISO time the responses were recorded; tests set the clock a few minutes after it. */
  recordedAt: string;
  responses: {
    points: FixtureResponse;
    forecast?: FixtureResponse;
    hourly?: FixtureResponse;
    grid?: FixtureResponse;
    stations?: FixtureResponse;
    observations?: Record<string, FixtureResponse>;
    alerts?: FixtureResponse;
    afdList?: FixtureResponse;
    afd?: FixtureResponse;
    gfs?: FixtureResponse;
    aq?: FixtureResponse;
  };
}

const modules = import.meta.glob('../__fixtures__/*.json', { eager: true, import: 'default' }) as Record<string, Fixture>;

export function loadFixture(slug: string): Fixture {
  const entry = Object.entries(modules).find(([path]) => path.endsWith(`/${slug}.json`));
  if (!entry) throw new Error(`No fixture named ${slug}; run scripts/record-fixtures.mjs`);
  // Tests mutate bodies to build edge cases, so hand out a private copy.
  return JSON.parse(JSON.stringify(entry[1])) as Fixture;
}

/** The recording time plus a few minutes: the "now" at which the recorded data is current. */
export function fixtureNow(f: Fixture, minutesAfter = 3): number {
  return Date.parse(f.recordedAt) + minutesAfter * 60_000;
}

export type RouteKey =
  | 'points'
  | 'forecast'
  | 'hourly'
  | 'grid'
  | 'stations'
  | 'alerts'
  | 'afdList'
  | 'afd'
  | 'gfs'
  | 'aq'
  | 'airnow'
  | 'geocode'
  | `obs:${string}`;

/** Which logical endpoint a URL is, or null when the mock doesn't know it. */
export function routeOf(rawUrl: string): RouteKey | null {
  const u = new URL(rawUrl);
  const path = u.pathname;
  if (u.host === 'api.weather.gov') {
    if (path.startsWith('/points/')) return 'points';
    if (/^\/gridpoints\/[^/]+\/-?\d+,-?\d+\/forecast\/hourly$/.test(path)) return 'hourly';
    if (/^\/gridpoints\/[^/]+\/-?\d+,-?\d+\/forecast$/.test(path)) return 'forecast';
    if (/^\/gridpoints\/[^/]+\/-?\d+,-?\d+\/stations$/.test(path)) return 'stations';
    if (/^\/gridpoints\/[^/]+\/-?\d+,-?\d+$/.test(path)) return 'grid';
    const obs = /^\/stations\/([^/]+)\/observations\/latest$/.exec(path);
    if (obs) return `obs:${decodeURIComponent(obs[1])}`;
    if (path === '/alerts/active') return 'alerts';
    if (path.startsWith('/products/types/AFD/locations/')) return 'afdList';
    if (/^\/products\/[^/]+$/.test(path)) return 'afd';
  }
  if (u.host === 'api.open-meteo.com') return 'gfs';
  if (u.host === 'air-quality-api.open-meteo.com') return 'aq';
  if (u.host === 'www.airnowapi.org') return 'airnow';
  if (u.host === 'geocoding-api.open-meteo.com') return 'geocode';
  return null;
}

/** Replace a route's response, or make it fail like a dropped connection. */
export type Override = FixtureResponse | 'network-error' | ((url: string) => FixtureResponse | 'network-error');

export interface MockFetch {
  fetch: typeof fetch;
  /** Every URL requested, in order. */
  calls: string[];
  /** The init object of each request, parallel to `calls`. */
  inits: Array<RequestInit | undefined>;
  /** Number of requests per route. */
  count(route: RouteKey): number;
}

function json(r: FixtureResponse): Response {
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
}

/** A NWS-style 5xx problem document. */
export const serverError = (status = 503): FixtureResponse => ({
  status,
  body: { title: 'Service Unavailable', status, detail: 'Temporarily unavailable' },
});

/**
 * A fetch replacement serving the fixture's responses. `overrides` replace or break individual routes;
 * routes the fixture doesn't have answer 404.
 */
export function mockFetch(fixture: Fixture | null, overrides: Partial<Record<RouteKey, Override>> = {}): MockFetch {
  const calls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const counts = new Map<string, number>();
  const r = fixture?.responses;

  const base = (route: RouteKey): FixtureResponse | undefined => {
    if (!r) return undefined;
    if (route.startsWith('obs:')) return r.observations?.[route.slice(4)];
    switch (route) {
      case 'points':
        return r.points;
      case 'forecast':
        return r.forecast;
      case 'hourly':
        return r.hourly;
      case 'grid':
        return r.grid;
      case 'stations':
        return r.stations;
      case 'alerts':
        return r.alerts;
      case 'afdList':
        return r.afdList;
      case 'afd':
        return r.afd;
      case 'gfs':
        return r.gfs;
      case 'aq':
        return r.aq;
      default:
        return undefined;
    }
  };

  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    inits.push(init);
    if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const route = routeOf(url);
    if (route === null) return Promise.resolve(json({ status: 404, body: { title: 'Not Found' } }));
    counts.set(route, (counts.get(route) ?? 0) + 1);

    let override = overrides[route];
    if (typeof override === 'function') override = override(url);
    if (override === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    const response = override ?? base(route);
    return Promise.resolve(json(response ?? { status: 404, body: { title: 'Not Found' } }));
  };

  return { fetch: impl as typeof fetch, calls, inits, count: (route) => counts.get(route) ?? 0 };
}
