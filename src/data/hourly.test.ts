import { describe, expect, it } from 'vitest';
import { cToF, kphToMph } from '../lib/units';
import { HOUR_MS, addDays, isoZ, localDateOf, localHourOf, startOfLocalDay, zonedWallToMs } from './time';
import { buildHourlySeries, iconFromGridValues, iconFromSkyCover, type HourlyInputs } from './hourly';
import { matchSkyWording } from './icons';
import { parseForecast, parseHourlyForecast, type NwsHourlyPeriod } from './nws/forecast';
import { buildHourlyGrid, parseGrid } from './nws/grid';
import { sunTimesForDate } from './sun';
import { fixtureNow, loadFixture, type Fixture } from './testing/fixtures';
import type { HourlyPoint } from './types';

interface Parts {
  grid: ReturnType<typeof buildHourlyGrid>;
  nwsHourly: ReturnType<typeof parseHourlyForecast>;
  periods: ReturnType<typeof parseForecast>['periods'];
}

function partsOf(fx: Fixture, dropLayers: string[] = []): Parts {
  const gridBody = JSON.parse(JSON.stringify(fx.responses.grid?.body)) as { properties: Record<string, unknown> };
  for (const layer of dropLayers) delete gridBody.properties[layer];
  return {
    grid: buildHourlyGrid(parseGrid(gridBody)),
    nwsHourly: parseHourlyForecast(fx.responses.hourly?.body),
    periods: parseForecast(fx.responses.forecast?.body).periods,
  };
}

function seriesFor(fx: Fixture, over: Partial<HourlyInputs> = {}, parts = partsOf(fx)): HourlyPoint[] {
  return buildHourlySeries({
    now: fixtureNow(fx),
    timeZone: JSON.parse(JSON.stringify(fx.responses.points.body)).properties.timeZone as string,
    lat: fx.lat,
    lon: fx.lon,
    grid: parts.grid,
    nwsHourly: parts.nwsHourly,
    periods: parts.periods,
    uvByHour: null,
    aqiByHour: null,
    ...over,
  });
}

const FIXTURES = ['linn-ks', 'phoenix-az', 'utqiagvik-ak', 'san-juan-pr'] as const;

describe('sky cover to icon', () => {
  it.each([
    [null, 'unknown'],
    [0, 'clear'],
    [5, 'clear'],
    [6, 'mostly-clear'],
    [25, 'mostly-clear'],
    [26, 'partly-cloudy'],
    [50, 'partly-cloudy'],
    [51, 'mostly-cloudy'],
    [87, 'mostly-cloudy'],
    [88, 'cloudy'],
    [100, 'cloudy'],
  ] as const)('%s%% -> %s', (pct, icon) => {
    expect(iconFromSkyCover(pct)).toBe(icon);
  });

  it('derives an icon from raw numbers when nothing else describes the hour', () => {
    const base = { skyCoverPct: 10, precipChancePct: 0, thunderChancePct: 0, precipMm: 0, snowMm: 0, tempC: 20 };
    expect(iconFromGridValues(base)).toBe('mostly-clear');
    expect(iconFromGridValues({ ...base, thunderChancePct: 50 })).toBe('thunderstorm');
    expect(iconFromGridValues({ ...base, precipChancePct: 60 })).toBe('rain-showers');
    expect(iconFromGridValues({ ...base, precipChancePct: 80 })).toBe('rain');
    expect(iconFromGridValues({ ...base, precipChancePct: 80, tempC: -3 })).toBe('snow');
    expect(iconFromGridValues({ ...base, precipMm: 1, snowMm: 5 })).toBe('snow');
    expect(iconFromGridValues({ ...base, skyCoverPct: null })).toBe('unknown');
  });
});

describe('merging NWS grid, hourly feed, UV and AQI by hour', () => {
  const fx = loadFixture('linn-ks');
  const series = seriesFor(fx, {
    uvByHour: new Map([[Date.parse('2026-10-09T18:00:00Z'), 5.4]]),
    aqiByHour: new Map([[Date.parse('2026-10-09T02:00:00Z'), 43]]),
  });
  const at = (iso: string): HourlyPoint => {
    const p = series.find((s) => s.time === iso);
    if (!p) throw new Error(`no hour ${iso}`);
    return p;
  };

  it('runs from the first grid hour to the end of grid data in whole, regular hours', () => {
    expect(series[0].time).toBe('2026-10-08T17:00:00Z'); // the grid begins at noon local; local midnight is earlier
    expect(series.at(-1)?.time).toBe('2026-10-16T00:00:00Z');
    for (let i = 1; i < series.length; i++) {
      expect(Date.parse(series[i].time) - Date.parse(series[i - 1].time)).toBe(HOUR_MS);
    }
  });

  it('takes numbers from the grid, the icon and text from the hourly feed, and daylight from the sun', () => {
    const p = at('2026-10-09T02:00:00Z'); // 21:00 CDT
    expect(p.tempC).toBeCloseTo(21.11, 2); // 70 °F
    expect(p.dewpointC).toBeCloseTo(15, 1);
    expect(p.humidityPct).toBe(68);
    expect(p.skyCoverPct).toBe(1);
    expect(p.precipChancePct).toBe(0);
    expect(p.windKph).toBeCloseTo(9.3, 1);
    expect(p.windGustKph).toBeCloseTo(18.5, 1);
    expect(p.windDirDeg).toBe(170);
    expect(p.icon).toBe('clear');
    expect(p.shortForecast).toBe('Clear');
    expect(p.isDaytime).toBe(false);
    expect(p.aqi).toBe(43);
    expect(p.uvIndex).toBeNull();
    expect(at('2026-10-09T18:00:00Z').uvIndex).toBe(5.4);
    expect(at('2026-10-09T18:00:00Z').isDaytime).toBe(true);
  });

  it('keeps precipitation as liquid-equivalent and snow separate, spread over the hours of a 6-hour interval', () => {
    const wet = series.filter((p) => (p.precipMm ?? 0) > 0);
    expect(wet.length).toBeGreaterThan(0);
    expect(series.every((p) => p.precipMm === null || p.precipMm >= 0)).toBe(true);
    expect(series.every((p) => p.snowMm === null || p.snowMm >= 0)).toBe(true);
  });

  it('describes hours beyond the hourly feed from the 12-hour period or the sky cover', () => {
    const beyond = series.filter((p) => Date.parse(p.time) > Date.parse('2026-10-15T08:00:00-05:00'));
    expect(beyond.length).toBeGreaterThan(5);
    for (const p of beyond) {
      expect(p.icon).not.toBe('unknown');
      expect(p.shortForecast).not.toBe('');
    }
    // Late on the 15th is past the last forecast period too: derived from sky cover, in night wording.
    const last = series.at(-1)!;
    expect(last.icon).toBe('mostly-clear');
    expect(last.shortForecast).toBe('Mostly Clear');
    expect(last.isDaytime).toBe(false);
  });

  it('never emits NaN, undefined or missing keys', () => {
    const keys = Object.keys(series[0]).sort();
    for (const p of series) {
      expect(Object.keys(p).sort()).toEqual(keys);
      for (const v of Object.values(p)) {
        expect(v).not.toBeUndefined();
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('"feels like" per hour', () => {
  const tF = (p: HourlyPoint): number => cToF(p.tempC ?? NaN);

  it.each(FIXTURES)('%s: kinds follow the 80°F heat-index and 50°F/3 mph wind-chill rules', (slug) => {
    const fx = loadFixture(slug);
    for (const p of seriesFor(fx)) {
      if (p.tempC === null) continue;
      const hot = tF(p) >= 80 - 1e-6;
      const cold = tF(p) <= 50 + 1e-6 && p.windKph !== null && kphToMph(p.windKph) >= 3 - 1e-6;
      if (hot) expect(p.feelsLikeKind).toBe('heat-index');
      else if (cold) expect(p.feelsLikeKind).toBe('wind-chill');
      else {
        expect(p.feelsLikeKind).toBe('actual');
        expect(p.feelsLikeC).toBe(p.tempC);
      }
    }
  });

  it('Linn at night: mild air means feels-like is just the temperature, even though NWS reports a heat index', () => {
    const fx = loadFixture('linn-ks');
    const parts = partsOf(fx);
    expect(parts.grid?.get('heatIndex', Date.parse('2026-10-09T02:00:00Z'))).not.toBeNull(); // reported at 70 °F
    const p = seriesFor(fx, {}, parts).find((s) => s.time === '2026-10-09T02:00:00Z')!;
    expect(p.feelsLikeKind).toBe('actual');
    expect(p.feelsLikeC).toBe(p.tempC);
  });

  it('San Juan: hot and humid hours use the heat index (above the air temperature)', () => {
    const series = seriesFor(loadFixture('san-juan-pr'));
    const hot = series.filter((p) => p.feelsLikeKind === 'heat-index');
    expect(hot.length).toBeGreaterThan(50);
    expect(hot.some((p) => (p.feelsLikeC ?? 0) - (p.tempC ?? 0) > 3)).toBe(true);
  });

  it('Utqiagvik: cold windy hours use the wind chill (below the air temperature)', () => {
    const series = seriesFor(loadFixture('utqiagvik-ak'));
    const chilly = series.filter((p) => p.feelsLikeKind === 'wind-chill');
    expect(chilly.length).toBeGreaterThan(20);
    for (const p of chilly) expect(p.feelsLikeC).toBeLessThan(p.tempC ?? Infinity);
  });

  it('Phoenix: prefers the heat index NWS reported for that hour', () => {
    const fx = loadFixture('phoenix-az');
    const parts = partsOf(fx);
    const series = seriesFor(fx, {}, parts);
    const hour = series.find((p) => p.feelsLikeKind === 'heat-index')!;
    const reported = parts.grid!.get('heatIndex', Date.parse(hour.time));
    expect(reported).not.toBeNull();
    expect(hour.feelsLikeC).toBeCloseTo(reported!, 1);
  });

  it('computes the heat index when the grid has no heatIndex layer, close to what NWS reports', () => {
    const fx = loadFixture('phoenix-az');
    const withLayer = seriesFor(fx);
    const without = seriesFor(fx, {}, partsOf(fx, ['heatIndex', 'apparentTemperature']));
    let compared = 0;
    for (const a of withLayer) {
      if (a.feelsLikeKind !== 'heat-index') continue;
      const b = without.find((s) => s.time === a.time)!;
      expect(b.feelsLikeKind).toBe('heat-index');
      expect(Math.abs((b.feelsLikeC ?? NaN) - (a.feelsLikeC ?? NaN))).toBeLessThan(1.5);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('computes the wind chill when the grid has no windChill layer, close to what NWS reports', () => {
    const fx = loadFixture('utqiagvik-ak');
    const withLayer = seriesFor(fx);
    const without = seriesFor(fx, {}, partsOf(fx, ['windChill', 'apparentTemperature']));
    let compared = 0;
    for (const a of withLayer) {
      if (a.feelsLikeKind !== 'wind-chill') continue;
      const b = without.find((s) => s.time === a.time)!;
      expect(b.feelsLikeKind).toBe('wind-chill');
      expect(Math.abs((b.feelsLikeC ?? NaN) - (a.feelsLikeC ?? NaN))).toBeLessThan(1.5);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('when a source is missing', () => {
  const fx = loadFixture('linn-ks');

  it('without the grid, builds the series from the hourly forecast alone (numbers where the feed has them)', () => {
    const parts = partsOf(fx);
    const series = seriesFor(fx, { grid: null }, parts);
    expect(series.length).toBeGreaterThan(150);
    expect(series.length).toBeLessThanOrEqual(156);
    const first = series[0];
    expect(first.time).toBe('2026-10-09T02:00:00Z'); // the feed starts at 21:00 CDT; the grid reached back to noon
    expect(first.tempC).toBeCloseTo(21.11, 1);
    expect(first.humidityPct).toBe(68);
    expect(first.windKph).toBe(8); // "5 mph" = 8.05 km/h, kept to 0.1
    expect(first.windDirDeg).toBe(180);
    expect(first.skyCoverPct).toBeNull();
    expect(first.precipMm).toBeNull();
    expect(first.windGustKph).toBeNull();
    expect(first.icon).toBe('clear');
    expect(series.every((p) => p.tempC !== null)).toBe(true);
  });

  it('without the hourly feed, uses the 12-hour periods and sky cover for icons', () => {
    const parts = partsOf(fx);
    const series = seriesFor(fx, { nwsHourly: null }, parts);
    expect(series[0].time).toBe('2026-10-08T17:00:00Z');
    expect(series.every((p) => p.icon !== 'unknown')).toBe(true);
    const during = series.find((p) => p.time === '2026-10-09T18:00:00Z')!;
    expect(during.shortForecast).toBe('Sunny'); // from the "Friday" period
    expect(during.tempC).not.toBeNull();
  });

  it('without any source there is nothing to show', () => {
    expect(seriesFor(fx, { grid: null, nwsHourly: null, periods: null })).toEqual([]);
  });

  it('never starts before local midnight today, even if the grid reaches further back', () => {
    const parts = partsOf(fx);
    const early = parts.grid!;
    const stretched = {
      ...early,
      startMs: early.startMs - 5 * 24 * HOUR_MS,
      get: (layer: Parameters<typeof early.get>[0], hour: number) => early.get(layer, hour) ?? 12,
    };
    const series = seriesFor(fx, { grid: stretched }, parts);
    const midnight = startOfLocalDay(localDateOf(fixtureNow(fx), 'America/Chicago'), 'America/Chicago');
    expect(series[0].time).toBe(isoZ(midnight));
  });
});

describe('day and night follow the sun, not the NWS 6 AM - 6 PM clock', () => {
  const fx = loadFixture('linn-ks'); // 2026-10-09: sunrise 07:32:36 CDT, sunset 18:57:54 CDT
  const parts = partsOf(fx);
  const series = seriesFor(fx, {}, parts);
  const hour = (iso: string): HourlyPoint => {
    const p = series.find((s) => s.time === iso);
    if (!p) throw new Error(`no hour ${iso}`);
    return p;
  };
  const feed = (iso: string): NwsHourlyPeriod => {
    const f = parts.nwsHourly.find((x) => x.startMs === Date.parse(iso));
    if (!f) throw new Error(`no feed hour ${iso}`);
    return f;
  };

  it('the 6 and 7 AM hours are night before a 7:32 sunrise (the feed calls them day and "Sunny"), 8 AM is day', () => {
    for (const iso of ['2026-10-09T11:00:00Z', '2026-10-09T12:00:00Z']) {
      expect(feed(iso)).toMatchObject({ isDaytime: true, shortForecast: 'Sunny' });
      expect(hour(iso)).toMatchObject({ isDaytime: false, shortForecast: 'Clear', icon: 'clear' });
    }
    expect(hour('2026-10-09T13:00:00Z')).toMatchObject({ isDaytime: true, shortForecast: 'Sunny' });
  });

  it('the 6 PM hour is still day before a 6:58 PM sunset (the feed calls it night and "Clear"), 7 PM is night', () => {
    expect(feed('2026-10-09T23:00:00Z')).toMatchObject({ isDaytime: false, shortForecast: 'Clear' });
    expect(hour('2026-10-09T23:00:00Z')).toMatchObject({ isDaytime: true, shortForecast: 'Sunny' });
    expect(hour('2026-10-10T00:00:00Z').isDaytime).toBe(false);
  });
});

describe('every hour is day or night by the sun, in every kind of zone and season', () => {
  /** An hourly feed the way NWS issues it: day is 6 AM - 6 PM local no matter where the sun is. */
  function nwsClockFeed(date: string, tz: string, hours: number): NwsHourlyPeriod[] {
    const start = zonedWallToMs(date, 0, 0, tz);
    return Array.from({ length: hours }, (_, i) => {
      const startMs = start + i * HOUR_MS;
      const local = localHourOf(startMs, tz);
      const day = local >= 6 && local < 18;
      return {
        startMs,
        endMs: startMs + HOUR_MS,
        isDaytime: day,
        tempC: 10,
        precipChancePct: 0,
        dewpointC: 5,
        humidityPct: 60,
        windKph: 10,
        windDirDeg: 180,
        icon: 'clear' as const,
        shortForecast: day ? 'Sunny' : 'Clear',
      };
    });
  }

  function seriesFrom(date: string, tz: string, lat: number, lon: number, hours: number): HourlyPoint[] {
    return buildHourlySeries({
      now: zonedWallToMs(date, 0, 30, tz),
      timeZone: tz,
      lat,
      lon,
      grid: null,
      nwsHourly: nwsClockFeed(date, tz, hours),
      periods: null,
      uvByHour: null,
      aqiByHour: null,
    });
  }

  const CASES: Array<[label: string, date: string, tz: string, lat: number, lon: number]> = [
    ['Phoenix (no DST)', '2026-10-09', 'America/Phoenix', 33.4484, -112.074],
    ['Honolulu', '2026-10-09', 'Pacific/Honolulu', 21.3069, -157.8583],
    ['San Juan, Puerto Rico', '2026-10-09', 'America/Puerto_Rico', 18.4663, -66.1057],
    ['Hagatna, Guam (east of the date line)', '2026-10-09', 'Pacific/Guam', 13.4443, 144.7937],
    ['Anchorage', '2026-10-09', 'America/Anchorage', 61.2181, -149.9003],
    ['Linn, KS in midwinter (sunset about 5 PM)', '2026-12-21', 'America/Chicago', 39.7456, -97.0892],
    ['Linn, KS in midsummer (sunset about 8:50 PM)', '2026-06-21', 'America/Chicago', 39.7456, -97.0892],
    ['Linn, KS across the fall-back night (a 25-hour day)', '2026-10-31', 'America/Chicago', 39.7456, -97.0892],
    ['Linn, KS across the spring-forward night (a 23-hour day)', '2027-03-13', 'America/Chicago', 39.7456, -97.0892],
  ];

  it.each(CASES)('%s', (_label, date, tz, lat, lon) => {
    const hours = 72;
    const series = seriesFrom(date, tz, lat, lon, hours);
    expect(series).toHaveLength(hours);
    series.forEach((p, i) => {
      if (i > 0) expect(Date.parse(p.time) - Date.parse(series[i - 1].time)).toBe(HOUR_MS); // no gap, no duplicate instant
    });

    let sawDay = false;
    let sawNight = false;
    for (const p of series) {
      const mid = Date.parse(p.time) + HOUR_MS / 2;
      const sun = sunTimesForDate(localDateOf(mid, tz), tz, lat, lon);
      const up =
        sun.sunrise !== null && sun.sunset !== null ? Date.parse(sun.sunrise) <= mid && mid < Date.parse(sun.sunset) : sun.daylightMinutes === 1440;
      expect(p.isDaytime, `${p.time} (${localDateOf(mid, tz)} ${localHourOf(mid, tz)}h local)`).toBe(up);
      // The words follow the sun too, so the text never contradicts the sun or moon icon.
      expect(p.shortForecast).toBe(up ? 'Sunny' : 'Clear');
      if (up) sawDay = true;
      else sawNight = true;
    }
    expect(sawDay && sawNight).toBe(true);
  });

  it('polar night: every hour is night; polar day: every hour is day (Utqiagvik)', () => {
    for (const [date, expectDay] of [
      ['2026-12-21', false],
      ['2026-06-21', true],
    ] as const) {
      const series = seriesFrom(date, 'America/Anchorage', 71.2906, -156.7886, 48);
      expect(series).toHaveLength(48);
      expect(series.every((p) => p.isDaytime === expectDay)).toBe(true);
    }
  });

  it('the fall-back night keeps both 1 AM hours, one hour apart, instead of dropping or merging one', () => {
    const tz = 'America/Chicago';
    const series = seriesFrom('2026-11-01', tz, 39.7456, -97.0892, 25);
    expect(series.map((p) => localHourOf(Date.parse(p.time), tz)).slice(0, 4)).toEqual([0, 1, 1, 2]);
    expect(series).toHaveLength(25);
    expect(series[1].time).toBe('2026-11-01T06:00:00Z'); // 1 AM CDT
    expect(series[2].time).toBe('2026-11-01T07:00:00Z'); // 1 AM CST
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('the repeated hour when the clocks go back, as NWS writes it', () => {
  // The hourly feed labels instants with their own offset, so 1 AM appears twice: once as -05:00 (CDT), once as -06:00 (CST).
  const hourlyJson = {
    properties: {
      periods: [
        ['2026-11-01T00:00:00-05:00', '2026-11-01T01:00:00-05:00'],
        ['2026-11-01T01:00:00-05:00', '2026-11-01T01:00:00-06:00'],
        ['2026-11-01T01:00:00-06:00', '2026-11-01T02:00:00-06:00'],
        ['2026-11-01T02:00:00-06:00', '2026-11-01T03:00:00-06:00'],
      ].map(([startTime, endTime], i) => ({
        number: i + 1,
        startTime,
        endTime,
        isDaytime: false,
        temperature: 50 + i,
        temperatureUnit: 'F',
        probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 10 * i },
        windSpeed: '5 mph',
        windDirection: 'S',
        icon: 'https://api.weather.gov/icons/land/night/skc?size=small',
        shortForecast: 'Clear',
      })),
    },
  };

  it('parses four distinct instants, in order, one hour apart', () => {
    const feed = parseHourlyForecast(hourlyJson);
    expect(feed.map((p) => isoZ(p.startMs))).toEqual(['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z', '2026-11-01T08:00:00Z']);
    expect(feed.map((p) => p.tempC)).toEqual([50, 51, 52, 53].map((f) => ((f - 32) * 5) / 9));
  });

  it('keeps both 1 AM hours in the series with their own numbers (no merge, no gap) and labels them from the instant', () => {
    const tz = 'America/Chicago';
    const series = buildHourlySeries({
      now: Date.parse('2026-11-01T05:30:00Z'),
      timeZone: tz,
      lat: 39.7456,
      lon: -97.0892,
      grid: null,
      nwsHourly: parseHourlyForecast(hourlyJson),
      periods: null,
      uvByHour: null,
      aqiByHour: null,
    });
    expect(series.map((p) => p.time)).toEqual(['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z', '2026-11-01T08:00:00Z']);
    expect(series.map((p) => Math.round(cToF(p.tempC ?? NaN)))).toEqual([50, 51, 52, 53]);
    expect(series.map((p) => p.precipChancePct)).toEqual([0, 10, 20, 30]);
    expect(series.map((p) => localHourOf(Date.parse(p.time), tz))).toEqual([0, 1, 1, 2]);
  });
});

describe('matchSkyWording', () => {
  it.each([
    ['Sunny', false, 'Clear'],
    ['Clear', true, 'Sunny'],
    ['Mostly Sunny', false, 'Mostly Clear'],
    ['Mostly Clear', true, 'Mostly Sunny'],
    ['Partly Sunny', false, 'Partly Cloudy'],
    ['Partly Cloudy', true, 'Partly Sunny'],
    ['sunny', false, 'Clear'],
    [' Mostly Clear ', true, 'Mostly Sunny'],
    ['Sunny', true, 'Sunny'],
    ['Clear', false, 'Clear'],
  ] as const)('%j with isDaytime=%s -> %j', (text, isDaytime, expected) => {
    expect(matchSkyWording(text, isDaytime)).toBe(expected);
  });

  it('leaves every other phrase alone, including ones that only contain a sky word', () => {
    for (const text of ['Mostly Cloudy', 'Cloudy', 'Chance Showers And Thunderstorms', 'Sunny then Chance Rain', 'Clear and Windy', 'Patchy Fog', '']) {
      expect(matchSkyWording(text, true)).toBe(text);
      expect(matchSkyWording(text, false)).toBe(text);
    }
  });
});
