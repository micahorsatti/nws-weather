import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  formatAgo,
  formatClock,
  formatClockMaybeDay,
  formatDayClock,
  formatDuration,
  formatHour,
  formatMonthDay,
  formatWeekday,
  isoInZone,
  localDateKey,
  localHour,
  monthDayOfKey,
  parseTime,
  resolveZone,
  tzOffsetMs,
  weekdayOfKey,
  zonedToMs,
} from './time';

const CHI = 'America/Chicago';
const T = Date.parse('2026-07-15T18:30:00Z'); // 1:30 PM CDT, 11:30 AM PDT, 3:30 AM next day in Tokyo

describe('time zones (always the location\'s, never the device\'s)', () => {
  it('formats the same instant differently per zone', () => {
    expect(formatClock(T, CHI)).toMatch(/^1:30\s?PM$/);
    expect(formatClock(T, 'America/Los_Angeles')).toMatch(/^11:30\s?AM$/);
    expect(formatClock(T, 'Asia/Tokyo')).toMatch(/^3:30\s?AM$/);
    expect(formatHour(T, CHI)).toMatch(/^1\s?PM$/);
    expect(formatWeekday(T, CHI)).toBe('Wed');
    expect(formatWeekday(T, 'Asia/Tokyo')).toBe('Thu');
    expect(formatWeekday(T, CHI, 'long')).toBe('Wednesday');
    expect(formatMonthDay(T, CHI)).toBe('Jul 15');
    expect(formatDayClock(T, CHI)).toMatch(/^Wed 1:30\s?PM$/);
  });

  it('knows the local date and hour across midnight', () => {
    const late = Date.parse('2026-07-16T03:30:00Z'); // 10:30 PM on the 15th in Chicago
    expect(localDateKey(late, CHI)).toBe('2026-07-15');
    expect(localDateKey(late, 'Asia/Tokyo')).toBe('2026-07-16');
    const midnight = Date.parse('2026-07-15T05:00:00Z');
    expect(localHour(midnight, CHI)).toBe(0); // 0, never 24
    expect(localDateKey(midnight, CHI)).toBe('2026-07-15');
  });

  it('formats a clock time with the weekday only when it is not today', () => {
    const tonight = Date.parse('2026-07-16T02:00:00Z'); // 9 PM the same local day
    const tomorrow = Date.parse('2026-07-16T15:00:00Z'); // 10 AM next local day
    expect(formatClockMaybeDay(tonight, T, CHI)).toMatch(/^9:00\s?PM$/);
    expect(formatClockMaybeDay(tomorrow, T, CHI)).toMatch(/^Thu 10:00\s?AM$/);
  });

  it('converts wall-clock times to instants, including daylight saving changes', () => {
    expect(zonedToMs('2026-07-15', 13, 30, CHI)).toBe(T);
    expect(zonedToMs('2026-11-01', 12, 0, CHI)).toBe(Date.parse('2026-11-01T18:00:00Z')); // CST after the fall-back
    expect(zonedToMs('2026-03-08', 12, 0, CHI)).toBe(Date.parse('2026-03-08T17:00:00Z')); // CDT after the spring-forward
    expect(zonedToMs('2026-07-15', 12, 0, 'Asia/Kolkata')).toBe(Date.parse('2026-07-15T06:30:00Z')); // +05:30
    expect(zonedToMs('2026-07-15', 0, 0, 'America/Anchorage')).toBe(Date.parse('2026-07-15T08:00:00Z'));
  });

  it('reports offsets and writes ISO strings with them', () => {
    expect(tzOffsetMs(T, CHI)).toBe(-5 * 3_600_000);
    expect(tzOffsetMs(T, 'Asia/Kolkata')).toBe(5.5 * 3_600_000);
    expect(isoInZone(T, CHI)).toBe('2026-07-15T13:30:00-05:00');
    expect(isoInZone(T, 'Asia/Kolkata')).toBe('2026-07-16T00:00:00+05:30');
    expect(isoInZone(Date.parse('2026-07-15T05:00:00Z'), CHI)).toBe('2026-07-15T00:00:00-05:00');
    for (const tz of [CHI, 'America/Denver', 'Asia/Kolkata', 'Pacific/Honolulu']) {
      expect(Date.parse(isoInZone(T, tz))).toBe(T);
    }
  });

  it('falls back to a usable zone for a missing or invalid one', () => {
    expect(resolveZone(CHI)).toBe(CHI);
    // The fallback is the device zone, which is plain "UTC" on CI runners, so only require that it's usable.
    const fallback = resolveZone('Not/AZone');
    expect(fallback).not.toBe('Not/AZone');
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: fallback })).not.toThrow();
    expect(resolveZone(undefined)).toBeTruthy();
    expect(() => formatClock(T, resolveZone(''))).not.toThrow();
  });
});

describe('calendar-date helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysToKey('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('names the weekday and month-day of a date string', () => {
    expect(weekdayOfKey('2026-07-15')).toBe('Wed');
    expect(weekdayOfKey('2026-07-15', 'long')).toBe('Wednesday');
    expect(monthDayOfKey('2026-07-04')).toBe('Jul 4');
  });
});

describe('relative and duration text', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  it('says how long ago', () => {
    expect(formatAgo(now - 20_000, now)).toBe('just now');
    expect(formatAgo(now + 5_000, now)).toBe('just now'); // clock skew never goes negative
    expect(formatAgo(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAgo(now - 72 * 3_600_000, now)).toBe('3 d ago');
  });

  it('writes durations', () => {
    expect(formatDuration(0)).toBe('0 m');
    expect(formatDuration(45)).toBe('45 m');
    expect(formatDuration(180)).toBe('3 h');
    expect(formatDuration(859)).toBe('14 h 19 m');
  });

  it('parses ISO strings defensively', () => {
    expect(parseTime('2026-07-15T13:30:00-05:00')).toBe(T);
    expect(parseTime(null)).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('not a date')).toBeNull();
  });
});
