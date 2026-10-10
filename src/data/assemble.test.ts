import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from './cache';
import { assembleBundle, loadWeather, mergeAirForecast, type LoadOptions, type SourceResults } from './assemble';
import { httpConfig, isAbortError } from './http';
import { parseAlerts } from './nws/alerts';
import { parseForecast, parseHourlyForecast } from './nws/forecast';
import { parseGrid } from './nws/grid';
import { floorToHour, localDateOf } from './time';
import {
  fixtureNow,
  loadFixture,
  mockFetch,
  serverError,
  type Fixture,
  type MockFetch,
  type RouteKey,
  type Override,
} from './testing/fixtures';
import { placeIdFor, WeatherLoadError, type AirQualityDay, type Place, type PointInfo, type WeatherBundle } from './types';

const FIXTURES = ['linn-ks', 'phoenix-az', 'utqiagvik-ak', 'san-juan-pr'] as const;
const KEY = 'TEST-AIRNOW-KEY-0123';

beforeAll(() => {
  httpConfig.backoffMs = [0, 0];
  httpConfig.jitterMs = 0;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clearAllCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearAllCaches();
});

const placeOf = (fx: Fixture): Place => ({ id: placeIdFor(fx.lat, fx.lon), name: fx.name, lat: fx.lat, lon: fx.lon, kind: 'saved' });

async function load(
  fx: Fixture,
  overrides: Partial<Record<RouteKey, Override>> = {},
  opts: LoadOptions = {},
): Promise<{ bundle: WeatherBundle; mock: MockFetch }> {
  vi.setSystemTime(fixtureNow(fx));
  const mock = mockFetch(fx, overrides);
  vi.stubGlobal('fetch', mock.fetch);
  const bundle = await loadWeather(placeOf(fx), opts);
  return { bundle, mock };
}

/** Every number anywhere in a value is finite (JSON would silently turn NaN into null). */
function expectAllFinite(value: unknown, path = 'bundle'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => expectAllFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(v, `${path}.${k}`).not.toBeUndefined();
      expectAllFinite(v, `${path}.${k}`);
    }
  }
}

describe('loadWeather with every source healthy', () => {
  it.each(FIXTURES)('%s: builds a complete, well-formed bundle', async (slug) => {
    const fx = loadFixture(slug);
    const { bundle: b } = await load(fx);
    const now = fixtureNow(fx);
    const tz = b.point.timeZone;

    expect(b.problems).toEqual([]);
    expect(b.place).toEqual(placeOf(fx));
    expect(b.fetchedAt).toBe(new Date(now).toISOString());
    expect(b.forecastUpdatedAt).toMatch(/^2026-10-0[89]T/);
    expectAllFinite(b);

    // Hourly: starts this hour, regular, about a week long.
    expect(b.hourly.length).toBeGreaterThan(160);
    expect(Date.parse(b.hourly[0].time)).toBe(floorToHour(now));
    for (let i = 1; i < b.hourly.length; i++) {
      expect(Date.parse(b.hourly[i].time) - Date.parse(b.hourly[i - 1].time)).toBe(3_600_000);
    }
    expect(b.hourly.every((h) => h.tempC !== null)).toBe(true);
    expect(b.hourly.slice(0, 100).every((h) => h.uvIndex !== null)).toBe(true);
    expect(b.hourly.slice(0, 90).every((h) => h.aqi !== null)).toBe(true); // Open-Meteo covers about 5 days

    // Daily: today first, consecutive local dates, NWS then GFS up to 10.
    expect(b.daily).toHaveLength(10);
    expect(b.daily[0].date).toBe(localDateOf(now, tz));
    b.daily.forEach((d, i) => {
      if (i > 0) expect(d.date > b.daily[i - 1].date).toBe(true);
      expect(d.sunrise).not.toBeNull();
      expect(d.sunset).not.toBeNull();
      expect(Date.parse(d.sunrise ?? '')).toBeLessThan(Date.parse(d.sunset ?? ''));
    });
    const sources = b.daily.map((d) => d.source);
    expect(sources.indexOf('gfs')).toBe(sources.filter((s) => s === 'nws').length); // all NWS first, then all GFS
    expect(sources.filter((s) => s === 'gfs').length).toBeGreaterThanOrEqual(2);
    for (const d of b.daily.filter((x) => x.source === 'nws')) expect(d.day !== null || d.night !== null).toBe(true);

    // Everything else.
    expect(b.current?.source).toBe('observation');
    expect(b.sun.sunrise).not.toBeNull();
    expect(b.airNow?.source).toBe('open-meteo');
    expect(b.airForecast.length).toBeGreaterThanOrEqual(4);
    expect(b.airForecast.every((a) => a.source === 'open-meteo')).toBe(true);
    expect(JSON.stringify(b).length).toBeLessThan(150_000);
  });

  it('asks for the point first, then everything else, with no custom request headers', async () => {
    const fx = loadFixture('linn-ks');
    const { mock } = await load(fx);
    expect(mock.calls[0]).toBe('https://api.weather.gov/points/39.7456,-97.0892');
    expect(mock.calls).toHaveLength(9);
    mock.calls.forEach((url, i) => {
      const headers = mock.inits[i]?.headers as Record<string, string> | undefined;
      if (new URL(url).host === 'api.weather.gov') expect(headers).toEqual({ Accept: 'application/geo+json' });
      else expect(headers).toBeUndefined();
    });
    expect(mock.calls.some((u) => u.includes('airnowapi.org'))).toBe(false);
  });

  it('Linn, KS: mild night, so "feels like" is the air temperature despite the reported heat index', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx);
    expect(b.point).toMatchObject({ wfo: 'TOP', timeZone: 'America/Chicago', city: 'Linn', state: 'KS', radarStation: 'KTWX' });
    expect(b.current).toMatchObject({
      source: 'observation',
      stationId: 'KMYZ',
      tempC: 22,
      feelsLikeC: 22,
      feelsLikeKind: 'actual',
      icon: 'clear',
      isDaytime: false,
      description: 'Clear',
      pressurePa: 101520,
    });
    // Tonight-start forecast: today has no day period; the high comes from the NWS grid.
    expect(b.daily[0].day).toBeNull();
    expect(b.daily[0].night?.name).toBe('Tonight');
    expect(b.daily[0].highC).toBeCloseTo(29.44, 2);
    expect(b.alerts).toEqual([]);
  });

  it('Phoenix, AZ: active alert, heat index from the station, no DST (America/Phoenix)', async () => {
    const fx = loadFixture('phoenix-az');
    const { bundle: b } = await load(fx);
    expect(b.point.timeZone).toBe('America/Phoenix');
    expect(b.alerts).toHaveLength(1);
    expect(b.alerts[0].event).toBe('Air Quality Alert');
    expect(b.current?.stationId).toBe('KPHX');
    expect(b.current?.feelsLikeKind).toBe('heat-index');
    expect(b.current?.feelsLikeC).toBeCloseTo(33.78, 1); // KPHX reported heatIndex
    expect(b.daily[0].date).toBe('2026-10-08');
  });

  it('Utqiagvik, AK: no radar, wind chill from the station, high-latitude sun times', async () => {
    const fx = loadFixture('utqiagvik-ak');
    const { bundle: b } = await load(fx);
    expect(b.point.radarStation).toBeNull();
    expect(b.current).toMatchObject({ stationId: 'PABR', feelsLikeKind: 'wind-chill', source: 'observation' });
    expect(b.current?.feelsLikeC).toBeCloseTo(-13.4, 1);
    expect(b.current?.tempC).toBe(-7);
    expect(b.daily[0].date).toBe('2026-10-08'); // Anchorage zone, even though it is already Oct 9 in UTC
    expect(b.sun.sunrise).not.toBeNull();
    expect(b.hourly.some((h) => h.snowMm !== null && h.snowMm > 0 || h.feelsLikeKind === 'wind-chill')).toBe(true);
  });

  it('San Juan, PR: heat index, and a grid with no snowfall layer', async () => {
    const fx = loadFixture('san-juan-pr');
    const { bundle: b } = await load(fx);
    expect(b.point.timeZone).toBe('America/Puerto_Rico');
    expect(b.current).toMatchObject({ stationId: 'TJSJ', feelsLikeKind: 'heat-index' });
    expect(b.current?.feelsLikeC).toBeGreaterThan(b.current?.tempC ?? 99);
    expect(b.hourly.every((h) => h.snowMm === null)).toBe(true);
    expect(b.hourly.length).toBeGreaterThan(180); // this office's grid runs ~8 days
  });

  it('passes the AirNow key as a blank only when it is blank', async () => {
    const fx = loadFixture('linn-ks');
    const { mock } = await load(fx, {}, { airNowKey: '   ' });
    expect(mock.calls.some((u) => u.includes('airnowapi.org'))).toBe(false);
  });
});

describe('when the current observation is missing', () => {
  const stationsUrl = 'https://api.weather.gov/gridpoints/AFG/379,357/stations';

  it('uses the current forecast hour when no nearby station has a fresh temperature', async () => {
    const fx = loadFixture('utqiagvik-ak');
    const nullTemp = (id: string): Override => {
      const body = JSON.parse(JSON.stringify(fx.responses.observations?.[id]?.body)) as { properties: { temperature: { value: number | null } } };
      body.properties.temperature.value = null;
      return { status: 200, body };
    };
    const { bundle: b, mock } = await load(fx, { 'obs:PABR': nullTemp('PABR'), 'obs:PATQ': nullTemp('PATQ') }); // PAQT is days old
    expect(mock.calls.filter((u) => u.includes('/observations/'))).toHaveLength(3);
    expect(stationsUrl).toContain('/stations');
    const first = b.hourly[0];
    expect(b.current).toMatchObject({
      source: 'forecast',
      stationId: null,
      stationName: null,
      observedAt: first.time,
      description: first.shortForecast,
      icon: first.icon,
      tempC: first.tempC,
      feelsLikeC: first.feelsLikeC,
      feelsLikeKind: first.feelsLikeKind,
      pressurePa: null,
      visibilityM: null,
    });
    expect(b.problems).toEqual([]); // stale reports are not a failure
  });

  it('records a problem and still shows conditions when the stations request fails', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { stations: serverError(500) });
    expect(b.current?.source).toBe('forecast');
    expect(b.problems.map((p) => p.source)).toEqual(['nws-observation']);
  });
});

describe('partial failures', () => {
  it('survives Open-Meteo (GFS/UV and air quality) and AirNow all being unreachable', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { gfs: 'network-error', aq: 'network-error', airnow: 'network-error' }, { airNowKey: KEY });

    expect(b.problems.map((p) => p.source).sort()).toEqual(['airnow', 'open-meteo-aqi', 'open-meteo-gfs', 'open-meteo-uv']);
    expect(b.daily).toHaveLength(8); // NWS dates only: no extended outlook to append
    expect(b.daily.every((d) => d.source === 'nws')).toBe(true);
    expect(b.hourly.length).toBeGreaterThan(160);
    expect(b.hourly.every((h) => h.uvIndex === null && h.aqi === null)).toBe(true);
    expect(b.airNow).toBeNull();
    expect(b.airForecast).toEqual([]);
    expect(b.current?.source).toBe('observation');
    expect(b.daily.every((d) => d.uvIndexMax === null)).toBe(true);
    // Day numbers come from the hourly series instead of GFS.
    expect(b.daily[2].precipMm).not.toBeNull();
    // No secrets anywhere in the result.
    expect(JSON.stringify(b)).not.toContain(KEY);
    for (const p of b.problems) expect(p.message).not.toContain(KEY);
  });

  it('survives only the GFS request failing: UV and days 9-10 missing, air quality intact', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { gfs: serverError(500) });
    expect(b.problems.map((p) => p.source).sort()).toEqual(['open-meteo-gfs', 'open-meteo-uv']);
    expect(b.airNow?.source).toBe('open-meteo');
    expect(b.hourly.some((h) => h.aqi !== null)).toBe(true);
  });

  it('survives only the air quality request failing: AQI from nowhere, UV intact', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { aq: serverError(500) });
    expect(b.problems.map((p) => p.source)).toEqual(['open-meteo-aqi']);
    expect(b.airNow).toBeNull();
    expect(b.hourly.some((h) => h.uvIndex !== null)).toBe(true);
    expect(b.daily.filter((d) => d.source === 'gfs')).toHaveLength(2);
  });

  it('flags failed alerts instead of silently showing none', async () => {
    const fx = loadFixture('phoenix-az');
    const { bundle: b } = await load(fx, { alerts: serverError(503) });
    expect(b.alerts).toEqual([]);
    expect(b.problems).toEqual([{ source: 'nws-alerts', message: 'Weather alerts could not be checked right now.' }]);
  });

  it('retries a flaky NWS endpoint and reports nothing when a later attempt works', async () => {
    const fx = loadFixture('linn-ks');
    let tries = 0;
    const flaky: Override = (): { status: number; body: unknown } =>
      ++tries < 3 ? serverError(503) : (fx.responses.forecast as { status: number; body: unknown });
    const { bundle: b, mock } = await load(fx, { forecast: flaky });
    expect(mock.count('forecast')).toBe(3);
    expect(b.problems).toEqual([]);
    expect(b.daily[0].night?.name).toBe('Tonight');
  });

  it('builds days from the hourly forecast and grid when the written forecast is down', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b, mock } = await load(fx, { forecast: serverError(503) });
    expect(mock.count('forecast')).toBe(3);
    expect(b.problems).toEqual([{ source: 'nws-forecast', message: 'The NWS written forecast is temporarily unavailable.' }]);
    expect(b.forecastUpdatedAt).toBeNull();
    expect(b.daily).toHaveLength(10);
    expect(b.daily[1]).toMatchObject({ source: 'nws', day: null, night: null });
    expect(b.daily[1].highC).not.toBeNull();
    expect(b.daily[1].icon).not.toBe('unknown');
    expect(b.daily[0].highC).toBeCloseTo(29.44, 2); // still from the grid
    expect(b.daily.filter((d) => d.source === 'gfs').length).toBeGreaterThanOrEqual(2);
    expect(b.hourly.length).toBeGreaterThan(160);
  });

  it('keeps going from the grid when the hourly forecast is down (icons from the 12-hour periods)', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { hourly: serverError(500) });
    expect(b.problems.map((p) => p.source)).toEqual(['nws-hourly']);
    expect(b.hourly.length).toBeGreaterThan(160);
    expect(b.hourly.every((h) => h.icon !== 'unknown')).toBe(true);
  });

  it('keeps going from the hourly forecast when the grid is down', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { grid: serverError(502) });
    expect(b.problems.map((p) => p.source)).toEqual(['nws-grid']);
    expect(b.hourly.length).toBe(156); // exactly the hourly feed: it begins at the current hour
    expect(b.hourly[0].skyCoverPct).toBeNull();
    expect(b.hourly[0].tempC).not.toBeNull();
    expect(b.hourly[0].feelsLikeKind).toBe('actual');
    expect(b.daily).toHaveLength(10);
    expect(b.daily[0].highC).toBeNull(); // no grid, and "Tonight" has no daytime period
    expect(b.current?.source).toBe('observation');
  });

  it('drops a stale grid (it ends before now) and says so', () => {
    const fx = loadFixture('linn-ks');
    const now = fixtureNow(fx);
    const grid = parseGrid(fx.responses.grid?.body);
    const stale = parseGrid(fx.responses.grid?.body);
    for (const layer of Object.values(stale.layers)) for (const iv of layer ?? []) { iv.start -= 20 * 24 * 3_600_000; iv.end -= 20 * 24 * 3_600_000; }
    const point = parsePointInfo(fx);
    const results: SourceResults = {
      forecast: { status: 'fulfilled', value: parseForecast(fx.responses.forecast?.body) },
      hourly: { status: 'fulfilled', value: parseHourlyForecast(fx.responses.hourly?.body) },
      grid: { status: 'fulfilled', value: stale },
      observation: { status: 'fulfilled', value: null },
      alerts: { status: 'fulfilled', value: [] },
      gfs: { status: 'rejected', reason: new Error('x') },
      air: { status: 'rejected', reason: new Error('x') },
      airNow: null,
    };
    const bundle = assembleBundle(placeOf(fx), point, now, results);
    expect(bundle.problems.map((p) => p.source)).toContain('nws-grid');
    expect(bundle.problems.find((p) => p.source === 'nws-grid')?.message).toBe('NWS detailed forecast data is out of date.');
    expect(bundle.hourly.length).toBeGreaterThan(150); // from the hourly feed
    // The fresh grid for comparison supplies more.
    const fresh = assembleBundle(placeOf(fx), point, now, { ...results, grid: { status: 'fulfilled', value: grid } });
    expect(fresh.problems.map((p) => p.source)).not.toContain('nws-grid');
    expect(fresh.hourly.length).toBeGreaterThan(bundle.hourly.length);
  });
});

function parsePointInfo(fx: Fixture): PointInfo {
  const p = (fx.responses.points.body as { properties: Record<string, string | number> }).properties;
  return {
    wfo: p.gridId as string,
    gridX: p.gridX as number,
    gridY: p.gridY as number,
    timeZone: p.timeZone as string,
    city: '',
    state: '',
    radarStation: null,
    forecastZone: null,
    county: null,
  };
}

describe('AirNow', () => {
  const obs = (parameter: string, aqi: number): Record<string, unknown> => ({
    DateObserved: '2026-10-08 ',
    HourObserved: 20,
    LocalTimeZone: 'CST',
    ReportingArea: 'Topeka',
    StateCode: 'KS',
    ParameterName: parameter,
    AQI: aqi,
    Category: { Number: aqi <= 50 ? 1 : 2, Name: 'x' },
  });
  const forecast = (date: string, parameter: string, aqi: number): Record<string, unknown> => ({
    DateForecast: `${date} `,
    ReportingArea: 'Topeka',
    ParameterName: parameter,
    AQI: aqi,
    Category: { Number: aqi < 0 ? 2 : aqi <= 50 ? 1 : 2, Name: 'x' },
    Discussion: 'Official discussion.',
  });

  it('uses the official numbers when a key is supplied, merging Open-Meteo for the remaining dates', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b, mock } = await load(
      fx,
      {
        airnow: (url) => {
          if (url.includes('/observation/')) return { status: 200, body: [obs('O3', 41), obs('PM2.5', 57), obs('PM10', -1)] };
          return { status: 200, body: [forecast('2026-10-08', 'PM2.5', 51), forecast('2026-10-09', 'O3', -1)] };
        },
      },
      { airNowKey: KEY },
    );
    expect(b.problems).toEqual([]);
    expect(b.airNow).toEqual({ source: 'airnow', aqi: 57, primaryPollutant: 'PM2.5', reportingArea: 'Topeka', observedAt: '2026-10-09T02:00:00Z' });
    expect(b.airForecast.slice(0, 2).map((d) => [d.date, d.source, d.aqi, d.categoryNumber])).toEqual([
      ['2026-10-08', 'airnow', 51, 2],
      ['2026-10-09', 'airnow', null, 2],
    ]);
    expect(b.airForecast.slice(2).every((d) => d.source === 'open-meteo')).toBe(true);
    expect(b.airForecast.map((d) => d.date)).toEqual([...b.airForecast.map((d) => d.date)].sort());
    expect(b.daily[0].aqiMax).toBe(51); // the official number wins over the hourly model
    expect(b.daily[1].aqiMax).not.toBeNull();
    // Hourly AQI is still the Open-Meteo model.
    expect(b.hourly[0].aqi).toBe(43);

    // The key is sent only to AirNow, and never ends up in the result.
    const keyed = mock.calls.filter((u) => u.includes(KEY));
    expect(keyed.length).toBe(2); // current observations + current forecast
    expect(keyed.every((u) => new URL(u).host === 'www.airnowapi.org')).toBe(true);
    expect(JSON.stringify(b)).not.toContain(KEY);
  });

  it('falls back to Open-Meteo and records a problem when the key is rejected (401)', async () => {
    const fx = loadFixture('linn-ks');
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info'), vi.spyOn(console, 'debug')];
    const { bundle: b, mock } = await load(fx, { airnow: { status: 401, body: '' } }, { airNowKey: KEY });
    expect(b.problems).toEqual([{ source: 'airnow', message: 'AirNow rejected the API key' }]);
    expect(b.airNow?.source).toBe('open-meteo');
    expect(b.airForecast.every((d) => d.source === 'open-meteo')).toBe(true);
    expect(mock.count('airnow')).toBe(2); // one try each: a 401 is not retried
    expect(JSON.stringify(b)).not.toContain(KEY);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('describes other AirNow failures without the key and still falls back', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { airnow: serverError(500) }, { airNowKey: KEY });
    expect(b.problems).toEqual([{ source: 'airnow', message: 'AirNow is temporarily unavailable.' }]);
    expect(b.airNow?.source).toBe('open-meteo');
    expect(JSON.stringify(b)).not.toContain(KEY);
  });

  it('names a retired AirNow service (HTTP 410) instead of a vague error, and still falls back', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { airnow: { status: 410, body: 'Gone' } }, { airNowKey: KEY });
    expect(b.problems).toEqual([
      { source: 'airnow', message: 'AirNow has retired the service this app uses (HTTP 410), so the app needs an update.' },
    ]);
    expect(b.airNow?.source).toBe('open-meteo');
  });

  it('is quietly absent when AirNow has no reporting area nearby', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { airnow: { status: 200, body: [] } }, { airNowKey: KEY });
    expect(b.problems).toEqual([]);
    expect(b.airNow?.source).toBe('open-meteo');
  });

  it('merges forecasts with the official source taking priority', () => {
    const day = (date: string, source: AirQualityDay['source'], aqi: number | null): AirQualityDay => ({
      date,
      aqi,
      categoryNumber: 1,
      primaryPollutant: null,
      discussion: null,
      source,
    });
    const merged = mergeAirForecast(
      [day('2026-10-09', 'airnow', 80), day('2026-10-08', 'airnow', 60)],
      [day('2026-10-08', 'open-meteo', 40), day('2026-10-09', 'open-meteo', 41), day('2026-10-10', 'open-meteo', 42)],
    );
    expect(merged.map((d) => [d.date, d.source, d.aqi])).toEqual([
      ['2026-10-08', 'airnow', 60],
      ['2026-10-09', 'airnow', 80],
      ['2026-10-10', 'open-meteo', 42],
    ]);
  });
});

describe('fatal failures', () => {
  it('reports out-of-coverage for a location NWS does not cover, after a single request', async () => {
    const fx = loadFixture('toronto-out-of-coverage');
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const err = await loadWeather(placeOf(fx)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeatherLoadError);
    expect((err as WeatherLoadError).kind).toBe('out-of-coverage');
    expect(mock.calls).toEqual(['https://api.weather.gov/points/43.6532,-79.3832']);
  });

  it('maps an unreachable network to "network"', async () => {
    const fx = loadFixture('linn-ks');
    vi.stubGlobal('fetch', mockFetch(fx, { points: 'network-error' }).fetch);
    const err = await loadWeather(placeOf(fx)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeatherLoadError);
    expect((err as WeatherLoadError).kind).toBe('network');
  });

  it('maps persistent NWS 5xx on the point lookup to "nws-unavailable"', async () => {
    const fx = loadFixture('linn-ks');
    const mock = mockFetch(fx, { points: serverError(503) });
    vi.stubGlobal('fetch', mock.fetch);
    const err = await loadWeather(placeOf(fx)).catch((e: unknown) => e);
    expect((err as WeatherLoadError).kind).toBe('nws-unavailable');
    expect(mock.count('points')).toBe(3);
  });

  it('fails when the forecast, hourly forecast and grid are all unusable', async () => {
    const fx = loadFixture('linn-ks');
    const down = { forecast: serverError(500), hourly: serverError(503), grid: serverError(502) };
    vi.setSystemTime(fixtureNow(fx));
    vi.stubGlobal('fetch', mockFetch(fx, down).fetch);
    const err = await loadWeather(placeOf(fx)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeatherLoadError);
    expect((err as WeatherLoadError).kind).toBe('nws-unavailable');

    clearAllCaches();
    vi.stubGlobal('fetch', mockFetch(fx, { forecast: 'network-error', hourly: 'network-error', grid: 'network-error' }).fetch);
    const net = await loadWeather(placeOf(fx)).catch((e: unknown) => e);
    expect((net as WeatherLoadError).kind).toBe('network');
  });

  it('still returns a bundle when only the written forecast survives', async () => {
    const fx = loadFixture('linn-ks');
    const { bundle: b } = await load(fx, { hourly: serverError(500), grid: serverError(500) });
    expect(b.hourly).toEqual([]);
    expect(b.daily.length).toBeGreaterThanOrEqual(8);
    expect(b.current?.source).toBe('observation');
    expect(b.problems.map((p) => p.source).sort()).toEqual(['nws-grid', 'nws-hourly']);
  });

  it('no usable data and no failures to blame is still an error, not an empty bundle', () => {
    const fx = loadFixture('linn-ks');
    const stale = parseGrid(fx.responses.grid?.body);
    for (const layer of Object.values(stale.layers)) for (const iv of layer ?? []) { iv.start -= 30 * 24 * 3_600_000; iv.end -= 30 * 24 * 3_600_000; }
    const results: SourceResults = {
      forecast: { status: 'rejected', reason: new Error('x') },
      hourly: { status: 'rejected', reason: new Error('x') },
      grid: { status: 'fulfilled', value: stale },
      observation: { status: 'fulfilled', value: null },
      alerts: { status: 'fulfilled', value: parseAlerts(null) },
      gfs: { status: 'rejected', reason: new Error('x') },
      air: { status: 'rejected', reason: new Error('x') },
      airNow: null,
    };
    expect(() => assembleBundle(placeOf(fx), parsePointInfo(fx), fixtureNow(fx), results)).toThrow(WeatherLoadError);
  });
});

describe('aborting', () => {
  it('rejects with an AbortError (not a WeatherLoadError) when the signal is already aborted', async () => {
    const fx = loadFixture('linn-ks');
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const controller = new AbortController();
    controller.abort();
    const err = await loadWeather(placeOf(fx), { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(WeatherLoadError);
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects with an AbortError when aborted mid-flight, and stops waiting', async () => {
    const fx = loadFixture('linn-ks');
    const controller = new AbortController();
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push(url);
        if (url.includes('/points/')) return Promise.resolve(new Response(JSON.stringify(fx.responses.points.body), { status: 200 }));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }),
    );
    const pending = loadWeather(placeOf(fx), { signal: controller.signal }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.length).toBeGreaterThan(3); // everything after the point is in flight
    controller.abort();
    const err = await pending;
    expect(isAbortError(err)).toBe(true);
  });
});
