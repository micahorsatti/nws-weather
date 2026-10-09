import { describe, expect, it } from 'vitest';
import { getMockBundle } from '../../mocks';
import { HOUR_MS } from './time';
import { RANGE_HOURS, buildRows, daySeparators, makeBlocks, summarizeHours } from './hourly';
import { formatDayClock } from './time';

const CHI = 'America/Chicago';
const NOW = Date.parse('2026-07-15T18:30:00Z'); // 1:30 PM CDT; the bundle's first hour is 1:00 PM
const bundle = getMockBundle('summer', NOW);
const hourly = bundle.hourly;

describe('buildRows', () => {
  it('starts at the hour in progress and respects the range', () => {
    const rows = buildRows(hourly, NOW, CHI, '48h');
    expect(rows).toHaveLength(RANGE_HOURS['48h']);
    expect(rows[0].hour).toBe(13);
    expect(rows[0].dateKey).toBe('2026-07-15');
    expect(rows.map((r) => r.i)).toEqual(rows.map((_, i) => i));
    expect(buildRows(hourly, NOW, CHI, '7d')).toHaveLength(156); // everything the bundle has, under the 168 cap
  });

  it('drops hours that have finished, as the clock moves', () => {
    const at3 = Date.parse('2026-07-15T20:00:00Z'); // exactly 3:00 PM: the 1 PM and 2 PM hours are over
    expect(buildRows(hourly, at3, CHI, '48h')[0].hour).toBe(15);
    const at259 = Date.parse('2026-07-15T19:59:00Z');
    expect(buildRows(hourly, at259, CHI, '48h')[0].hour).toBe(14); // 2 PM is still in progress
  });

  it('is empty when the whole bundle is out of date', () => {
    expect(buildRows(hourly, NOW + 30 * 24 * HOUR_MS, CHI, '48h')).toEqual([]);
  });

  it('skips points whose time cannot be parsed', () => {
    const broken = [{ ...hourly[0], time: 'garbage' }, ...hourly.slice(1)];
    const rows = buildRows(broken, NOW, CHI, '48h');
    expect(rows).toHaveLength(48);
    expect(rows[0].hour).toBe(14); // the unreadable 1 PM point is simply skipped
    expect(rows.every((r) => Number.isFinite(r.t))).toBe(true);
  });
});

describe('daySeparators', () => {
  it('finds each local midnight', () => {
    const rows = buildRows(hourly, NOW, CHI, '48h');
    const seps = daySeparators(rows);
    expect(seps).toEqual([11, 35]); // 1 PM + 11 h = midnight, then 24 h later
    for (const i of seps) expect(rows[i].hour).toBe(0);
  });

  it('is empty for a short series within one day', () => {
    expect(daySeparators(buildRows(hourly, NOW, CHI, '48h').slice(0, 5))).toEqual([]);
  });
});

describe('makeBlocks', () => {
  const rows = buildRows(hourly, NOW, CHI, '7d');

  it('makes one cell per hour at step 1', () => {
    expect(makeBlocks(rows, 1)).toHaveLength(rows.length);
  });

  it('groups hours into 3-hour cells aligned to the local clock, covering every hour exactly once', () => {
    const blocks = makeBlocks(rows, 3);
    expect(blocks[0]).toEqual({ start: 0, end: 2, mid: 1 }); // 1 PM and 2 PM, then the 3 PM boundary
    let expectedStart = 0;
    for (const b of blocks) {
      expect(b.start).toBe(expectedStart);
      expect(b.end).toBeGreaterThan(b.start);
      expect(b.mid).toBeGreaterThanOrEqual(b.start);
      expect(b.mid).toBeLessThan(b.end);
      if (b.start > 0) expect(rows[b.start].hour % 3).toBe(0);
      expect(b.end - b.start).toBeLessThanOrEqual(3);
      expectedStart = b.end;
    }
    expect(expectedStart).toBe(rows.length);
  });

  it('handles nothing', () => {
    expect(makeBlocks([], 3)).toEqual([]);
  });
});

describe('summarizeHours (screen reader summary)', () => {
  it('describes the range, the temperatures and the wettest hour', () => {
    const rows = buildRows(hourly, NOW, CHI, '48h');
    const text = summarizeHours(rows, 'imperial', CHI, formatDayClock);
    expect(text).toMatch(/^Hourly forecast for the next 48 hours\./);
    expect(text).toMatch(/Temperature from \d+ to \d+ degrees\./);
    expect(text).toMatch(/Feels like \d+ to \d+ degrees\./);
    expect(text).toMatch(/Highest chance of precipitation is \d+ percent around/);
    expect(text).toMatch(/arrow keys/);
  });

  it('speaks in days for the long range and handles no data', () => {
    expect(summarizeHours(buildRows(hourly, NOW, CHI, '7d'), 'metric', CHI, formatDayClock)).toMatch(/next 7 days/);
    expect(summarizeHours([], 'imperial', CHI, formatDayClock)).toBe('Hourly forecast is not available.');
  });
});
