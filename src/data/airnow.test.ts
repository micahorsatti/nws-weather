import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AirNowKeyError,
  currentUrl,
  forecastUrl,
  loadAirNow,
  parseAirNowCurrent,
  parseAirNowForecast,
} from './airnow';
import { httpConfig } from './http';
import { mockFetch, serverError } from './testing/fixtures';

const FALLBACK_ISO = '2026-10-09T03:00:00Z';

// Hand-written in the shape AirNow documents (note the trailing space in the date fields).
const category = (n: number): { Number: number; Name: string } => ({
  Number: n,
  Name: ['Unknown', 'Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'][n],
});

const obs = (parameter: string, aqi: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  DateObserved: '2026-10-08 ',
  HourObserved: 20,
  LocalTimeZone: 'CST',
  ReportingArea: 'Topeka',
  StateCode: 'KS',
  Latitude: 39.0558,
  Longitude: -95.689,
  ParameterName: parameter,
  AQI: aqi,
  Category: category(aqi < 0 ? 0 : aqi <= 50 ? 1 : aqi <= 100 ? 2 : 3),
  ...over,
});

const fc = (date: string, parameter: string, aqi: number, cat: number, discussion = ''): Record<string, unknown> => ({
  DateIssue: '2026-10-08 ',
  DateForecast: `${date} `,
  ReportingArea: 'Topeka',
  StateCode: 'KS',
  ParameterName: parameter,
  AQI: aqi,
  Category: category(cat),
  ActionDay: false,
  Discussion: discussion,
});

describe('AirNow current observations', () => {
  it('takes the worst pollutant as the overall AQI', () => {
    const now = parseAirNowCurrent([obs('O3', 42), obs('PM2.5', 57), obs('PM10', 31)], 'America/Chicago', FALLBACK_ISO);
    expect(now).toEqual({
      source: 'airnow',
      aqi: 57,
      primaryPollutant: 'PM2.5',
      reportingArea: 'Topeka',
      // 20:00 CST (UTC-6) on 2026-10-08
      observedAt: '2026-10-09T02:00:00Z',
    });
  });

  it('ignores AQI -1 (unknown) entries, even when they are the only ones', () => {
    const mixed = parseAirNowCurrent([obs('O3', -1), obs('PM2.5', 33)], 'America/Chicago', FALLBACK_ISO);
    expect(mixed?.aqi).toBe(33);
    expect(mixed?.primaryPollutant).toBe('PM2.5');
    expect(parseAirNowCurrent([obs('O3', -1), obs('PM10', -1)], 'America/Chicago', FALLBACK_ISO)).toBeNull();
  });

  it('is null for an empty answer (no reporting area within 50 miles)', () => {
    expect(parseAirNowCurrent([], 'America/Chicago', FALLBACK_ISO)).toBeNull();
    expect(parseAirNowCurrent({}, 'America/Chicago', FALLBACK_ISO)).toBeNull();
  });

  it('understands the time zone abbreviations AirNow uses', () => {
    const at = (zone: string, hour = 12): string | undefined =>
      parseAirNowCurrent([obs('O3', 10, { LocalTimeZone: zone, HourObserved: hour })], 'America/Chicago', FALLBACK_ISO)?.observedAt;
    expect(at('EST')).toBe('2026-10-08T17:00:00Z');
    expect(at('CDT')).toBe('2026-10-08T17:00:00Z');
    expect(at('PST')).toBe('2026-10-08T20:00:00Z');
    expect(at('AKDT')).toBe('2026-10-08T20:00:00Z');
    expect(at('HST')).toBe('2026-10-08T22:00:00Z');
    expect(at('AST')).toBe('2026-10-08T16:00:00Z');
    expect(at('ChST')).toBe('2026-10-08T02:00:00Z');
  });

  it('uses the place time zone for an abbreviation it does not know, and the fallback time when the date is unreadable', () => {
    expect(parseAirNowCurrent([obs('O3', 10, { LocalTimeZone: 'XYZ' })], 'America/Chicago', FALLBACK_ISO)?.observedAt).toBe(
      '2026-10-09T01:00:00Z', // 20:00 CDT
    );
    expect(parseAirNowCurrent([obs('O3', 10, { DateObserved: '' })], 'America/Chicago', FALLBACK_ISO)?.observedAt).toBe(FALLBACK_ISO);
  });

  it('treats a WebServiceError body as a rejected key', () => {
    const body = [{ WebServiceError: [{ Error: 'Invalid API_KEY' }] }];
    expect(() => parseAirNowCurrent(body, 'America/Chicago', FALLBACK_ISO)).toThrow(AirNowKeyError);
    expect(() => parseAirNowForecast(body)).toThrow(AirNowKeyError);
  });
});

describe('AirNow forecast', () => {
  it('collapses to one day per date using the worst pollutant', () => {
    const days = parseAirNowForecast([
      fc('2026-10-09', 'PM2.5', 38, 1),
      fc('2026-10-09', 'O3', 62, 2, ' Ozone will build.\n Sensitive groups take care. '),
      fc('2026-10-10', 'O3', 105, 3),
      fc('2026-10-10', 'PM2.5', 40, 1),
    ]);
    expect(days).toEqual([
      {
        date: '2026-10-09',
        aqi: 62,
        categoryNumber: 2,
        primaryPollutant: 'O3',
        discussion: 'Ozone will build.\n Sensitive groups take care.',
        source: 'airnow',
      },
      { date: '2026-10-10', aqi: 105, categoryNumber: 3, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
    ]);
  });

  it('keeps category-only forecasts (AQI -1) with a null number', () => {
    const [day] = parseAirNowForecast([fc('2026-10-09', 'PM2.5', -1, 2, 'Category only.'), fc('2026-10-09', 'O3', -1, 1)]);
    expect(day).toMatchObject({ date: '2026-10-09', aqi: null, categoryNumber: 2, primaryPollutant: 'PM2.5', discussion: 'Category only.' });
  });

  it('prefers a numeric AQI over a category-only one in the same category', () => {
    const [day] = parseAirNowForecast([fc('2026-10-09', 'PM2.5', -1, 2), fc('2026-10-09', 'O3', 70, 2)]);
    expect(day.aqi).toBe(70);
    expect(day.primaryPollutant).toBe('O3');
  });

  it('derives the category from the AQI when none is given, and skips rows with neither', () => {
    const rows = [
      { DateForecast: '2026-10-09 ', ParameterName: 'O3', AQI: 120 },
      { DateForecast: '2026-10-10 ', ParameterName: 'O3', AQI: -1 },
      { DateForecast: 'garbage', ParameterName: 'O3', AQI: 10, Category: category(1) },
    ];
    expect(parseAirNowForecast(rows)).toEqual([
      { date: '2026-10-09', aqi: 120, categoryNumber: 3, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
    ]);
  });

  it('is empty for an empty answer', () => {
    expect(parseAirNowForecast([])).toEqual([]);
  });
});

describe('AirNow requests', () => {
  beforeAll(() => {
    httpConfig.backoffMs = [0, 0];
    httpConfig.jitterMs = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const args = { lat: 39.7456, lon: -97.0892, key: 'TEST-KEY-123', today: '2026-10-08', timeZone: 'America/Chicago', now: Date.parse('2026-10-09T02:30:00Z') };

  it('builds URLs with the documented parameters and encodes the key', () => {
    const cur = new URL(currentUrl(39.7456, -97.0892, 'a+b/c'));
    expect(cur.origin + cur.pathname).toBe('https://www.airnowapi.org/aq/observation/latLong/current/');
    expect(cur.searchParams.get('latitude')).toBe('39.7456');
    expect(cur.searchParams.get('longitude')).toBe('-97.0892');
    expect(cur.searchParams.get('distance')).toBe('50');
    expect(cur.searchParams.get('format')).toBe('application/json');
    expect(cur.searchParams.get('API_KEY')).toBe('a+b/c');
    const fcUrl = new URL(forecastUrl(39.7456, -97.0892, '2026-10-09', 'k'));
    expect(fcUrl.pathname).toBe('/aq/forecast/latLong/');
    expect(fcUrl.searchParams.get('date')).toBe('2026-10-09');
  });

  it('loads current conditions and the next days in parallel', async () => {
    const mock = mockFetch(null, {
      airnow: (url) => {
        if (url.includes('/observation/')) return { status: 200, body: [obs('O3', 45), obs('PM2.5', 52)] };
        const date = new URL(url).searchParams.get('date');
        if (date === '2026-10-08') return { status: 200, body: [fc('2026-10-08', 'O3', 50, 1)] };
        if (date === '2026-10-09') return { status: 200, body: [fc('2026-10-09', 'PM2.5', -1, 2, 'Smoke drifting in.')] };
        return { status: 200, body: [] };
      },
    });
    vi.stubGlobal('fetch', mock.fetch);
    const result = await loadAirNow(args);
    expect(mock.count('airnow')).toBe(4);
    expect(result.current).toMatchObject({ source: 'airnow', aqi: 52, primaryPollutant: 'PM2.5', reportingArea: 'Topeka' });
    expect(result.forecast.map((d) => [d.date, d.aqi, d.categoryNumber])).toEqual([
      ['2026-10-08', 50, 1],
      ['2026-10-09', null, 2],
    ]);
  });

  it('returns what it has when only some requests fail', async () => {
    const mock = mockFetch(null, {
      airnow: (url) => (url.includes('/observation/') ? serverError(500) : { status: 200, body: [fc('2026-10-09', 'O3', 61, 2)] }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const result = await loadAirNow(args);
    expect(result.current).toBeNull();
    expect(result.forecast).toHaveLength(1);
  });

  it('turns a 401 into AirNowKeyError', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 401, body: '' } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
    await expect(loadAirNow(args)).rejects.toThrow('AirNow rejected the API key');
  });

  it('turns 403 and a WebServiceError body into AirNowKeyError too', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 403, body: '' } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 200, body: [{ WebServiceError: [{ Error: 'Invalid API_KEY' }] }] } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
  });

  it('never puts the key in an error message when everything fails', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: 'network-error' }).fetch);
    const err = await loadAirNow(args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain(args.key);
    expect(String((err as Error).stack ?? '')).not.toContain(args.key);

    vi.stubGlobal('fetch', mockFetch(null, { airnow: serverError(500) }).fetch);
    const err2 = await loadAirNow(args).catch((e: unknown) => e);
    expect(String((err2 as Error).message)).not.toContain(args.key);
    expect(String((err2 as Error).message)).toContain('HTTP 500');
  });

  it('returns empty results when AirNow knows no reporting area (empty arrays are not an error)', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 200, body: [] } }).fetch);
    await expect(loadAirNow(args)).resolves.toEqual({ current: null, forecast: [] });
  });
});
