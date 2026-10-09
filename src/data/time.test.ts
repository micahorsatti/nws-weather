import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  floorToHour,
  hoursInLocalDay,
  isoZ,
  localDateOf,
  localHourOf,
  parseIsoDuration,
  parseTime,
  parseValidTime,
  startOfLocalDay,
  tzOffsetMs,
  zonedWallToMs,
} from './time';

const H = 3_600_000;

describe('ISO-8601 durations', () => {
  it.each([
    ['PT1H', 1 * H],
    ['PT6H', 6 * H],
    ['PT13H', 13 * H],
    ['P1D', 24 * H],
    ['P1DT6H', 30 * H],
    ['P7DT12H', 180 * H],
    ['P2DT22H', 70 * H],
    ['PT30M', 30 * 60_000],
    ['PT90S', 90_000],
    ['P1W', 168 * H],
    ['PT0S', 0],
  ])('parses %s', (text, ms) => {
    expect(parseIsoDuration(text)).toBe(ms);
  });

  it.each(['', 'P', 'PT', 'PT1', '1H', 'PTH', 'P1H', 'garbage', 'PT-1H'])('rejects %j', (text) => {
    expect(parseIsoDuration(text)).toBeNull();
  });
});

describe('NWS validTime intervals', () => {
  it('parses start/duration', () => {
    const t = parseValidTime('2026-10-08T17:00:00+00:00/PT6H');
    expect(t).toEqual({ start: Date.parse('2026-10-08T17:00:00Z'), end: Date.parse('2026-10-08T23:00:00Z') });
  });

  it('respects the offset on the start time', () => {
    const t = parseValidTime('2026-10-08T12:00:00-05:00/PT1H');
    expect(t?.start).toBe(Date.parse('2026-10-08T17:00:00Z'));
  });

  it('parses long intervals: P1DT6H and P7DT12H', () => {
    expect(parseValidTime('2026-10-08T00:00:00Z/P1DT6H')).toEqual({
      start: Date.parse('2026-10-08T00:00:00Z'),
      end: Date.parse('2026-10-09T06:00:00Z'),
    });
    const week = parseValidTime('2026-10-08T17:00:00+00:00/P7DT12H');
    expect(week && (week.end - week.start) / H).toBe(180);
  });

  it('accepts start/end form', () => {
    expect(parseValidTime('2026-10-08T00:00:00Z/2026-10-08T03:00:00Z')).toEqual({
      start: Date.parse('2026-10-08T00:00:00Z'),
      end: Date.parse('2026-10-08T03:00:00Z'),
    });
  });

  it.each([null, undefined, 42, '', 'nonsense', '2026-10-08T17:00:00Z', '2026-10-08T17:00:00Z/', 'bad/PT1H', '2026-10-08T17:00:00Z/PT0S'])(
    'rejects %j',
    (v) => {
      expect(parseValidTime(v)).toBeNull();
    },
  );
});

describe('zone-aware calendar helpers (independent of the machine zone)', () => {
  const instant = Date.parse('2026-10-09T02:42:00Z');

  it('maps one instant to different local dates and hours', () => {
    expect(localDateOf(instant, 'America/Chicago')).toBe('2026-10-08'); // 21:42 CDT
    expect(localHourOf(instant, 'America/Chicago')).toBe(21);
    expect(localDateOf(instant, 'America/Phoenix')).toBe('2026-10-08'); // 19:42 MST (no DST)
    expect(localHourOf(instant, 'America/Phoenix')).toBe(19);
    expect(localDateOf(instant, 'America/Puerto_Rico')).toBe('2026-10-08'); // 22:42 AST
    expect(localDateOf(instant, 'America/Anchorage')).toBe('2026-10-08'); // 18:42 AKDT
    expect(localDateOf(instant, 'Pacific/Auckland')).toBe('2026-10-09'); // 15:42 NZDT
    expect(localDateOf(instant, 'UTC')).toBe('2026-10-09');
  });

  it('reports the offset, including half-hour zones and DST', () => {
    expect(tzOffsetMs(instant, 'America/Chicago')).toBe(-5 * H);
    expect(tzOffsetMs(Date.parse('2026-12-01T12:00:00Z'), 'America/Chicago')).toBe(-6 * H);
    expect(tzOffsetMs(instant, 'America/Phoenix')).toBe(-7 * H);
    expect(tzOffsetMs(instant, 'Asia/Kolkata')).toBe(5.5 * H);
  });

  it('converts wall-clock times to instants', () => {
    expect(isoZ(zonedWallToMs('2026-10-08', 12, 0, 'America/Chicago'))).toBe('2026-10-08T17:00:00Z');
    expect(isoZ(zonedWallToMs('2026-10-08', 12, 0, 'America/Phoenix'))).toBe('2026-10-08T19:00:00Z');
    expect(isoZ(zonedWallToMs('2026-12-01', 0, 0, 'America/Chicago'))).toBe('2026-12-01T06:00:00Z');
    expect(isoZ(startOfLocalDay('2026-10-09', 'Pacific/Auckland'))).toBe('2026-10-08T11:00:00Z');
  });

  it('round-trips wall-clock times through localDateOf/localHourOf', () => {
    for (const tz of ['America/Chicago', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico', 'Pacific/Guam']) {
      for (const [date, hour] of [
        ['2026-01-15', 0],
        ['2026-07-04', 23],
        ['2026-10-08', 12],
      ] as const) {
        const ms = zonedWallToMs(date, hour, 0, tz);
        expect(localDateOf(ms, tz)).toBe(date);
        expect(localHourOf(ms, tz)).toBe(hour);
      }
    }
  });

  it('knows that DST days are 23 or 25 hours long', () => {
    expect(hoursInLocalDay('2026-10-08', 'America/Chicago')).toBe(24);
    expect(hoursInLocalDay('2026-03-08', 'America/Chicago')).toBe(23); // spring forward
    expect(hoursInLocalDay('2026-11-01', 'America/Chicago')).toBe(25); // fall back
    expect(hoursInLocalDay('2026-11-01', 'America/Phoenix')).toBe(24);
  });

  it('falls back to UTC for an unknown zone name instead of throwing', () => {
    expect(localDateOf(instant, 'Not/AZone')).toBe('2026-10-09');
  });

  it('does date arithmetic on YYYY-MM-DD strings', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-08', '2026-10-18')).toBe(10);
    expect(daysBetween('2026-10-18', '2026-10-08')).toBe(-10);
  });

  it('formats and floors instants', () => {
    expect(isoZ(Date.parse('2026-10-08T17:05:09.123Z'))).toBe('2026-10-08T17:05:09Z');
    expect(isoZ(floorToHour(Date.parse('2026-10-08T17:59:59.999Z')))).toBe('2026-10-08T17:00:00Z');
    expect(parseTime('2026-10-08T12:00:00-05:00')).toBe(Date.parse('2026-10-08T17:00:00Z'));
    expect(parseTime('nope')).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});
