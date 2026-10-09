import { describe, expect, it } from 'vitest';
import { parseCapabilities } from './capabilities';
import conusXml from './__fixtures__/conus-capabilities.xml?raw';
import {
  DEFAULT_FRAME_PLAN,
  MINUTE_MS,
  formatAge,
  formatClock,
  minutesAgo,
  parseIsoDuration,
  parseTimeDimension,
  parseTimestamp,
  pickFrameTimes,
} from './radarTime';

const utc = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();

describe('parseIsoDuration', () => {
  it.each([
    ['PT2M', 2 * 60_000],
    ['PT10M', 10 * 60_000],
    ['PT30S', 30_000],
    ['PT1H', 3_600_000],
    ['PT1.5H', 5_400_000],
    ['P1D', 86_400_000],
    ['P1W', 7 * 86_400_000],
    ['P1DT2H30M', (26 * 60 + 30) * 60_000],
    ['pt5m', 5 * 60_000],
  ])('%s', (text, ms) => {
    expect(parseIsoDuration(text)).toBe(ms);
  });

  it.each(['', 'P', 'PT', 'P1DT', '10M', 'PT10', 'garbage', '1D'])('rejects %j', (text) => {
    expect(parseIsoDuration(text)).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('reads Z timestamps with and without fractional seconds', () => {
    expect(parseTimestamp('2026-10-09T02:28:09.000Z')).toBe(Date.UTC(2026, 9, 9, 2, 28, 9));
    expect(parseTimestamp('2026-10-09T02:28:09Z')).toBe(Date.UTC(2026, 9, 9, 2, 28, 9));
  });

  it('treats a zone-less time as UTC, not device-local', () => {
    expect(parseTimestamp('2026-10-09T02:28:09')).toBe(Date.UTC(2026, 9, 9, 2, 28, 9));
    expect(parseTimestamp('2026-10-09T02:28')).toBe(Date.UTC(2026, 9, 9, 2, 28));
    expect(parseTimestamp('2026-10-09')).toBe(Date.UTC(2026, 9, 9));
  });

  it('respects explicit offsets', () => {
    expect(parseTimestamp('2026-10-09T03:28:09+01:00')).toBe(Date.UTC(2026, 9, 9, 2, 28, 9));
  });

  it.each(['', '  ', 'current', 'now', 'PT10M', '12:30', 'nonsense'])('rejects %j', (text) => {
    expect(parseTimestamp(text)).toBeNull();
  });
});

describe('parseTimeDimension', () => {
  it('parses a comma list into ascending, de-duplicated epoch ms', () => {
    const out = parseTimeDimension('2026-10-09T00:04:00.000Z, 2026-10-09T00:02:00Z,\n  2026-10-09T00:02:00.000Z,2026-10-09T00:00:00Z');
    expect(out.map(iso)).toEqual(['2026-10-09T00:00:00.000Z', '2026-10-09T00:02:00.000Z', '2026-10-09T00:04:00.000Z']);
  });

  it('ignores junk entries instead of failing the whole list', () => {
    const out = parseTimeDimension('current,,2026-10-09T00:00:00Z, not-a-date ,2026-10-09T00:10:00Z');
    expect(out.map(iso)).toEqual(['2026-10-09T00:00:00.000Z', '2026-10-09T00:10:00.000Z']);
  });

  it('expands start/end/period intervals inclusively', () => {
    const out = parseTimeDimension('2026-10-09T00:00:00Z/2026-10-09T01:00:00Z/PT10M');
    expect(out).toHaveLength(7);
    expect(iso(out[0] as number)).toBe('2026-10-09T00:00:00.000Z');
    expect(iso(out[6] as number)).toBe('2026-10-09T01:00:00.000Z');
    expect(out[1]! - out[0]!).toBe(10 * MINUTE_MS);
  });

  it('anchors an interval at its start when the period does not divide the span', () => {
    const out = parseTimeDimension('2026-10-09T00:00:00Z/2026-10-09T00:25:00Z/PT10M');
    expect(out.map(iso)).toEqual(['2026-10-09T00:00:00.000Z', '2026-10-09T00:10:00.000Z', '2026-10-09T00:20:00.000Z']);
  });

  it('handles a mix of lists and intervals', () => {
    const out = parseTimeDimension('2026-10-08T23:50:00Z,2026-10-09T00:00:00Z/2026-10-09T00:20:00Z/PT10M,2026-10-09T00:35:00Z');
    expect(out.map(iso)).toEqual([
      '2026-10-08T23:50:00.000Z',
      '2026-10-09T00:00:00.000Z',
      '2026-10-09T00:10:00.000Z',
      '2026-10-09T00:20:00.000Z',
      '2026-10-09T00:35:00.000Z',
    ]);
  });

  it('keeps just the endpoints of an interval with no usable period', () => {
    expect(parseTimeDimension('2026-10-09T00:00:00Z/2026-10-09T02:00:00Z').map(iso)).toEqual([
      '2026-10-09T00:00:00.000Z',
      '2026-10-09T02:00:00.000Z',
    ]);
    expect(parseTimeDimension('2026-10-09T00:00:00Z/2026-10-09T02:00:00Z/bogus')).toHaveLength(2);
  });

  it('skips an interval whose end precedes its start', () => {
    expect(parseTimeDimension('2026-10-09T02:00:00Z/2026-10-09T00:00:00Z/PT10M').map(iso)).toEqual(['2026-10-09T02:00:00.000Z']);
  });

  it('caps a huge interval to its most recent entries, still aligned to the start', () => {
    const out = parseTimeDimension('2020-01-01T00:00:00Z/2020-01-02T00:00:00Z/PT1S', { maxPerInterval: 3 });
    expect(out.map(iso)).toEqual(['2020-01-01T23:59:58.000Z', '2020-01-01T23:59:59.000Z', '2020-01-02T00:00:00.000Z']);
  });

  it('returns nothing for empty input', () => {
    expect(parseTimeDimension('')).toEqual([]);
    expect(parseTimeDimension(' , ,')).toEqual([]);
  });
});

describe('pickFrameTimes (real CONUS capabilities)', () => {
  const caps = parseCapabilities(conusXml, 'conus_bref_qcd');
  if (!caps) throw new Error('fixture did not parse');
  const times = caps.times;
  const latest = times[times.length - 1] as number;

  it('chooses 9-10 ascending frames ending at the newest scan', () => {
    const picked = pickFrameTimes(times);
    expect(picked.length).toBeGreaterThanOrEqual(8);
    expect(picked.length).toBeLessThanOrEqual(10);
    expect(picked[picked.length - 1]).toBe(latest);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('only uses scans the server actually advertised', () => {
    const advertised = new Set(times);
    for (const t of pickFrameTimes(times)) expect(advertised.has(t)).toBe(true);
  });

  it('spaces older frames about 10 minutes apart and reaches back about 85 minutes', () => {
    const picked = pickFrameTimes(times);
    const gaps = picked.slice(1, -1).map((t, i) => (t - (picked[i] as number)) / MINUTE_MS);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(7);
      expect(gap).toBeLessThanOrEqual(13);
    }
    const lastStep = (latest - (picked[picked.length - 2] as number)) / MINUTE_MS;
    expect(lastStep).toBeGreaterThanOrEqual(DEFAULT_FRAME_PLAN.minGapMin - 1);
    expect(lastStep).toBeLessThanOrEqual(DEFAULT_FRAME_PLAN.stepMin + DEFAULT_FRAME_PLAN.minGapMin);
    const reach = (latest - (picked[0] as number)) / MINUTE_MS;
    expect(reach).toBeGreaterThanOrEqual(60);
    expect(reach).toBeLessThanOrEqual(90);
  });

  it('snaps older frames to the 10-minute clock lines', () => {
    const picked = pickFrameTimes(times);
    for (const t of picked.slice(0, -1)) {
      const offFromLine = Math.abs(t - Math.round(t / (10 * MINUTE_MS)) * 10 * MINUTE_MS);
      expect(offFromLine).toBeLessThanOrEqual(DEFAULT_FRAME_PLAN.toleranceMin * MINUTE_MS);
    }
  });

  it('keeps the older frames identical across a refresh, so loaded layers can be reused', () => {
    const before = pickFrameTimes(times);
    // Five minutes later the server advertises three more scans.
    const newer = [...times, utc('2026-10-09T02:30:06Z'), utc('2026-10-09T02:32:05Z'), utc('2026-10-09T02:34:07Z')];
    const after = pickFrameTimes(newer);
    expect(after[after.length - 1]).toBe(utc('2026-10-09T02:34:07Z'));
    for (const t of before.slice(0, -1)) expect(after).toContain(t);
    expect(after).not.toContain(latest); // the old newest scan is not on a clock line
  });

  it('never adds a near-duplicate of the newest scan', () => {
    for (const offsetMin of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const trimmed = times.filter((t) => t <= latest - offsetMin * MINUTE_MS);
      const picked = pickFrameTimes(trimmed);
      const newest = picked[picked.length - 1] as number;
      const previous = picked[picked.length - 2];
      if (previous !== undefined) expect((newest - previous) / MINUTE_MS).toBeGreaterThanOrEqual(DEFAULT_FRAME_PLAN.minGapMin - 1.5);
    }
  });

  it('skips clock lines that fall in a gap in the data', () => {
    const gapped = times.filter((t) => t < utc('2026-10-09T01:25:00Z') || t > utc('2026-10-09T01:58:00Z'));
    const picked = pickFrameTimes(gapped);
    for (const t of picked) expect(t < utc('2026-10-09T01:25:00Z') || t > utc('2026-10-09T01:58:00Z')).toBe(true);
    expect(picked[picked.length - 1]).toBe(latest);
  });

  it('copes with unsorted input and duplicates', () => {
    const shuffled = [...times].reverse().concat(times.slice(0, 5));
    expect(pickFrameTimes(shuffled)).toEqual(pickFrameTimes(times));
  });

  it('returns nothing for no scans and the single scan for one', () => {
    expect(pickFrameTimes([])).toEqual([]);
    expect(pickFrameTimes([latest])).toEqual([latest]);
  });

  it('depends only on the server list, so a wrong device clock cannot make stale scans look newest', () => {
    // The function takes no clock at all; the newest advertised scan is the last frame regardless.
    expect(pickFrameTimes(times).length).toBe(pickFrameTimes(times.slice()).length);
    expect(pickFrameTimes(times)[pickFrameTimes(times).length - 1]).toBe(latest);
  });

  it('honors a custom plan', () => {
    const picked = pickFrameTimes(times, { stepMin: 20, historyMin: 45 });
    expect(picked.length).toBeLessThanOrEqual(4);
    expect(picked[picked.length - 1]).toBe(latest);
  });
});

describe('frame labels', () => {
  it('formats a short local clock time', () => {
    const text = formatClock(utc('2026-10-09T02:28:09Z'), { locale: 'en-US', timeZone: 'UTC' }).replace(/\s/g, ' ');
    expect(text).toBe('2:28 AM');
    expect(formatClock(utc('2026-10-09T02:28:09Z'), { locale: 'en-US', timeZone: 'America/Chicago' }).replace(/\s/g, ' ')).toBe('9:28 PM');
    expect(formatClock(utc('2026-10-09T14:05:00Z'), { locale: 'en-GB', timeZone: 'UTC' })).toBe('14:05');
  });

  it('counts whole minutes ago and never goes negative', () => {
    const now = utc('2026-10-09T02:31:00Z');
    expect(minutesAgo(utc('2026-10-09T02:28:09Z'), now)).toBe(3);
    expect(minutesAgo(utc('2026-10-09T01:11:00Z'), now)).toBe(80);
    expect(minutesAgo(now + 5 * MINUTE_MS, now)).toBe(0);
    expect(minutesAgo(now, now)).toBe(0);
  });

  it('words the age', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(1)).toBe('1 min ago');
    expect(formatAge(12)).toBe('12 min ago');
    expect(formatAge(80)).toBe('80 min ago');
    expect(formatAge(12, true)).toBe('~12 min ago');
    expect(formatAge(0, true)).toBe('just now');
  });
});
