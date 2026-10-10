import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AirNowKeyError,
  AirNowServiceError,
  currentUrl,
  describeAirNowFailure,
  forecastUrl,
  loadAirNow,
  parseAirNowCurrent,
  parseAirNowForecast,
} from './airnow';
import { HttpError, httpConfig } from './http';
import { mockFetch, serverError } from './testing/fixtures';

const FALLBACK_ISO = '2026-10-09T03:00:00Z';

// The replacement observation service (/aq/observation/current/ziplatlong/, live since 2026-06-17) answers
// one camelCase NowCast record per pollutant; this mirrors a real record.
const obsNew = (parameter: string, aqi: number | null, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  dateObserved: '2026-10-08',
  hourObserved: '20:00',
  localTimeZone: 'CST',
  reportingAreaName: 'Topeka',
  siteID: '201770013',
  siteName: 'Topeka KNI',
  parameterName: parameter,
  nowcastAQI: aqi,
  aqiCategoryName: aqi === null ? null : aqi <= 50 ? 'Good' : 'Moderate',
  reportingAgency: 'Kansas Department of Health and Environment',
  lookupBehavior: 'Closest Reading By Pollutant',
  consideredMonitors: 'All',
  lookupBoundary: '50 Miles',
  ...over,
});

// The retired services' PascalCase shape (note the trailing space in the date fields). Still understood.
const category = (n: number): { Number: number; Name: string } => ({
  Number: n,
  Name: ['Unknown', 'Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'][n],
});

const obsOld = (parameter: string, aqi: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  DateObserved: '2026-10-08 ',
  HourObserved: 20,
  LocalTimeZone: 'CST',
  ReportingArea: 'Topeka',
  StateCode: 'KS',
  ParameterName: parameter,
  AQI: aqi,
  Category: category(aqi < 0 ? 0 : aqi <= 50 ? 1 : aqi <= 100 ? 2 : 3),
  ...over,
});

const fcOld = (date: string, parameter: string, aqi: number, cat: number, discussion = ''): Record<string, unknown> => ({
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
  it('reads the replacement service: worst NowCast pollutant, OZONE as O3, "20:00" hours', () => {
    const now = parseAirNowCurrent([obsNew('OZONE', 42), obsNew('PM2.5', 57)], 'America/Chicago', FALLBACK_ISO);
    expect(now).toEqual({
      source: 'airnow',
      aqi: 57,
      primaryPollutant: 'PM2.5',
      reportingArea: 'Topeka',
      // 20:00 CST (UTC-6) on 2026-10-08
      observedAt: '2026-10-09T02:00:00Z',
    });
    const ozone = parseAirNowCurrent([obsNew('OZONE', 61), obsNew('PM2.5', 20)], 'America/Chicago', FALLBACK_ISO);
    expect(ozone?.primaryPollutant).toBe('O3');
  });

  it('ignores null and negative NowCast values', () => {
    expect(parseAirNowCurrent([obsNew('PM2.5', null), obsNew('OZONE', 33)], 'America/Chicago', FALLBACK_ISO)?.aqi).toBe(33);
    expect(parseAirNowCurrent([obsNew('PM2.5', null), obsNew('OZONE', -1)], 'America/Chicago', FALLBACK_ISO)).toBeNull();
    // A real valid zero still counts.
    expect(parseAirNowCurrent([obsNew('OZONE', 0)], 'America/Chicago', FALLBACK_ISO)?.aqi).toBe(0);
  });

  it('still reads the retired PascalCase shape (worst pollutant wins)', () => {
    const now = parseAirNowCurrent([obsOld('O3', 42), obsOld('PM2.5', 57), obsOld('PM10', 31)], 'America/Chicago', FALLBACK_ISO);
    expect(now).toEqual({ source: 'airnow', aqi: 57, primaryPollutant: 'PM2.5', reportingArea: 'Topeka', observedAt: '2026-10-09T02:00:00Z' });
    expect(parseAirNowCurrent([obsOld('O3', -1), obsOld('PM10', -1)], 'America/Chicago', FALLBACK_ISO)).toBeNull();
  });

  it('is null for an empty answer (no monitor within 50 miles)', () => {
    expect(parseAirNowCurrent([], 'America/Chicago', FALLBACK_ISO)).toBeNull();
    expect(parseAirNowCurrent({}, 'America/Chicago', FALLBACK_ISO)).toBeNull();
  });

  it('understands the time zone abbreviations AirNow uses', () => {
    const at = (zone: string, hour: string | number = '12:00'): string | undefined =>
      parseAirNowCurrent([obsNew('OZONE', 10, { localTimeZone: zone, hourObserved: hour })], 'America/Chicago', FALLBACK_ISO)?.observedAt;
    expect(at('EST')).toBe('2026-10-08T17:00:00Z');
    expect(at('CDT')).toBe('2026-10-08T17:00:00Z');
    expect(at('PST')).toBe('2026-10-08T20:00:00Z');
    expect(at('AKDT')).toBe('2026-10-08T20:00:00Z');
    expect(at('HST')).toBe('2026-10-08T22:00:00Z');
    expect(at('AST')).toBe('2026-10-08T16:00:00Z');
    expect(at('ChST')).toBe('2026-10-08T02:00:00Z');
    expect(at('CST', 12)).toBe('2026-10-08T18:00:00Z');
    expect(at('CST', '7')).toBe('2026-10-08T13:00:00Z');
  });

  it('uses the place time zone for an unknown abbreviation, and the fallback time when the date or hour is unreadable', () => {
    expect(parseAirNowCurrent([obsNew('OZONE', 10, { localTimeZone: 'XYZ' })], 'America/Chicago', FALLBACK_ISO)?.observedAt).toBe(
      '2026-10-09T01:00:00Z', // 20:00 CDT
    );
    expect(parseAirNowCurrent([obsNew('OZONE', 10, { dateObserved: '' })], 'America/Chicago', FALLBACK_ISO)?.observedAt).toBe(FALLBACK_ISO);
    expect(parseAirNowCurrent([obsNew('OZONE', 10, { hourObserved: 'noon' })], 'America/Chicago', FALLBACK_ISO)?.observedAt).toBe(FALLBACK_ISO);
  });

  it('treats an error body about the key as a rejected key, in either shape', () => {
    for (const body of [{ WebServiceError: [{ Message: 'Invalid API key' }] }, [{ WebServiceError: [{ Error: 'Invalid API_KEY' }] }], { WebServiceError: [{ Message: 'Request not authenticated.' }] }]) {
      expect(() => parseAirNowCurrent(body, 'America/Chicago', FALLBACK_ISO)).toThrow(AirNowKeyError);
      expect(() => parseAirNowForecast(body)).toThrow(AirNowKeyError);
    }
  });

  it('turns any other error body into a short AirNowServiceError with AirNow’s own words and no key-like text', () => {
    const body = { WebServiceError: [{ Message: 'Hourly request limit reached for 01234567-89ab-cdef-0123-456789abcdef.' }] };
    let err: unknown;
    try {
      parseAirNowCurrent(body, 'America/Chicago', FALLBACK_ISO);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AirNowServiceError);
    expect((err as Error).message).toBe('Hourly request limit reached for ….');
    expect(describeAirNowFailure(err)).toBe('AirNow: Hourly request limit reached for ….');
  });
});

describe('AirNow forecast', () => {
  it('collapses to one day per date using the worst pollutant (retired PascalCase shape)', () => {
    const days = parseAirNowForecast([
      fcOld('2026-10-09', 'PM2.5', 38, 1),
      fcOld('2026-10-09', 'O3', 62, 2, ' Ozone will build.\n Sensitive groups take care. '),
      fcOld('2026-10-10', 'O3', 105, 3),
      fcOld('2026-10-10', 'PM2.5', 40, 1),
    ]);
    expect(days).toEqual([
      { date: '2026-10-09', aqi: 62, categoryNumber: 2, primaryPollutant: 'O3', discussion: 'Ozone will build.\n Sensitive groups take care.', source: 'airnow' },
      { date: '2026-10-10', aqi: 105, categoryNumber: 3, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
    ]);
  });

  it('reads camelCase records with a category name and no number, including nested lists', () => {
    const body = {
      reportingAreaName: 'Topeka',
      forecasts: [
        { dateForecast: '2026-10-09', parameterName: 'OZONE', aqi: null, aqiCategoryName: 'Unhealthy for Sensitive Groups', discussion: 'Hot and stagnant.' },
        { dateForecast: '2026-10-09', parameterName: 'PM2.5', aqi: 44, aqiCategoryName: 'Good' },
        { dateForecast: '2026-10-10', parameterName: 'PM2.5', aqi: '57', aqiCategoryName: 'Moderate' },
      ],
    };
    expect(parseAirNowForecast(body)).toEqual([
      { date: '2026-10-09', aqi: null, categoryNumber: 3, primaryPollutant: 'O3', discussion: 'Hot and stagnant.', source: 'airnow' },
      { date: '2026-10-10', aqi: 57, categoryNumber: 2, primaryPollutant: 'PM2.5', discussion: null, source: 'airnow' },
    ]);
  });

  it('prefers a numeric AQI over a category-only one in the same category', () => {
    const [day] = parseAirNowForecast([fcOld('2026-10-09', 'PM2.5', -1, 2), fcOld('2026-10-09', 'O3', 70, 2)]);
    expect(day.aqi).toBe(70);
    expect(day.primaryPollutant).toBe('O3');
  });

  it('derives the category from the AQI when none is given, and skips rows with neither or no date', () => {
    const rows = [
      { DateForecast: '2026-10-09 ', ParameterName: 'O3', AQI: 120 },
      { DateForecast: '2026-10-10 ', ParameterName: 'O3', AQI: -1 },
      { DateForecast: 'garbage', ParameterName: 'O3', AQI: 10, Category: category(1) },
    ];
    expect(parseAirNowForecast(rows)).toEqual([
      { date: '2026-10-09', aqi: 120, categoryNumber: 3, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
    ]);
  });

  it('is empty for an empty or unrecognised answer', () => {
    expect(parseAirNowForecast([])).toEqual([]);
    expect(parseAirNowForecast({ something: 'else' })).toEqual([]);
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

  it('calls the replacement services (not the endpoints AirNow retired on 2026-09-30) and encodes the key', () => {
    const cur = new URL(currentUrl(39.7456, -97.0892, 'a+b/c'));
    expect(cur.origin + cur.pathname).toBe('https://www.airnowapi.org/aq/observation/current/ziplatlong/');
    expect(cur.searchParams.get('latitude')).toBe('39.7456');
    expect(cur.searchParams.get('longitude')).toBe('-97.0892');
    expect(cur.searchParams.get('format')).toBe('application/json');
    expect(cur.searchParams.get('API_KEY')).toBe('a+b/c');
    const fc = new URL(forecastUrl(39.7456, -97.0892, 'k'));
    expect(fc.origin + fc.pathname).toBe('https://www.airnowapi.org/aq/forecast/current/');
    expect(fc.searchParams.get('latitude')).toBe('39.7456');
    for (const u of [cur, fc]) expect(u.pathname).not.toMatch(/latLong/);
  });

  it('loads current conditions and the forecast in parallel (two requests)', async () => {
    const mock = mockFetch(null, {
      airnow: (url) =>
        url.includes('/observation/')
          ? { status: 200, body: [obsNew('OZONE', 45), obsNew('PM2.5', 52)] }
          : { status: 200, body: [fcOld('2026-10-07', 'O3', 40, 1), fcOld('2026-10-08', 'O3', 50, 1), fcOld('2026-10-09', 'PM2.5', -1, 2, 'Smoke drifting in.')] },
    });
    vi.stubGlobal('fetch', mock.fetch);
    const result = await loadAirNow(args);
    expect(mock.count('airnow')).toBe(2);
    expect(result.problem).toBeNull();
    expect(result.current).toMatchObject({ source: 'airnow', aqi: 52, primaryPollutant: 'PM2.5', reportingArea: 'Topeka' });
    // Days before today are dropped.
    expect(result.forecast.map((d) => [d.date, d.aqi, d.categoryNumber])).toEqual([
      ['2026-10-08', 50, 1],
      ['2026-10-09', null, 2],
    ]);
  });

  it('keeps the current reading when only the forecast fails, without reporting a problem', async () => {
    const mock = mockFetch(null, {
      airnow: (url) => (url.includes('/observation/') ? { status: 200, body: [obsNew('PM2.5', 30)] } : { status: 400, body: 'Bad Request' }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const result = await loadAirNow(args);
    expect(result.current?.aqi).toBe(30);
    expect(result.forecast).toEqual([]);
    expect(result.problem).toBeNull();
  });

  it('keeps the forecast and reports a problem when only the current reading fails', async () => {
    const mock = mockFetch(null, {
      airnow: (url) => (url.includes('/observation/') ? serverError(500) : { status: 200, body: [fcOld('2026-10-09', 'O3', 61, 2)] }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const result = await loadAirNow(args);
    expect(result.current).toBeNull();
    expect(result.forecast).toHaveLength(1);
    expect(result.problem).toBe('AirNow is temporarily unavailable.');
  });

  it('says plainly when AirNow has retired a service (HTTP 410), and includes the status for other 4xx answers', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 410, body: 'Gone' } }).fetch);
    expect((await loadAirNow(args)).problem).toBe('AirNow has retired the service this app uses (HTTP 410), so the app needs an update.');
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 400, body: 'Bad Request' } }).fetch);
    expect((await loadAirNow(args)).problem).toBe('AirNow returned an unexpected response (HTTP 400).');
    expect(describeAirNowFailure(new HttpError(418, 'x'))).toBe('AirNow returned an unexpected response (HTTP 418).');
  });

  it('passes AirNow’s own error text through as the problem', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(null, { airnow: { status: 200, body: { WebServiceError: [{ Message: 'Hourly request limit reached.' }] } } }).fetch,
    );
    const result = await loadAirNow(args);
    expect(result.current).toBeNull();
    expect(result.problem).toBe('AirNow: Hourly request limit reached.');
  });

  it('turns a 401 into AirNowKeyError', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 401, body: '' } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
    await expect(loadAirNow(args)).rejects.toThrow('AirNow rejected the API key');
  });

  it('turns 403 and a key error body into AirNowKeyError too, even when only one request says so', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 403, body: '' } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 200, body: { WebServiceError: [{ Message: 'Invalid API key' }] } } }).fetch);
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
    vi.stubGlobal(
      'fetch',
      mockFetch(null, {
        airnow: (url) => (url.includes('/forecast/') ? { status: 401, body: '' } : { status: 200, body: [obsNew('PM2.5', 30)] }),
      }).fetch,
    );
    await expect(loadAirNow(args)).rejects.toBeInstanceOf(AirNowKeyError);
  });

  it('never puts the key in an error message or problem', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: 'network-error' }).fetch);
    const r1 = await loadAirNow(args);
    expect(r1.problem).toBe("Couldn't reach AirNow.");
    expect(JSON.stringify(r1)).not.toContain(args.key);

    vi.stubGlobal('fetch', mockFetch(null, { airnow: serverError(500) }).fetch);
    const r2 = await loadAirNow(args);
    expect(JSON.stringify(r2)).not.toContain(args.key);
  });

  it('returns empty results without a problem when AirNow knows no monitor nearby (empty arrays are not an error)', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { airnow: { status: 200, body: [] } }).fetch);
    await expect(loadAirNow(args)).resolves.toEqual({ current: null, forecast: [], problem: null });
  });
});
