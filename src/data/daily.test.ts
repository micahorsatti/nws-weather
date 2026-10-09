import { describe, expect, it } from 'vitest';
import { fToC } from '../lib/units';
import { MAX_DAILY_DAYS, buildDaily, groupPeriods } from './daily';
import type { ParsedGrid } from './nws/grid';
import { gfsDays, hourRun, makePeriods, type StartKind } from './testing/builders';
import { HOUR_MS, addDays, localDateOf, zonedWallToMs } from './time';
import type { AirQualityDay } from './types';

const TZ = 'America/Chicago';
const TODAY = '2026-10-08';
const LAT = 39.7456;
const LON = -97.0892;

/** The clock time at which NWS would issue a forecast that starts the given way. */
const NOW: Record<StartKind, number> = {
  today: zonedWallToMs(TODAY, 8, 0, TZ),
  afternoon: zonedWallToMs(TODAY, 14, 30, TZ),
  tonight: zonedWallToMs(TODAY, 21, 30, TZ),
  overnight: zonedWallToMs(TODAY, 2, 30, TZ),
};

/** Grid whose maxTemperature interval began at noon today (as NWS keeps it in the evening). */
const gridWithTodaysHigh = (highC: number, lowC: number): ParsedGrid => ({
  updateTime: null,
  layers: {
    maxTemperature: [{ start: zonedWallToMs(TODAY, 12, 0, TZ), end: zonedWallToMs(TODAY, 21, 0, TZ), value: highC }],
    minTemperature: [{ start: zonedWallToMs(TODAY, 20, 0, TZ), end: zonedWallToMs(addDays(TODAY, 1), 10, 0, TZ), value: lowC }],
  },
});

function build(kind: StartKind, extra: Partial<Parameters<typeof buildDaily>[0]> = {}) {
  return buildDaily({
    now: NOW[kind],
    timeZone: TZ,
    lat: LAT,
    lon: LON,
    periods: makePeriods(kind, TODAY, TZ),
    series: [],
    grid: null,
    gfs: gfsDays(TODAY, 11),
    airForecast: [],
    ...extra,
  });
}

describe('grouping 12-hour periods by local date', () => {
  it('"Today" start: today has a day and a night; seven dates', () => {
    const slots = groupPeriods(makePeriods('today', TODAY, TZ), TZ, TODAY, NOW.today);
    expect(slots).toHaveLength(7);
    expect(slots[0]).toMatchObject({ date: TODAY });
    expect(slots[0].day?.name).toBe('Today');
    expect(slots[0].night?.name).toBe('Tonight');
    expect(slots[1].day?.name).toBe('Friday');
    expect(slots[1].night?.name).toBe('Friday Night');
    expect(slots[6].date).toBe('2026-10-14');
    expect(slots.every((s) => s.day && s.night)).toBe(true);
  });

  it('"This Afternoon" start: the short afternoon period is today\'s day', () => {
    const slots = groupPeriods(makePeriods('afternoon', TODAY, TZ), TZ, TODAY, NOW.afternoon);
    expect(slots).toHaveLength(7);
    expect(slots[0].day?.name).toBe('This Afternoon');
    expect(slots[0].night?.name).toBe('Tonight');
  });

  it('"Tonight" start: today has no day period; the last date has no night', () => {
    const slots = groupPeriods(makePeriods('tonight', TODAY, TZ), TZ, TODAY, NOW.tonight);
    expect(slots).toHaveLength(8);
    expect(slots[0]).toMatchObject({ date: TODAY, day: null });
    expect(slots[0].night?.name).toBe('Tonight');
    expect(slots[7].date).toBe('2026-10-15');
    expect(slots[7].day?.name).toBe('Thursday');
    expect(slots[7].night).toBeNull();
  });

  it('"Overnight" start: the after-midnight period belongs to the previous night and is not in the daily list', () => {
    const periods = makePeriods('overnight', TODAY, TZ);
    expect(periods[0].name).toBe('Overnight');
    const slots = groupPeriods(periods, TZ, TODAY, NOW.overnight);
    expect(slots[0].date).toBe(TODAY);
    expect(slots[0].day?.name).toBe('Today');
    expect(slots[0].night?.name).toBe('Tonight');
    const named = slots.flatMap((s) => [s.day?.name, s.night?.name]);
    expect(named).not.toContain('Overnight');
  });

  it('uses the place time zone for the date (21:30 CDT is already tomorrow in UTC and Auckland)', () => {
    const slots = groupPeriods(makePeriods('tonight', TODAY, TZ), TZ, TODAY, NOW.tonight);
    expect(slots[0].date).toBe(TODAY);
    expect(localDateOf(NOW.tonight, 'UTC')).toBe('2026-10-09');
    expect(localDateOf(NOW.tonight, 'Pacific/Auckland')).toBe('2026-10-09');
    // And for a place in Auckland the same kind of forecast groups by Auckland dates.
    const nz = makePeriods('tonight', '2026-10-09', 'Pacific/Auckland');
    const nzSlots = groupPeriods(nz, 'Pacific/Auckland', '2026-10-09', zonedWallToMs('2026-10-09', 21, 30, 'Pacific/Auckland'));
    expect(nzSlots[0]).toMatchObject({ date: '2026-10-09', day: null });
  });

  it('ignores periods that are over and dates before today (a stale cached forecast)', () => {
    const periods = makePeriods('today', TODAY, TZ);
    const later = zonedWallToMs(addDays(TODAY, 2), 9, 0, TZ);
    const slots = groupPeriods(periods, TZ, addDays(TODAY, 2), later);
    expect(slots[0].date).toBe(addDays(TODAY, 2));
    expect(slots.some((s) => s.date < addDays(TODAY, 2))).toBe(false);
    expect(groupPeriods(periods, TZ, '2026-12-01', zonedWallToMs('2026-12-01', 9, 0, TZ))).toEqual([]);
  });

  it('keeps the first period when a date has two of a kind', () => {
    const periods = makePeriods('today', TODAY, TZ);
    const slots = groupPeriods([...periods, { ...periods[0], name: 'Dup' }], TZ, TODAY, NOW.today);
    expect(slots[0].day?.name).toBe('Today');
  });
});

describe('the 10-day outlook', () => {
  it.each<StartKind>(['today', 'afternoon', 'overnight'])('%s start: seven NWS days then three GFS days', (kind) => {
    const daily = build(kind);
    expect(daily).toHaveLength(MAX_DAILY_DAYS);
    expect(daily.map((d) => d.source)).toEqual([...Array(7).fill('nws'), ...Array(3).fill('gfs')]);
    expect(daily[0].date).toBe(TODAY);
    expect(daily[0].day).not.toBeNull();
    expect(daily[0].night).not.toBeNull();
  });

  it('"Tonight" start: eight NWS dates (today and the last date are partial), then two GFS days', () => {
    const daily = build('tonight');
    expect(daily).toHaveLength(10);
    expect(daily.filter((d) => d.source === 'nws')).toHaveLength(8);
    expect(daily.filter((d) => d.source === 'gfs')).toHaveLength(2);
  });

  it('dates are consecutive local calendar dates with no gaps or duplicates', () => {
    for (const kind of ['today', 'afternoon', 'tonight', 'overnight'] as const) {
      const dates = build(kind).map((d) => d.date);
      dates.forEach((d, i) => expect(d).toBe(addDays(TODAY, i)));
    }
  });

  it('GFS days follow the last NWS date, never overlap it, and carry no periods', () => {
    const daily = build('today');
    const lastNws = daily.filter((d) => d.source === 'nws').at(-1)?.date ?? '';
    const gfs = daily.filter((d) => d.source === 'gfs');
    expect(gfs.map((d) => d.date)).toEqual([addDays(lastNws, 1), addDays(lastNws, 2), addDays(lastNws, 3)]);
    for (const d of gfs) {
      expect(d.day).toBeNull();
      expect(d.night).toBeNull();
      expect(d.isDaytimeIcon).toBe(true);
      expect(d.summary).not.toBe('');
      expect(d.icon).not.toBe('unknown');
    }
    // GFS values come through in canonical units (snowfall was already converted from cm to mm).
    const day8 = gfs[0];
    const src = gfsDays(TODAY, 11)[7];
    expect(day8.highC).toBe(src.highC);
    expect(day8.lowC).toBe(src.lowC);
    expect(day8.feelsLikeHighC).toBe(src.feelsLikeHighC);
    expect(day8.windGustKph).toBe(src.windGustKph);
    expect(day8.uvIndexMax).toBe(src.uvIndexMax);
  });

  it('maps GFS weather codes to icons and descriptions', () => {
    const gfs = build('today').filter((d) => d.source === 'gfs');
    // index 7,8,9 of gfsDays use codes [61, 95, 71][...]: i % 5 -> 2,3,4 -> 61, 95, 71
    expect(gfs.map((d) => d.icon)).toEqual(['rain', 'thunderstorm', 'snow']);
    expect(gfs.map((d) => d.summary)).toEqual(['Light Rain', 'Thunderstorms', 'Light Snow']);
  });

  it('shows what is available when there is no GFS data (fewer than 10 days)', () => {
    const daily = build('today', { gfs: [] });
    expect(daily).toHaveLength(7);
    expect(daily.every((d) => d.source === 'nws')).toBe(true);
  });

  it('honours maxDays', () => {
    expect(build('today', { maxDays: 5 })).toHaveLength(5);
    expect(build('today', { maxDays: 12, gfs: gfsDays(TODAY, 16) })).toHaveLength(12);
  });

  it('with no NWS forecast and no series, falls back to GFS only, starting today', () => {
    const daily = build('today', { periods: [] });
    expect(daily).toHaveLength(10);
    expect(daily.every((d) => d.source === 'gfs')).toBe(true);
    expect(daily[0].date).toBe(TODAY);
  });
});

describe('a day and its night', () => {
  it('takes high from the day period, low from the night that starts that evening, and both icons/summaries from the day', () => {
    const daily = build('today');
    const friday = daily[1];
    // makePeriods: day temps 80,81,.. by index; Friday is the 2nd day (81 °F); its night is the 2nd night (61 °F).
    expect(friday.highC).toBeCloseTo(fToC(81), 2);
    expect(friday.lowC).toBeCloseTo(fToC(61), 2);
    expect(friday.day?.name).toBe('Friday');
    expect(friday.night?.name).toBe('Friday Night');
    expect(friday.summary).toBe('Sunny');
    expect(friday.isDaytimeIcon).toBe(true);
    expect(friday.icon).toBe('clear');
  });

  it('chance of precipitation is the larger of the day and night values', () => {
    expect(build('today')[1].precipChancePct).toBe(30); // day 10, night 30
  });

  it('today with only "Tonight": no day period, high from the NWS grid layer, night icon and summary', () => {
    const grid = gridWithTodaysHigh(29.44, 16.67);
    const daily = build('tonight', { grid });
    const today = daily[0];
    expect(today.day).toBeNull();
    expect(today.night?.name).toBe('Tonight');
    expect(today.highC).toBeCloseTo(29.44, 2);
    expect(today.lowC).toBeCloseTo(fToC(60), 2); // the night period's own low wins over the grid's
    expect(today.isDaytimeIcon).toBe(false);
    expect(today.summary).toBe('Clear');
  });

  it('today with only "Tonight" and no grid: high is null', () => {
    expect(build('tonight')[0].highC).toBeNull();
  });

  it('last NWS date without a night uses the grid low if there is one, else null', () => {
    const daily = build('tonight');
    const last = daily.filter((d) => d.source === 'nws').at(-1);
    expect(last?.night).toBeNull();
    expect(last?.lowC).toBeNull();
  });

  it('attaches sunrise and sunset for each date at the location', () => {
    const daily = build('today');
    for (const d of daily) {
      expect(d.sunrise).not.toBeNull();
      expect(d.sunset).not.toBeNull();
      expect(localDateOf(Date.parse(d.sunrise ?? ''), TZ)).toBe(d.date);
      expect(localDateOf(Date.parse(d.sunset ?? ''), TZ)).toBe(d.date);
    }
  });
});

describe('per-day numbers from the hourly series, with GFS as the fallback', () => {
  const day = (date: string, hour: number, count: number, fields: Parameters<typeof hourRun>[4]) => hourRun(date, hour, count, TZ, fields);

  it('uses the hourly series when it covers the whole date', () => {
    const date = addDays(TODAY, 1);
    const series = day(date, 0, 24, (i) => ({
      tempC: 20,
      feelsLikeC: 15 + i, // 15..38
      precipMm: 0.5,
      snowMm: i === 3 ? 4 : 0,
      windKph: 10 + i,
      windGustKph: 20 + i,
      precipChancePct: i,
      uvIndex: i === 13 ? 8.4 : 0,
      aqi: i === 15 ? 71 : 40,
    }));
    const d = build('today', { series })[1];
    expect(d.date).toBe(date);
    expect(d.precipMm).toBeCloseTo(12, 6);
    expect(d.snowMm).toBe(4);
    expect(d.windKph).toBe(33);
    expect(d.windGustKph).toBe(43);
    expect(d.aqiMax).toBe(71);
    // Day window is Friday 06:00-18:00 (hours 6..17), night window 18:00-06:00 (only hours 18..23 present).
    expect(d.feelsLikeHighC).toBe(15 + 17);
  });

  it('falls back to the GFS day when the hourly series does not cover the date', () => {
    const gfs = gfsDays(TODAY, 11)[1];
    const d = build('today')[1];
    expect(d.precipMm).toBe(gfs.precipMm);
    expect(d.windKph).toBe(gfs.windKph);
    expect(d.windGustKph).toBe(gfs.windGustKph);
    expect(d.feelsLikeHighC).toBe(gfs.feelsLikeHighC);
    expect(d.feelsLikeLowC).toBe(gfs.feelsLikeLowC);
    expect(d.uvIndexMax).toBe(gfs.uvIndexMax);
    expect(d.aqiMax).toBeNull();
  });

  it('falls back to GFS for today when only the evening is in the series (the grid starts at noon)', () => {
    const series = day(TODAY, 12, 12, () => ({ precipMm: 3, windKph: 15, feelsLikeC: 25, windGustKph: 30 }));
    const today = build('tonight', { series })[0];
    const gfs = gfsDays(TODAY, 11)[0];
    expect(today.precipMm).toBe(gfs.precipMm); // 12 of 24 hours is not enough coverage
    expect(today.windKph).toBe(gfs.windKph);
    expect(today.feelsLikeHighC).toBe(gfs.feelsLikeHighC);
  });

  it('uses partial hourly data rather than nothing when GFS is missing too', () => {
    const series = day(TODAY, 21, 3, () => ({ precipMm: 1, windKph: 12, feelsLikeC: 22 }));
    const today = build('tonight', { series, gfs: [] })[0];
    expect(today.precipMm).toBe(3);
    expect(today.windKph).toBe(12);
  });

  it('feels-like high comes from the day window, low from the night window', () => {
    const date = addDays(TODAY, 1);
    // Cold at 04:00 (belongs to the previous night), warm 15:00, cool evening, coldest at 02:00 next day.
    const series = [
      ...day(date, 0, 24, (i) => ({ feelsLikeC: i === 4 ? -10 : i === 15 ? 31 : 18, tempC: 18 })),
      ...day(addDays(date, 1), 0, 6, (i) => ({ feelsLikeC: i === 2 ? 3 : 12, tempC: 12 })),
    ];
    const d = build('today', { series })[1];
    expect(d.feelsLikeHighC).toBe(31);
    // The -10 at 04:00 on Friday is last night's; Friday Night's own coldest is the 3 at 02:00 Saturday.
    expect(d.feelsLikeLowC).toBe(3);
  });

  it('aqiMax prefers the official AirNow number for that date', () => {
    const date = addDays(TODAY, 1);
    const series = day(date, 0, 24, () => ({ aqi: 40 }));
    const airNow: AirQualityDay[] = [
      { date, aqi: 88, categoryNumber: 2, primaryPollutant: 'PM2.5', discussion: null, source: 'airnow' },
      { date: addDays(date, 1), aqi: null, categoryNumber: 3, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
    ];
    const daily = build('today', { series, airForecast: airNow });
    expect(daily[1].aqiMax).toBe(88);
    expect(daily[2].aqiMax).toBeNull(); // category-only forecasts have no number
  });

  it('uv max prefers the GFS daily maximum, else the hourly maximum', () => {
    const date = addDays(TODAY, 1);
    const series = day(date, 0, 24, (i) => ({ uvIndex: i === 12 ? 6.6 : 0 }));
    expect(build('today', { series })[1].uvIndexMax).toBe(gfsDays(TODAY, 11)[1].uvIndexMax);
    expect(build('today', { series, gfs: [] })[1].uvIndexMax).toBe(6.6);
  });

  it('treats a 23-hour DST day as fully covered by 23 hourly points', () => {
    const springForward = '2026-03-08';
    const now = zonedWallToMs(springForward, 0, 30, TZ);
    const series = hourRun(springForward, 0, 23, TZ, () => ({ precipMm: 1, feelsLikeC: 10 }));
    expect(series[22].time).toBe(new Date(zonedWallToMs(springForward, 0, 0, TZ) + 22 * HOUR_MS).toISOString().replace('.000', ''));
    const daily = buildDaily({
      now,
      timeZone: TZ,
      lat: LAT,
      lon: LON,
      periods: makePeriods('today', springForward, TZ),
      series,
      grid: null,
      gfs: gfsDays(springForward, 11),
      airForecast: [],
    });
    expect(daily[0].date).toBe(springForward);
    expect(daily[0].precipMm).toBe(23);
  });
});

describe('when the NWS period forecast is unavailable', () => {
  it('derives days from the hourly series, then appends GFS days', () => {
    const series = [
      ...hourRun(TODAY, 12, 12, TZ, () => ({ tempC: 25, feelsLikeC: 25, icon: 'partly-cloudy', shortForecast: 'Partly Cloudy' })),
      ...hourRun(addDays(TODAY, 1), 0, 24, TZ, (i) => ({
        tempC: 10 + i / 2,
        feelsLikeC: 10 + i / 2,
        icon: i === 15 ? 'thunderstorm' : 'clear',
        shortForecast: i === 15 ? 'Thunderstorms' : 'Sunny',
        isDaytime: i >= 7 && i < 19,
        precipChancePct: i === 15 ? 70 : 5,
      })),
      ...hourRun(addDays(TODAY, 2), 0, 3, TZ, () => ({ tempC: 5, feelsLikeC: 5 })), // too few hours: skipped
    ];
    const grid = gridWithTodaysHigh(30, 18);
    const daily = build('tonight', { periods: [], series, grid });
    expect(daily[0]).toMatchObject({ date: TODAY, source: 'nws', day: null, night: null, highC: 30, lowC: 18 });
    expect(daily[1]).toMatchObject({ date: addDays(TODAY, 1), source: 'nws', day: null, night: null });
    expect(daily[1].highC).toBeCloseTo(21.5, 5);
    expect(daily[1].lowC).toBe(10);
    expect(daily[1].icon).toBe('thunderstorm');
    expect(daily[1].summary).toBe('Thunderstorms');
    expect(daily[1].precipChancePct).toBe(70);
    expect(daily[2].source).toBe('gfs');
    expect(daily).toHaveLength(10);
  });
});
