import { describe, expect, it } from 'vitest';
import { BadResponseError } from './http';
import {
  airQualityUrl,
  aqiCategoryNumber,
  currentAirFromOpenMeteo,
  dailyAirFromOpenMeteo,
  gfsUrl,
  hourlyAqiMap,
  parseAirQuality,
  parseGfs,
  primaryPollutantOf,
} from './openMeteo';
import { loadFixture } from './testing/fixtures';
import { HOUR_MS, addDays, zonedWallToMs } from './time';

/** The `time` column Open-Meteo sends with timeformat=unixtime: each local date's midnight as a true instant. */
const midnights = (dates: string[], tz: string): number[] => dates.map((d) => zonedWallToMs(d, 0, 0, tz) / 1000);

function gfsBody(times: number[], daily: Record<string, Array<number | null>> = {}, hourly?: { time: number[]; uv_index: Array<number | null> }) {
  return { daily: { time: times, ...daily }, ...(hourly ? { hourly } : {}) };
}

describe('Open-Meteo GFS: units', () => {
  it('converts snowfall from centimetres (what Open-Meteo sends) to millimetres, and leaves precipitation in mm', () => {
    const fx = loadFixture('utqiagvik-ak');
    const raw = (fx.responses.gfs?.body as { daily: Record<string, number[]>; daily_units: Record<string, string> }).daily;
    expect((fx.responses.gfs?.body as { daily_units: Record<string, string> }).daily_units.snowfall_sum).toBe('cm');
    const { days } = parseGfs(fx.responses.gfs?.body, 'America/Anchorage');
    expect(raw.snowfall_sum[2]).toBe(1.47); // 1.47 cm of snow...
    expect(days[2].snowMm).toBeCloseTo(14.7, 6); // ...is 14.7 mm
    expect(days[7].snowMm).toBeCloseTo(2.1, 6);
    expect(days[0].snowMm).toBe(0); // a real zero stays zero (not null)
    expect(days[2].precipMm).toBe(raw.precipitation_sum[2]); // mm already
    for (const [i, d] of days.entries()) {
      expect(d.snowMm).toBeCloseTo(raw.snowfall_sum[i] * 10, 6);
      expect(d.highC).toBe(raw.temperature_2m_max[i]);
      expect(d.windKph).toBe(raw.wind_speed_10m_max[i]);
    }
  });

  it('keeps missing or non-numeric values as null instead of NaN', () => {
    const [t] = midnights(['2026-10-09'], 'America/Chicago');
    const { days } = parseGfs(gfsBody([t], { snowfall_sum: [null], precipitation_sum: [Number.NaN], temperature_2m_max: [12] }), 'America/Chicago');
    expect(days[0].snowMm).toBeNull();
    expect(days[0].precipMm).toBeNull();
    expect(days[0].highC).toBe(12);
    expect(days[0].lowC).toBeNull();
    expect(Object.values(days[0]).every((v) => v === null || typeof v === 'string' || Number.isFinite(v))).toBe(true);
  });
});

describe('Open-Meteo GFS: dates are the location\'s calendar dates', () => {
  const cases: Array<[string, string, string, number]> = [
    ['America/Chicago, across the fall-back night (Nov 1 is 25 hours)', 'America/Chicago', '2026-10-30', 5],
    ['America/Chicago, across the spring-forward night (Mar 14 is 23 hours)', 'America/Chicago', '2027-03-12', 5],
    ['America/Anchorage, across the fall-back night', 'America/Anchorage', '2026-10-30', 5],
    ['America/Phoenix (no DST)', 'America/Phoenix', '2026-10-30', 5],
    ['Pacific/Honolulu (UTC-10: midnight is 10:00Z)', 'Pacific/Honolulu', '2026-10-30', 5],
    ['America/Puerto_Rico (UTC-4)', 'America/Puerto_Rico', '2026-10-30', 5],
    ['Pacific/Guam (UTC+10: midnight is 14:00Z the day before)', 'Pacific/Guam', '2026-10-30', 5],
    ['Pacific/Pago_Pago (UTC-11)', 'Pacific/Pago_Pago', '2026-12-30', 5],
  ];

  it.each(cases)('%s', (_label, tz, first, count) => {
    const dates = Array.from({ length: count }, (_, i) => addDays(first, i));
    const { days } = parseGfs(gfsBody(midnights(dates, tz), { temperature_2m_max: dates.map((_, i) => 20 + i) }), tz);
    expect(days.map((d) => d.date)).toEqual(dates);
    expect(days.map((d) => d.highC)).toEqual([20, 21, 22, 23, 24]); // each row keeps its own values
  });

  it('a mid-year run of eleven days is eleven consecutive dates with no gap or repeat', () => {
    const dates = Array.from({ length: 11 }, (_, i) => addDays('2026-10-27', i)); // spans the 2026-11-01 change
    const { days } = parseGfs(gfsBody(midnights(dates, 'America/Chicago')), 'America/Chicago');
    expect(days.map((d) => d.date)).toEqual(dates);
    expect(new Set(days.map((d) => d.date)).size).toBe(11);
  });

  it('keys hourly UV by the exact start of the hour', () => {
    const start = Date.parse('2026-11-01T05:00:00Z') / 1000;
    const hours = Array.from({ length: 26 }, (_, i) => start + i * 3600);
    const uv = hours.map((_, i) => (i === 14 ? 6.4 : i === 15 ? null : 0));
    const { uvByHour } = parseGfs(gfsBody([], {}, { time: hours, uv_index: uv }), 'America/Chicago');
    expect(uvByHour.get(Date.parse('2026-11-01T19:00:00Z'))).toBe(6.4);
    expect(uvByHour.has(Date.parse('2026-11-01T20:00:00Z'))).toBe(false); // null is absent, not 0
    expect(uvByHour.size).toBe(25);
    for (const key of uvByHour.keys()) expect(key % HOUR_MS).toBe(0);
  });
});

describe('Open-Meteo GFS: bad answers and the request', () => {
  it('rejects an answer with neither daily nor hourly data, and ignores unusable rows', () => {
    expect(() => parseGfs({}, 'America/Chicago')).toThrow(BadResponseError);
    expect(() => parseGfs(null, 'America/Chicago')).toThrow(BadResponseError);
    expect(() => parseGfs({ error: true, reason: 'Parameter out of range' }, 'America/Chicago')).toThrow(BadResponseError);
    const [t] = midnights(['2026-10-09'], 'America/Chicago');
    const { days } = parseGfs({ daily: { time: ['junk', null, t], temperature_2m_max: [1, 2, 3] } }, 'America/Chicago');
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: '2026-10-09', highC: 3 });
  });

  it('asks for eleven days with unix times in the location\'s zone, and sends no key', () => {
    const url = new URL(gfsUrl(39.7456, -97.0892, 'America/Chicago'));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/gfs');
    expect(url.searchParams.get('latitude')).toBe('39.7456');
    expect(url.searchParams.get('longitude')).toBe('-97.0892');
    expect(url.searchParams.get('timezone')).toBe('America/Chicago');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('forecast_days')).toBe('11');
    expect(url.searchParams.get('hourly')).toBe('uv_index');
    const daily = (url.searchParams.get('daily') ?? '').split(',');
    for (const v of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'snowfall_sum', 'precipitation_sum', 'uv_index_max']) expect(daily).toContain(v);
    expect([...url.searchParams.keys()].some((k) => /key/i.test(k))).toBe(false);
  });
});

describe('Open-Meteo air quality', () => {
  it('asks for the hourly US AQI and its sub-indices in the location\'s zone', () => {
    const url = new URL(airQualityUrl(18.4655, -66.1057, 'America/Puerto_Rico'));
    expect(url.origin + url.pathname).toBe('https://air-quality-api.open-meteo.com/v1/air-quality');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('timezone')).toBe('America/Puerto_Rico');
    expect((url.searchParams.get('hourly') ?? '').split(',')).toEqual(['us_aqi', 'us_aqi_pm2_5', 'us_aqi_pm10', 'us_aqi_ozone']);
  });

  const hourlyBody = (startIso: string, aqi: Array<number | null>, over: Record<string, Array<number | null>> = {}) => {
    const start = Date.parse(startIso) / 1000;
    return {
      hourly: {
        time: aqi.map((_, i) => start + i * 3600),
        us_aqi: aqi,
        us_aqi_pm2_5: aqi.map(() => null),
        us_aqi_pm10: aqi.map(() => null),
        us_aqi_ozone: aqi.map(() => null),
        ...over,
      },
    };
  };

  it('uses the worst hour of each local calendar day, so evening hours that are already tomorrow in UTC count for today', () => {
    // Index i is 01:00Z + i hours, which is 20:00 CDT on Oct 8 + i hours.
    const aqi = Array.from({ length: 30 }, (_, i) => 30 + (i % 5));
    aqi[3] = 40; // 23:00 CDT Oct 8
    aqi[27] = 92; // 23:00 CDT Oct 9: 04:00Z on the 10th, so the 10th in UTC but still the 9th in Chicago
    aqi[28] = 55; // 00:00 CDT Oct 10
    const aq = parseAirQuality(hourlyBody('2026-10-09T01:00:00Z', aqi));
    const days = dailyAirFromOpenMeteo(aq, 'America/Chicago', '2026-10-08');
    expect(days.map((d) => [d.date, d.aqi])).toEqual([
      ['2026-10-08', 40],
      ['2026-10-09', 92],
      ['2026-10-10', 55],
    ]);
    expect(days[1]).toMatchObject({ categoryNumber: 2, source: 'open-meteo', discussion: null });
    // Dates before `fromDate` are dropped.
    expect(dailyAirFromOpenMeteo(aq, 'America/Chicago', '2026-10-09').map((d) => d.date)).toEqual(['2026-10-09', '2026-10-10']);
  });

  it('keeps the 25 hours of the fall-back day together, and the hour after 00:00 CST belongs to the next day', () => {
    // Nov 1 2026 in Chicago runs from 05:00Z (00:00 CDT) to 06:00Z on the 2nd (00:00 CST): 25 hours.
    const aqi = Array.from({ length: 28 }, () => 10); // 03:00Z Nov 1 ... 06:00Z Nov 2
    aqi[1] = 21; // 04:00Z = 23:00 CDT Oct 31
    aqi[2] = 61; // 05:00Z = 00:00 CDT Nov 1, the first hour of the day
    aqi[26] = 99; // 05:00Z Nov 2 = 23:00 CST Nov 1, the last hour of the day
    aqi[27] = 70; // 06:00Z Nov 2 = 00:00 CST Nov 2
    const days = dailyAirFromOpenMeteo(parseAirQuality(hourlyBody('2026-11-01T03:00:00Z', aqi)), 'America/Chicago', '2026-10-31');
    expect(days.map((d) => [d.date, d.aqi])).toEqual([
      ['2026-10-31', 21],
      ['2026-11-01', 99],
      ['2026-11-02', 70],
    ]);
  });

  it('names the pollutant with the largest sub-index, using AirNow\'s names', () => {
    expect(primaryPollutantOf(undefined)).toBeNull();
    expect(primaryPollutantOf({ aqi: 80, pm25: 80, pm10: 40, ozone: 55 })).toBe('PM2.5');
    expect(primaryPollutantOf({ aqi: 80, pm25: 20, pm10: 40, ozone: 80 })).toBe('O3');
    expect(primaryPollutantOf({ aqi: 80, pm25: null, pm10: 80, ozone: null })).toBe('PM10');
    expect(primaryPollutantOf({ aqi: null, pm25: null, pm10: null, ozone: null })).toBeNull();
  });

  it('turns the model "current" value into the AirNow-shaped reading, rounded, with a primary pollutant', () => {
    const body = { ...hourlyBody('2026-10-09T02:00:00Z', [43, 51], { us_aqi_pm2_5: [43, 51] }), current: { time: Date.parse('2026-10-09T02:30:00Z') / 1000, us_aqi: 43.6 } };
    const air = currentAirFromOpenMeteo(parseAirQuality(body), Date.parse('2026-10-09T02:40:00Z'));
    expect(air).toEqual({ source: 'open-meteo', aqi: 44, primaryPollutant: 'PM2.5', observedAt: '2026-10-09T02:30:00Z', reportingArea: null });
    expect(currentAirFromOpenMeteo(parseAirQuality(hourlyBody('2026-10-09T02:00:00Z', [null])), Date.parse('2026-10-09T02:40:00Z'))).toBeNull();
  });

  it('maps hours to rounded AQI values and skips missing ones', () => {
    const map = hourlyAqiMap(parseAirQuality(hourlyBody('2026-10-09T02:00:00Z', [43.4, null, 51.6])));
    expect([...map.entries()]).toEqual([
      [Date.parse('2026-10-09T02:00:00Z'), 43],
      [Date.parse('2026-10-09T04:00:00Z'), 52],
    ]);
  });

  it('rejects an empty answer and reads the category number at the EPA breakpoints', () => {
    expect(() => parseAirQuality({})).toThrow(BadResponseError);
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map(aqiCategoryNumber)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
});
