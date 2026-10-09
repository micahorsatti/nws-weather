import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from '../cache';
import { BadResponseError, HttpError, httpConfig } from '../http';
import { fixtureNow, loadFixture, mockFetch, serverError, type Fixture } from '../testing/fixtures';
import { WeatherLoadError, type WeatherAlert } from '../types';
import { loadAlerts, parseAlerts, sortAlerts } from './alerts';
import { discussionUrl, loadForecastDiscussion, newestProductId, parseDiscussion } from './discussion';
import { parseForecast, parseHourlyForecast, parseWindSpeedKph } from './forecast';
import {
  OBSERVATION_MAX_AGE_MS,
  isUsableObservation,
  loadCurrentObservation,
  parseObservation,
  parseStations,
} from './observations';
import { loadPoint, parsePoint, pointKey } from './points';

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
  vi.useRealTimers();
  clearAllCaches();
});

const at = (fx: Fixture, minutes = 3): void => {
  vi.setSystemTime(fixtureNow(fx, minutes));
};

describe('NWS /points', () => {
  it('extracts grid, zone and location details', () => {
    const fx = loadFixture('linn-ks');
    const { info, urls } = parsePoint(fx.responses.points.body);
    expect(info).toEqual({
      wfo: 'TOP',
      gridX: 32,
      gridY: 81,
      timeZone: 'America/Chicago',
      city: 'Linn',
      state: 'KS',
      radarStation: 'KTWX',
      forecastZone: 'https://api.weather.gov/zones/forecast/KSZ009',
      county: 'https://api.weather.gov/zones/county/KSC201',
    });
    expect(urls).toEqual({
      forecast: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast',
      forecastHourly: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly',
      forecastGrid: 'https://api.weather.gov/gridpoints/TOP/32,81',
      stations: 'https://api.weather.gov/gridpoints/TOP/32,81/stations',
    });
  });

  it('allows a null radar station (Utqiagvik) and other time zones', () => {
    const utq = parsePoint(loadFixture('utqiagvik-ak').responses.points.body);
    expect(utq.info.radarStation).toBeNull();
    expect(utq.info.timeZone).toBe('America/Anchorage');
    expect(parsePoint(loadFixture('san-juan-pr').responses.points.body).info.timeZone).toBe('America/Puerto_Rico');
    expect(parsePoint(loadFixture('phoenix-az').responses.points.body).info.timeZone).toBe('America/Phoenix');
  });

  it('builds the endpoint URLs from the grid when the response omits them, and tolerates a missing relativeLocation', () => {
    const { info, urls } = parsePoint({ properties: { gridId: 'OKX', gridX: 33, gridY: 35, timeZone: 'America/New_York' } });
    expect(info.city).toBe('');
    expect(info.state).toBe('');
    expect(urls.forecast).toBe('https://api.weather.gov/gridpoints/OKX/33,35/forecast');
    expect(urls.stations).toBe('https://api.weather.gov/gridpoints/OKX/33,35/stations');
  });

  it('rejects a response without a grid or time zone', () => {
    expect(() => parsePoint({ properties: { gridId: 'OKX', gridX: 1, gridY: 2 } })).toThrow(BadResponseError);
    expect(() => parsePoint({})).toThrow(BadResponseError);
    expect(() => parsePoint(null)).toThrow(BadResponseError);
  });

  it('uses at most four decimals, as NWS requires', () => {
    expect(pointKey(39.74561234, -97.08921234)).toBe('39.7456,-97.0892');
  });

  it('loads a point once, then serves it from the on-device cache for a week', async () => {
    const fx = loadFixture('linn-ks');
    at(fx);
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const first = await loadPoint(fx.lat, fx.lon);
    const second = await loadPoint(fx.lat, fx.lon);
    expect(second).toEqual(first);
    expect(mock.count('points')).toBe(1);
    expect(mock.calls[0]).toBe('https://api.weather.gov/points/39.7456,-97.0892');

    vi.setSystemTime(fixtureNow(fx) + 6 * 24 * 3_600_000);
    await loadPoint(fx.lat, fx.lon);
    expect(mock.count('points')).toBe(1);

    vi.setSystemTime(fixtureNow(fx) + 8 * 24 * 3_600_000);
    await loadPoint(fx.lat, fx.lon);
    expect(mock.count('points')).toBe(2); // expired: refreshed
  });

  it('falls back to an expired cached copy when the network fails', async () => {
    const fx = loadFixture('linn-ks');
    at(fx);
    vi.stubGlobal('fetch', mockFetch(fx).fetch);
    const first = await loadPoint(fx.lat, fx.lon);
    vi.setSystemTime(fixtureNow(fx) + 30 * 24 * 3_600_000);
    vi.stubGlobal('fetch', mockFetch(fx, { points: 'network-error' }).fetch);
    await expect(loadPoint(fx.lat, fx.lon)).resolves.toEqual(first);
    vi.stubGlobal('fetch', mockFetch(fx, { points: serverError(500) }).fetch);
    await expect(loadPoint(fx.lat, fx.lon)).resolves.toEqual(first);
  });

  it('reports out-of-coverage for a 404 (Toronto)', async () => {
    const fx = loadFixture('toronto-out-of-coverage');
    expect(fx.responses.points.status).toBe(404);
    vi.stubGlobal('fetch', mockFetch(fx).fetch);
    const err = await loadPoint(fx.lat, fx.lon).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeatherLoadError);
    expect((err as WeatherLoadError).kind).toBe('out-of-coverage');
    expect((err as WeatherLoadError).message).toMatch(/United States/);
  });

  it('rethrows other failures when nothing is cached', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { points: serverError(503) }).fetch);
    await expect(loadPoint(40, -100)).rejects.toBeInstanceOf(HttpError);
    vi.stubGlobal('fetch', mockFetch(null, { points: 'network-error' }).fetch);
    await expect(loadPoint(40, -100)).rejects.toMatchObject({ name: 'NetworkError' });
  });
});

describe('NWS forecast periods', () => {
  const fx = loadFixture('linn-ks');
  const forecast = parseForecast(fx.responses.forecast?.body);

  it('parses 14 day/night periods and the update time', () => {
    expect(forecast.periods).toHaveLength(14);
    expect(forecast.updatedAt).toBe('2026-10-08T23:01:18+00:00');
    expect(forecast.periods.map((p) => p.name).slice(0, 4)).toEqual(['Tonight', 'Friday', 'Friday Night', 'Saturday']);
  });

  it('converts °F to °C and keeps the forecaster text and wind as NWS wrote them', () => {
    const [tonight, friday] = forecast.periods;
    expect(tonight.isDaytime).toBe(false);
    expect(tonight.tempC).toBeCloseTo(((62 - 32) * 5) / 9, 5);
    expect(tonight.precipChancePct).toBe(0);
    expect(tonight.windText).toBe('S 5 to 10 mph');
    expect(tonight.detailedForecast).toBe('Clear, with a low around 62. South wind 5 to 10 mph.');
    expect(tonight.icon).toBe('clear');
    expect(friday.isDaytime).toBe(true);
    expect(friday.tempC).toBeCloseTo(30, 5);
    expect(friday.detailedForecast).toContain('gusts as high as 25 mph');
    expect(friday.startTime).toBe('2026-10-09T06:00:00-05:00');
  });

  it('keeps the NWS offset on period times and sorts chronologically', () => {
    const times = forecast.periods.map((p) => Date.parse(p.startTime));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(forecast.periods.every((p) => /[+-]\d\d:\d\d$|Z$/.test(p.startTime))).toBe(true);
  });

  it('accepts temperatures already in Celsius and null temperatures', () => {
    const parsed = parseForecast({
      properties: {
        updateTime: '2026-10-08T23:01:18+00:00',
        periods: [
          { name: 'Today', startTime: '2026-10-08T06:00:00-05:00', endTime: '2026-10-08T18:00:00-05:00', isDaytime: true, temperature: 21, temperatureUnit: 'C', shortForecast: 'Sunny', detailedForecast: 'x', windSpeed: '5 mph', windDirection: 'N', icon: 'https://api.weather.gov/icons/land/day/skc?size=medium', probabilityOfPrecipitation: { value: null } },
          { name: 'Tonight', startTime: '2026-10-08T18:00:00-05:00', endTime: '2026-10-09T06:00:00-05:00', isDaytime: false, temperature: null, shortForecast: 'Clear' },
        ],
      },
    });
    expect(parsed.periods[0].tempC).toBe(21);
    expect(parsed.periods[0].precipChancePct).toBeNull();
    expect(parsed.periods[1].tempC).toBeNull();
    expect(parsed.periods[1].windText).toBe('');
  });

  it('drops malformed periods and rejects an empty forecast', () => {
    const parsed = parseForecast({ properties: { periods: [{ name: 'Bad' }, { name: 'Ok', startTime: '2026-10-08T06:00:00-05:00', endTime: '2026-10-08T18:00:00-05:00' }] } });
    expect(parsed.periods.map((p) => p.name)).toEqual(['Ok']);
    expect(() => parseForecast({ properties: { periods: [] } })).toThrow(BadResponseError);
    expect(() => parseForecast({})).toThrow(BadResponseError);
  });
});

describe('NWS hourly forecast', () => {
  const fx = loadFixture('linn-ks');
  const hours = parseHourlyForecast(fx.responses.hourly?.body);

  it('parses every hour with numbers in canonical units', () => {
    expect(hours).toHaveLength(156);
    const first = hours[0];
    expect(first.startMs).toBe(Date.parse('2026-10-08T21:00:00-05:00'));
    expect(first.endMs - first.startMs).toBe(3_600_000);
    expect(first.isDaytime).toBe(false);
    expect(first.tempC).toBeCloseTo(21.11, 2); // 70 °F
    expect(first.dewpointC).toBe(15);
    expect(first.humidityPct).toBe(68);
    expect(first.windKph).toBeCloseTo(8.047, 2); // "5 mph"
    expect(first.windDirDeg).toBe(180);
    expect(first.precipChancePct).toBe(0);
    expect(first.icon).toBe('clear');
    expect(first.shortForecast).toBe('Clear');
  });

  it('is chronological with one entry per hour', () => {
    for (let i = 1; i < hours.length; i++) expect(hours[i].startMs - hours[i - 1].startMs).toBe(3_600_000);
  });

  it('rejects an empty feed', () => {
    expect(() => parseHourlyForecast({ properties: { periods: [] } })).toThrow(BadResponseError);
  });
});

describe('wind speed text', () => {
  it.each<[string | null, number | null]>([
    ['5 mph', 8.04672],
    ['5 to 10 mph', 16.09344],
    ['15 mph', 24.14016],
    ['10 km/h', 10],
    ['10 kt', 18.52],
    ['Calm', 0],
    ['', null],
    [null, null],
  ])('%j -> %j km/h', (text, kph) => {
    const parsed = parseWindSpeedKph(text);
    if (kph === null) expect(parsed).toBeNull();
    else expect(parsed).toBeCloseTo(kph, 4);
  });
});

describe('alerts', () => {
  const alert = (over: Record<string, unknown>, id = 'a'): unknown => ({
    id,
    type: 'Feature',
    geometry: null,
    properties: {
      id,
      '@id': `https://api.weather.gov/alerts/${id}`,
      event: 'Severe Thunderstorm Warning',
      headline: 'headline',
      severity: 'Severe',
      urgency: 'Immediate',
      certainty: 'Likely',
      effective: '2026-10-08T20:00:00-05:00',
      onset: '2026-10-08T20:00:00-05:00',
      expires: '2026-10-08T22:00:00-05:00',
      ends: null,
      areaDesc: 'Marshall, KS',
      senderName: 'NWS Topeka KS',
      description: ' Big storm. ',
      instruction: null,
      ...over,
    },
  });

  it('maps an NWS alert (Phoenix air quality alert)', () => {
    const fx = loadFixture('phoenix-az');
    const [a] = parseAlerts(fx.responses.alerts?.body);
    expect(a).toMatchObject({
      event: 'Air Quality Alert',
      severity: 'Unknown',
      urgency: 'Unknown',
      certainty: 'Unknown',
      areaDesc: 'Maricopa, AZ',
      senderName: 'NWS Phoenix AZ',
      instruction: null,
      ends: null,
      geometry: null,
    });
    expect(a.id).toMatch(/^urn:oid:/);
    expect(a.url).toBe(`https://api.weather.gov/alerts/${a.id}`);
    expect(a.headline).toContain('Air Quality Alert issued October 8');
    expect(a.description).toContain('Ozone High Pollution Advisory');
  });

  it('sorts by severity, then by onset', () => {
    const features = {
      features: [
        alert({ severity: 'Minor', event: 'Wind Advisory', onset: '2026-10-08T01:00:00-05:00' }, 'minor'),
        alert({ severity: 'Extreme', event: 'Tornado Emergency', onset: '2026-10-08T23:00:00-05:00' }, 'extreme-late'),
        alert({ severity: 'Severe', onset: '2026-10-08T21:00:00-05:00' }, 'severe-late'),
        alert({ severity: 'Unknown', event: 'Air Quality Alert' }, 'unknown'),
        alert({ severity: 'Severe', onset: '2026-10-08T19:00:00-05:00' }, 'severe-early'),
        alert({ severity: 'Moderate', event: 'Flood Watch' }, 'moderate'),
        alert({ severity: 'Extreme', event: 'Tornado Warning', onset: '2026-10-08T22:00:00-05:00' }, 'extreme-early'),
      ],
    };
    expect(parseAlerts(features).map((a) => a.id)).toEqual([
      'extreme-early',
      'extreme-late',
      'severe-early',
      'severe-late',
      'moderate',
      'minor',
      'unknown',
    ]);
  });

  it('treats unrecognised severities as Unknown and skips alerts without an event', () => {
    const parsed = parseAlerts({ features: [alert({ severity: 'Catastrophic' }, 'x'), alert({ event: null }, 'y'), { properties: null }, null] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].severity).toBe('Unknown');
  });

  it('keeps polygon geometry and drops other geometry types', () => {
    const ring = [[[-97, 39], [-97, 40], [-96, 40], [-97, 39]]];
    const withPolygon = { ...(alert({}, 'p') as object), geometry: { type: 'Polygon', coordinates: ring } };
    const withPoint = { ...(alert({}, 'q') as object), geometry: { type: 'Point', coordinates: [1, 2] } };
    const multi = { ...(alert({}, 'm') as object), geometry: { type: 'MultiPolygon', coordinates: [ring] } };
    const parsed = parseAlerts({ features: [withPolygon, withPoint, multi] });
    expect(parsed.find((a) => a.id === 'p')?.geometry).toEqual({ type: 'Polygon', coordinates: ring });
    expect(parsed.find((a) => a.id === 'q')?.geometry).toBeNull();
    expect(parsed.find((a) => a.id === 'm')?.geometry?.type).toBe('MultiPolygon');
  });

  it('drops alerts that have already ended, but keeps ones with no end time', () => {
    const feed = {
      features: [
        alert({ expires: '2026-10-08T10:00:00-05:00', ends: '2026-10-08T10:00:00-05:00' }, 'over'),
        alert({ expires: '2026-10-08T10:00:00-05:00', ends: '2026-10-09T10:00:00-05:00' }, 'ends-later'),
        alert({ expires: null, ends: null }, 'open-ended'),
        alert({ expires: '2026-10-09T01:00:00-05:00' }, 'current'),
      ],
    };
    const now = Date.parse('2026-10-08T15:00:00-05:00');
    expect(parseAlerts(feed, now).map((a) => a.id).sort()).toEqual(['current', 'ends-later', 'open-ended']);
    expect(parseAlerts(feed)).toHaveLength(4);
  });

  it('sortAlerts does not mutate its input', () => {
    const list = parseAlerts({ features: [alert({ severity: 'Minor' }, 'a'), alert({ severity: 'Extreme' }, 'b')] });
    const copy: WeatherAlert[] = [...list];
    sortAlerts(copy);
    expect(copy).toEqual(list);
  });

  it('loads active alerts for a point', async () => {
    const fx = loadFixture('phoenix-az');
    at(fx);
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const alerts = await loadAlerts(fx.lat, fx.lon, fixtureNow(fx));
    expect(alerts).toHaveLength(1);
    expect(mock.calls[0]).toBe('https://api.weather.gov/alerts/active?point=33.4484,-112.0740');
  });
});

describe('station observations', () => {
  const utq = loadFixture('utqiagvik-ak');
  const sj = loadFixture('san-juan-pr');
  const obsBody = (fx: Fixture, id: string): unknown => fx.responses.observations?.[id]?.body;

  it('lists stations nearest first', () => {
    expect(parseStations(utq.responses.stations?.body).slice(0, 3).map((s) => s.id)).toEqual(['PABR', 'PATQ', 'PAQT']);
    expect(parseStations(null)).toEqual([]);
  });

  it('parses SI values, unit codes and reported feels-like fields', () => {
    const obs = parseObservation(obsBody(utq, 'PABR'));
    expect(obs).toMatchObject({
      stationId: 'PABR',
      tempC: -7,
      humidityPct: expect.closeTo(79.17, 1),
      windKph: expect.closeTo(16.668, 2),
      windDirDeg: expect.any(Number),
      heatIndexC: null,
      windChillC: expect.closeTo(-13.4, 1),
      description: 'Clear',
    });
    expect(obs?.observedAtMs).toBe(Date.parse('2026-10-09T02:20:00+00:00'));
    const kmyz = parseObservation(obsBody(loadFixture('linn-ks'), 'KMYZ'));
    expect(kmyz?.pressurePa).toBe(101520);
    expect(kmyz?.visibilityM).toBe(16090);
    expect(kmyz?.heatIndexC).toBeCloseTo(21.64, 1); // reported even though it does not apply at 22 °C
    expect(kmyz?.windGustKph).toBeNull();
  });

  it('treats QC-rejected values as missing and clamps humidity', () => {
    const base = obsBody(utq, 'PABR') as { properties: Record<string, unknown> };
    const doctored = {
      properties: {
        ...base.properties,
        temperature: { unitCode: 'wmoUnit:degC', value: 99, qualityControl: 'X' },
        relativeHumidity: { unitCode: 'wmoUnit:percent', value: 104, qualityControl: 'V' },
      },
    };
    const obs = parseObservation(doctored);
    expect(obs?.tempC).toBeNull();
    expect(obs?.humidityPct).toBe(100);
  });

  it('is unusable when stale or without a temperature', () => {
    const now = fixtureNow(utq);
    expect(isUsableObservation(parseObservation(obsBody(utq, 'PABR'))!, now)).toBe(true);
    expect(isUsableObservation(parseObservation(obsBody(utq, 'PAQT'))!, now)).toBe(false); // three days old
    expect(isUsableObservation(parseObservation(obsBody(sj, 'TJPS'))!, now)).toBe(false); // temperature null
    const fresh = parseObservation(obsBody(utq, 'PABR'))!;
    expect(isUsableObservation(fresh, fresh.observedAtMs + OBSERVATION_MAX_AGE_MS - 1)).toBe(true);
    expect(isUsableObservation(fresh, fresh.observedAtMs + OBSERVATION_MAX_AGE_MS)).toBe(false);
  });

  it('returns null for a report without a timestamp', () => {
    expect(parseObservation({ properties: { temperature: { value: 1, unitCode: 'wmoUnit:degC' } } })).toBeNull();
    expect(parseObservation(null)).toBeNull();
  });

  describe('choosing a station', () => {
    const stationsUrl = 'https://api.weather.gov/gridpoints/AFG/379,357/stations';
    const withTemp = (fx: Fixture, id: string, value: number | null): { status: number; body: unknown } => {
      const body = JSON.parse(JSON.stringify(obsBody(fx, id))) as { properties: { temperature: { value: number | null } } };
      body.properties.temperature.value = value;
      return { status: 200, body };
    };

    it('uses the nearest station when its report is fresh', async () => {
      at(utq);
      const mock = mockFetch(utq);
      vi.stubGlobal('fetch', mock.fetch);
      const obs = await loadCurrentObservation(stationsUrl, fixtureNow(utq));
      expect(obs?.stationId).toBe('PABR');
      expect(obs?.stationName).toBe('Wiley Post-Will Rogers Memorial Airport');
      expect(mock.calls.filter((u) => u.includes('/observations/')).length).toBe(1);
    });

    it('moves on to the next station when the nearest has no temperature', async () => {
      at(utq);
      const mock = mockFetch(utq, { 'obs:PABR': withTemp(utq, 'PABR', null) });
      vi.stubGlobal('fetch', mock.fetch);
      const obs = await loadCurrentObservation(stationsUrl, fixtureNow(utq));
      expect(obs?.stationId).toBe('PATQ');
    });

    it('tries at most the nearest three, then returns null (the caller uses the forecast)', async () => {
      at(utq);
      const mock = mockFetch(utq, { 'obs:PABR': withTemp(utq, 'PABR', null), 'obs:PATQ': withTemp(utq, 'PATQ', null) });
      vi.stubGlobal('fetch', mock.fetch);
      // PAQT (the third) is three days old.
      await expect(loadCurrentObservation(stationsUrl, fixtureNow(utq))).resolves.toBeNull();
      expect(mock.calls.filter((u) => u.includes('/observations/')).length).toBe(3);
    });

    it('survives a failing station if a later one answers', async () => {
      at(utq);
      vi.stubGlobal('fetch', mockFetch(utq, { 'obs:PABR': serverError(500) }).fetch);
      const obs = await loadCurrentObservation(stationsUrl, fixtureNow(utq));
      expect(obs?.stationId).toBe('PATQ');
    });

    it('throws only when no station answered at all, or the station list itself failed', async () => {
      at(utq);
      vi.stubGlobal('fetch', mockFetch(utq, { 'obs:PABR': 'network-error', 'obs:PATQ': 'network-error', 'obs:PAQT': 'network-error' }).fetch);
      await expect(loadCurrentObservation(stationsUrl, fixtureNow(utq))).rejects.toBeTruthy();
      vi.stubGlobal('fetch', mockFetch(utq, { stations: serverError(503) }).fetch);
      await expect(loadCurrentObservation(stationsUrl, fixtureNow(utq))).rejects.toBeInstanceOf(HttpError);
    });

    it('returns null when NWS lists no stations', async () => {
      at(utq);
      vi.stubGlobal('fetch', mockFetch(utq, { stations: { status: 200, body: { features: [] } } }).fetch);
      await expect(loadCurrentObservation(stationsUrl, fixtureNow(utq))).resolves.toBeNull();
    });
  });
});

describe('Area Forecast Discussion', () => {
  const fx = loadFixture('linn-ks');

  it('loads the newest discussion for an office', async () => {
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    const afd = await loadForecastDiscussion('top');
    expect(afd.wfo).toBe('TOP');
    expect(afd.issuedAt).toBe('2026-10-08T23:23:00+00:00');
    expect(afd.text).toContain('Area Forecast Discussion');
    expect(afd.text).toContain('National Weather Service Topeka KS');
    expect(afd.url).toBe('https://forecast.weather.gov/product.php?site=NWS&issuedby=TOP&product=AFD');
    expect(mock.calls[0]).toBe('https://api.weather.gov/products/types/AFD/locations/TOP');
    expect(mock.calls[1]).toMatch(/^https:\/\/api\.weather\.gov\/products\/[0-9a-f-]{36}$/);
  });

  it('exposes the human-readable page', () => {
    expect(discussionUrl('PSR')).toBe('https://forecast.weather.gov/product.php?site=NWS&issuedby=PSR&product=AFD');
    expect(newestProductId({ '@graph': [{ id: 'abc' }, { id: 'def' }] })).toBe('abc');
    expect(newestProductId({ '@graph': [] })).toBeNull();
    expect(parseDiscussion('TOP', { productText: '   ', issuanceTime: 'x' })).toBeNull();
  });

  it('explains an office without a discussion', async () => {
    vi.stubGlobal('fetch', mockFetch(fx, { afdList: { status: 200, body: { '@graph': [] } } }).fetch);
    await expect(loadForecastDiscussion('TOP')).rejects.toMatchObject({ name: 'WeatherLoadError', kind: 'unknown' });
    vi.stubGlobal('fetch', mockFetch(fx, { afdList: { status: 404, body: {} } }).fetch);
    await expect(loadForecastDiscussion('TOP')).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('maps failures to WeatherLoadError kinds', async () => {
    vi.stubGlobal('fetch', mockFetch(fx, { afdList: 'network-error' }).fetch);
    await expect(loadForecastDiscussion('TOP')).rejects.toMatchObject({ name: 'WeatherLoadError', kind: 'network' });
    vi.stubGlobal('fetch', mockFetch(fx, { afdList: serverError(503) }).fetch);
    await expect(loadForecastDiscussion('TOP')).rejects.toMatchObject({ kind: 'nws-unavailable' });
  });

  it('rejects an office code that is not letters before making any request', async () => {
    const mock = mockFetch(fx);
    vi.stubGlobal('fetch', mock.fetch);
    await expect(loadForecastDiscussion('../points')).rejects.toBeInstanceOf(WeatherLoadError);
    await expect(loadForecastDiscussion('')).rejects.toBeInstanceOf(WeatherLoadError);
    expect(mock.calls).toHaveLength(0);
  });

  it('lets an abort through unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', mockFetch(fx).fetch);
    await expect(loadForecastDiscussion('TOP', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
