import { describe, expect, it } from 'vitest';
import { isDaytimeAt, sunTimesForDate } from './sun';

const minutes = (a: string | null, b: string): number => Math.abs(Date.parse(a ?? 'x') - Date.parse(b)) / 60_000;

describe('sunTimesForDate', () => {
  it("matches NWS's own astronomical data for Linn, KS on 2026-10-08", () => {
    // From the /points response: sunrise 07:31:44-05:00, sunset 18:59:53-05:00, transit 13:15:48-05:00.
    const sun = sunTimesForDate('2026-10-08', 'America/Chicago', 39.7456, -97.0892);
    expect(minutes(sun.sunrise, '2026-10-08T07:31:44-05:00')).toBeLessThan(2);
    expect(minutes(sun.sunset, '2026-10-08T18:59:53-05:00')).toBeLessThan(2);
    expect(minutes(sun.solarNoon, '2026-10-08T13:15:48-05:00')).toBeLessThan(2);
    expect(minutes(sun.civilDawn, '2026-10-08T07:04:50-05:00')).toBeLessThan(2);
    expect(minutes(sun.civilDusk, '2026-10-08T19:26:47-05:00')).toBeLessThan(2);
    expect(sun.daylightMinutes).toBeGreaterThan(680);
    expect(sun.daylightMinutes).toBeLessThan(695);
  });

  it('computes the local calendar day of the place, not of the machine or of UTC', () => {
    // Sunset in Honolulu is ~06:00 UTC the next day; the date is still the Honolulu date.
    const sun = sunTimesForDate('2026-06-21', 'Pacific/Honolulu', 21.3069, -157.8583);
    expect(sun.sunrise).toBe(new Date(sun.sunrise ?? '').toISOString().replace('.000', ''));
    expect(Date.parse(sun.sunset ?? '') - Date.parse(sun.sunrise ?? '')).toBeGreaterThan(12 * 3_600_000);
    expect(sun.sunrise?.startsWith('2026-06-21T1')).toBe(true); // 05:50 HST = 15:50Z
    expect(sun.sunset?.startsWith('2026-06-22T05')).toBe(true); // 19:15 HST = 05:15Z next day
  });

  it('returns each date in turn for a week (no off-by-one across the date line of UTC)', () => {
    const rises: number[] = [];
    for (const d of ['2026-10-08', '2026-10-09', '2026-10-10']) {
      const sun = sunTimesForDate(d, 'America/Phoenix', 33.4484, -112.074);
      rises.push(Date.parse(sun.sunrise ?? ''));
    }
    expect(rises[1] - rises[0]).toBeGreaterThan(23.9 * 3_600_000);
    expect(rises[1] - rises[0]).toBeLessThan(24.1 * 3_600_000);
    expect(rises[2] - rises[1]).toBeGreaterThan(23.9 * 3_600_000);
  });

  it('reports polar day (midnight sun) with null rise/set and 24 h of daylight', () => {
    const sun = sunTimesForDate('2026-06-21', 'America/Anchorage', 71.2906, -156.7886);
    expect(sun.sunrise).toBeNull();
    expect(sun.sunset).toBeNull();
    expect(sun.daylightMinutes).toBe(1440);
  });

  it('reports polar night with null rise/set and no daylight', () => {
    const sun = sunTimesForDate('2026-12-21', 'America/Anchorage', 71.2906, -156.7886);
    expect(sun.sunrise).toBeNull();
    expect(sun.sunset).toBeNull();
    expect(sun.daylightMinutes).toBe(0);
  });

  it('still gives rise and set in Utqiagvik in October', () => {
    const sun = sunTimesForDate('2026-10-08', 'America/Anchorage', 71.2906, -156.7886);
    expect(sun.sunrise).not.toBeNull();
    expect(sun.sunset).not.toBeNull();
    expect(sun.daylightMinutes).toBeGreaterThan(400);
    expect(sun.daylightMinutes).toBeLessThan(650); // ~9 h 53 min, shrinking toward the November polar night
  });
});

describe('isDaytimeAt', () => {
  it('is day at local noon and night at local midnight', () => {
    expect(isDaytimeAt(Date.parse('2026-10-08T18:00:00Z'), 39.7456, -97.0892)).toBe(true); // 13:00 CDT
    expect(isDaytimeAt(Date.parse('2026-10-09T06:00:00Z'), 39.7456, -97.0892)).toBe(false); // 01:00 CDT
  });

  it('switches at sunrise and sunset', () => {
    const sun = sunTimesForDate('2026-10-08', 'America/Chicago', 39.7456, -97.0892);
    const rise = Date.parse(sun.sunrise ?? '');
    const set = Date.parse(sun.sunset ?? '');
    expect(isDaytimeAt(rise - 10 * 60_000, 39.7456, -97.0892)).toBe(false);
    expect(isDaytimeAt(rise + 10 * 60_000, 39.7456, -97.0892)).toBe(true);
    expect(isDaytimeAt(set - 10 * 60_000, 39.7456, -97.0892)).toBe(true);
    expect(isDaytimeAt(set + 10 * 60_000, 39.7456, -97.0892)).toBe(false);
  });

  // The icons flip when the Sunrise and Sunset times shown on screen say they do (not 2-6 minutes earlier at
  // sunrise and later at sunset, which comparing suncalc's refraction-corrected altitude with -0.833° gave).
  it.each([
    ['Linn, KS, October', '2026-10-09', 'America/Chicago', 39.7456, -97.0892],
    ['Linn, KS, June', '2026-06-21', 'America/Chicago', 39.7456, -97.0892],
    ['Linn, KS, December', '2026-12-21', 'America/Chicago', 39.7456, -97.0892],
    ['Phoenix (no DST)', '2026-10-09', 'America/Phoenix', 33.4484, -112.074],
    ['Honolulu', '2026-10-09', 'Pacific/Honolulu', 21.3069, -157.8583],
    ['San Juan', '2026-10-09', 'America/Puerto_Rico', 18.4663, -66.1057],
    ['Guam', '2026-10-09', 'Pacific/Guam', 13.4443, 144.7937],
    ['Anchorage, December', '2026-12-01', 'America/Anchorage', 61.2181, -149.9003],
    ['Utqiagvik, October (slow sunrise at 71°N)', '2026-10-08', 'America/Anchorage', 71.2906, -156.7886],
    ['Linn, KS on the fall-back day', '2026-11-01', 'America/Chicago', 39.7456, -97.0892],
  ] as const)('flips exactly at the reported sunrise and sunset: %s', (_name, date, tz, lat, lon) => {
    const sun = sunTimesForDate(date, tz, lat, lon);
    const rise = Date.parse(sun.sunrise ?? '');
    const set = Date.parse(sun.sunset ?? '');
    expect(Number.isFinite(rise) && Number.isFinite(set)).toBe(true);
    // The reported times are truncated to whole seconds, so allow a couple of seconds either side.
    expect(isDaytimeAt(rise - 2000, lat, lon)).toBe(false);
    expect(isDaytimeAt(rise + 2000, lat, lon)).toBe(true);
    expect(isDaytimeAt(set - 2000, lat, lon)).toBe(true);
    expect(isDaytimeAt(set + 2000, lat, lon)).toBe(false);
    // and the middle of the day, the night after it, and (sunrise drifts a few minutes a day) the next morning
    expect(isDaytimeAt((rise + set) / 2, lat, lon)).toBe(true);
    expect(isDaytimeAt(set + 3 * 3_600_000, lat, lon)).toBe(false);
    expect(isDaytimeAt(rise + 24 * 3_600_000 + 30 * 60_000, lat, lon)).toBe(true);
  });

  it('is day all day in polar day and night all day in polar night', () => {
    for (const hour of [0, 6, 12, 18]) {
      const day = Date.parse('2026-06-21T00:00:00Z') + hour * 3_600_000;
      const night = Date.parse('2026-12-21T00:00:00Z') + hour * 3_600_000;
      expect(isDaytimeAt(day, 71.2906, -156.7886)).toBe(true);
      expect(isDaytimeAt(night, 71.2906, -156.7886)).toBe(false);
    }
  });

  it('never throws for odd places (the poles, the date line)', () => {
    for (const [lat, lon] of [
      [90, 0],
      [-90, 0],
      [0, 180],
      [0, -180],
      [51.88, -176.66], // Adak, Alaska: far west of its time zone's meridian
    ] as const) {
      expect(typeof isDaytimeAt(Date.parse('2026-10-09T12:00:00Z'), lat, lon)).toBe('boolean');
    }
  });
});
