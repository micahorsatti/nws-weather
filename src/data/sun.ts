/** Sunrise/sunset computed on the device with suncalc, always for the *location's* calendar day. */
import { getPosition, getTimes } from 'suncalc';
import type { SunTimes } from './types';
import { MINUTE_MS, DAY_MS, isoZ, tzOffsetMs, zonedWallToMs } from './time';

function iso(d: Date | null | undefined): string | null {
  return d instanceof Date && Number.isFinite(d.getTime()) ? isoZ(d.getTime()) : null;
}

/**
 * Sun times for the local calendar day `date` ('YYYY-MM-DD') in `tz`. The calculation is anchored at
 * local noon of that date, so it never depends on the device's time zone. Polar day/night leave the
 * rise/set fields null; daylightMinutes is then 1440 (sun never sets) or 0 (never rises).
 */
export function sunTimesForDate(date: string, tz: string, lat: number, lon: number): SunTimes {
  const noon = zonedWallToMs(date, 12, 0, tz);
  const offsetMinutes = Math.round(tzOffsetMs(noon, tz) / MINUTE_MS);
  const t = getTimes(new Date(noon), lat, lon, 0, offsetMinutes);

  const sunrise = t.sunrise instanceof Date && Number.isFinite(t.sunrise.getTime()) ? t.sunrise.getTime() : null;
  const sunset = t.sunset instanceof Date && Number.isFinite(t.sunset.getTime()) ? t.sunset.getTime() : null;

  let daylightMinutes: number | null = null;
  if (sunrise !== null && sunset !== null) {
    const span = sunset >= sunrise ? sunset - sunrise : sunset - sunrise + DAY_MS;
    daylightMinutes = Math.round(span / MINUTE_MS);
  } else if (t.alwaysUp === true) {
    daylightMinutes = 24 * 60;
  } else if (t.alwaysDown === true) {
    daylightMinutes = 0;
  }

  return {
    sunrise: sunrise === null ? null : isoZ(sunrise),
    sunset: sunset === null ? null : isoZ(sunset),
    solarNoon: iso(t.solarNoon),
    civilDawn: iso(t.dawn),
    civilDusk: iso(t.dusk),
    daylightMinutes,
  };
}

/** True when the sun is above the horizon (standard sunrise/sunset altitude) at an instant and place. */
export function isDaytimeAt(ms: number, lat: number, lon: number): boolean {
  return getPosition(new Date(ms), lat, lon).altitude > -0.833;
}
