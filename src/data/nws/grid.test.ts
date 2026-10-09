import { describe, expect, it } from 'vitest';
import { fixtureNow, loadFixture } from '../testing/fixtures';
import { HOUR_MS, isoZ } from '../time';
import { BadResponseError } from '../http';
import {
  buildHourlyGrid,
  expandToHours,
  gridHighC,
  gridLowC,
  parseGrid,
  parseGridLayer,
  type GridInterval,
} from './grid';

const T0 = Date.parse('2026-10-08T17:00:00Z');

describe('expanding grid intervals to hours', () => {
  it('repeats state values across the interval', () => {
    const hours = expandToHours([{ start: T0, end: T0 + 3 * HOUR_MS, value: 55 }], 'state');
    expect([...hours.entries()]).toEqual([
      [T0, 55],
      [T0 + HOUR_MS, 55],
      [T0 + 2 * HOUR_MS, 55],
    ]);
  });

  it('spreads accumulations evenly: 3 mm over PT6H is 0.5 mm per hour', () => {
    const hours = expandToHours([{ start: T0, end: T0 + 6 * HOUR_MS, value: 3 }], 'accumulation');
    expect(hours.size).toBe(6);
    for (const v of hours.values()) expect(v).toBeCloseTo(0.5, 10);
    expect([...hours.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(3, 10);
  });

  it('keeps a PT1H accumulation as is, and handles a day-long state interval', () => {
    expect(expandToHours([{ start: T0, end: T0 + HOUR_MS, value: 1.27 }], 'accumulation').get(T0)).toBe(1.27);
    const day = expandToHours([{ start: T0, end: T0 + 24 * HOUR_MS, value: 7 }], 'state');
    expect(day.size).toBe(24);
    expect(day.get(T0 + 23 * HOUR_MS)).toBe(7);
    expect(day.has(T0 + 24 * HOUR_MS)).toBe(false);
  });

  it('lets later intervals win on overlap', () => {
    const ivs: GridInterval[] = [
      { start: T0, end: T0 + 4 * HOUR_MS, value: 10 },
      { start: T0 + 2 * HOUR_MS, end: T0 + 3 * HOUR_MS, value: 99 },
    ];
    const hours = expandToHours(ivs, 'state');
    expect([...hours.values()]).toEqual([10, 10, 99, 10]);
  });

  it('assigns a mid-hour start to the hour that contains it', () => {
    const hours = expandToHours([{ start: T0 + 30 * 60_000, end: T0 + 90 * 60_000, value: 1 }], 'state');
    expect([...hours.keys()]).toEqual([T0, T0 + HOUR_MS]);
  });
});

describe('parsing a grid layer', () => {
  it('converts to canonical units using the layer uom', () => {
    const wind = parseGridLayer(
      { uom: 'wmoUnit:m_s-1', values: [{ validTime: '2026-10-08T17:00:00+00:00/PT2H', value: 10 }] },
      'speed',
    );
    expect(wind).toEqual([{ start: T0, end: T0 + 2 * HOUR_MS, value: 36 }]);

    const temp = parseGridLayer({ uom: 'wmoUnit:degF', values: [{ validTime: '2026-10-08T17:00:00+00:00/PT1H', value: 50 }] }, 'temperature');
    expect(temp[0].value).toBeCloseTo(10, 10);
  });

  it('skips null values, bad intervals and unknown units', () => {
    const layer = {
      uom: 'wmoUnit:degC',
      values: [
        { validTime: '2026-10-08T17:00:00+00:00/PT1H', value: null },
        { validTime: 'garbage', value: 5 },
        { validTime: '2026-10-08T18:00:00+00:00/PT1H', value: 7 },
      ],
    };
    expect(parseGridLayer(layer, 'temperature')).toHaveLength(1);
    expect(parseGridLayer({ uom: 'wmoUnit:wibble', values: layer.values }, 'temperature')).toEqual([]);
    expect(parseGridLayer(undefined, 'temperature')).toEqual([]);
    expect(parseGridLayer({ uom: 'wmoUnit:degC' }, 'temperature')).toEqual([]);
  });

  it('accepts a layer without a uom (NWS omits it on probabilityOfThunder)', () => {
    const layer = parseGridLayer({ values: [{ validTime: '2026-10-08T17:00:00+00:00/PT19H', value: 20 }] }, 'percent');
    expect(layer).toEqual([{ start: T0, end: T0 + 19 * HOUR_MS, value: 20 }]);
  });

  it('rejects a grid with no usable data', () => {
    expect(() => parseGrid({ properties: { temperature: { uom: 'wmoUnit:degC', values: [] } } })).toThrow(BadResponseError);
    expect(() => parseGrid({})).toThrow(BadResponseError);
    expect(() => parseGrid(null)).toThrow(BadResponseError);
  });
});

describe('recorded gridpoint data (Linn, KS)', () => {
  const fx = loadFixture('linn-ks');
  const grid = parseGrid(fx.responses.grid?.body);
  const hourly = buildHourlyGrid(grid);

  it('covers from the first temperature hour to the end of the temperature layer', () => {
    expect(hourly).not.toBeNull();
    expect(isoZ(hourly!.startMs)).toBe('2026-10-08T17:00:00Z');
    expect(isoZ(hourly!.endMs)).toBe('2026-10-16T01:00:00Z');
  });

  it('looks up expanded hourly values', () => {
    expect(hourly!.get('temperature', T0)).toBeCloseTo(24.444, 2); // 76°F
    // windSpeed's first interval is PT2H: both hours carry it.
    expect(hourly!.get('windSpeed', T0)).toBeCloseTo(12.964, 3);
    expect(hourly!.get('windSpeed', T0 + HOUR_MS)).toBeCloseTo(12.964, 3);
    // Outside the data there is nothing.
    expect(hourly!.get('temperature', T0 - HOUR_MS)).toBeNull();
    expect(hourly!.get('temperature', hourly!.endMs)).toBeNull();
  });

  it('knows which layers have data (windChill is entirely null in this fixture)', () => {
    expect(hourly!.has('temperature')).toBe(true);
    expect(hourly!.has('probabilityOfThunder')).toBe(true);
    expect(hourly!.has('windChill')).toBe(false);
  });

  it('conserves accumulated precipitation when spreading it over hours', () => {
    const qpf = grid.layers.quantitativePrecipitation ?? [];
    expect(qpf.length).toBeGreaterThan(10);
    const expanded = expandToHours(qpf, 'accumulation');
    const total = qpf.reduce((sum, iv) => sum + iv.value, 0);
    const spread = [...expanded.values()].reduce((a, b) => a + b, 0);
    expect(spread).toBeCloseTo(total, 6);
  });

  it("finds the day's forecast high and the night's low from the max/min layers", () => {
    expect(gridHighC(grid, '2026-10-08', 'America/Chicago')).toBeCloseTo(29.444, 2); // 85°F, interval began at noon
    expect(gridLowC(grid, '2026-10-08', 'America/Chicago')).toBeCloseTo(16.667, 2); // tonight's low
    expect(gridHighC(grid, '2026-10-09', 'America/Chicago')).not.toBeNull();
    expect(gridHighC(grid, '2026-12-25', 'America/Chicago')).toBeNull();
  });

  it('assigns evening intervals to the local date they start on, not the UTC date', () => {
    // The first min-temperature interval starts 2026-10-09T01:00Z: 20:00 on Oct 8 in Chicago.
    expect(gridLowC(grid, '2026-10-08', 'America/Chicago')).toBeCloseTo(16.667, 2);
    expect(gridLowC(grid, '2026-10-09', 'America/Chicago')).not.toBeNull();
    expect(gridLowC(grid, '2026-10-07', 'America/Chicago')).toBeNull();
  });
});

describe('recorded gridpoint data in other climates', () => {
  it("ignores Phoenix's early-morning remainder of last night's minTemperature when finding tonight's low", () => {
    const fx = loadFixture('phoenix-az');
    const grid = parseGrid(fx.responses.grid?.body);
    const early = (grid.layers.minTemperature ?? [])[0];
    expect(isoZ(early.start)).toBe('2026-10-08T13:00:00Z'); // 06:00 MST: the end of last night
    const low = gridLowC(grid, '2026-10-08', 'America/Phoenix');
    expect(low).not.toBeNull();
    expect(low).not.toBe(early.value);
  });

  it('parses a layer that is entirely empty (San Juan has no snowfall layer)', () => {
    const fx = loadFixture('san-juan-pr');
    const grid = parseGrid(fx.responses.grid?.body);
    expect(grid.layers.snowfallAmount).toBeUndefined();
    const hourly = buildHourlyGrid(grid);
    expect(hourly?.has('snowfallAmount')).toBe(false);
    expect(hourly?.get('snowfallAmount', fixtureNow(fx))).toBeNull();
  });

  it('reads Utqiagvik wind chill (the heatIndex layer is the empty one there)', () => {
    const fx = loadFixture('utqiagvik-ak');
    const hourly = buildHourlyGrid(parseGrid(fx.responses.grid?.body));
    expect(hourly?.has('windChill')).toBe(true);
    expect(hourly?.has('heatIndex')).toBe(false);
  });
});
