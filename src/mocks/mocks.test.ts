import { describe, expect, it } from 'vitest';
import { aqiCategory } from '../lib/scales';
import { cToF } from '../lib/units';
import { HOUR_MS } from '../ui/lib/time';
import { getMockBundle, getMockDiscussion, isMockName, MOCK_NAMES } from './index';

// 1:30 PM in Linn, KS (CDT); 12:30 PM in Bozeman, MT (MDT).
const NOW = Date.parse('2026-07-15T18:30:00Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Report every undefined, NaN or infinite value anywhere in a structure. */
function badValues(value: unknown, path = 'bundle', out: string[] = []): string[] {
  if (value === undefined) out.push(`${path} is undefined`);
  else if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${path} is ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => badValues(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) badValues(v, `${path}.${k}`, out);
  return out;
}

describe.each(MOCK_NAMES)('%s mock bundle', (name) => {
  const b = getMockBundle(name, NOW);

  it('satisfies the contract: no NaN, Infinity or undefined anywhere, and ISO times with offsets', () => {
    expect(badValues(b)).toEqual([]);
    for (const t of [b.fetchedAt, b.forecastUpdatedAt, b.current?.observedAt, b.sun.sunrise, b.sun.sunset, ...b.hourly.map((h) => h.time)]) {
      expect(t).toMatch(ISO);
    }
  });

  it('has 156 consecutive hourly points, the first being the current hour', () => {
    expect(b.hourly).toHaveLength(156);
    expect(Date.parse(b.hourly[0].time)).toBe(Math.floor(NOW / HOUR_MS) * HOUR_MS);
    for (let i = 1; i < b.hourly.length; i++) {
      expect(Date.parse(b.hourly[i].time) - Date.parse(b.hourly[i - 1].time)).toBe(HOUR_MS);
    }
  });

  it('has ten days: seven NWS days with periods and text, then three GFS days without', () => {
    expect(b.daily).toHaveLength(10);
    expect(b.daily.map((d) => d.source)).toEqual([...Array(7).fill('nws'), ...Array(3).fill('gfs')]);
    expect(b.daily[0].date).toBe('2026-07-15');
    for (let i = 1; i < 10; i++) expect(b.daily[i].date > b.daily[i - 1].date).toBe(true);
    for (const d of b.daily.slice(0, 7)) {
      expect(d.night?.detailedForecast.length).toBeGreaterThan(40);
      expect(d.day?.detailedForecast.length).toBeGreaterThan(40);
      expect(d.night?.windText).toMatch(/^(Calm|[NESW]{1,3} (around \d+ mph|\d+ to \d+ mph))$/);
    }
    for (const d of b.daily.slice(7)) {
      expect(d.day).toBeNull();
      expect(d.night).toBeNull();
      expect(d.highC).not.toBeNull();
    }
    expect(b.daily.every((d) => d.sunrise !== null && d.sunset !== null)).toBe(true);
  });

  it('keeps "feels like" consistent with its kind', () => {
    for (const h of b.hourly) {
      const t = cToF(h.tempC as number);
      if (h.feelsLikeKind === 'heat-index') expect(t).toBeGreaterThanOrEqual(79.5);
      if (h.feelsLikeKind === 'wind-chill') expect(t).toBeLessThanOrEqual(50.5);
      if (h.feelsLikeKind === 'actual') expect(h.feelsLikeC).toBe(h.tempC);
    }
  });

  it('is deterministic for a given moment and moves with the clock', () => {
    expect(getMockBundle(name, NOW)).toEqual(b);
    const later = getMockBundle(name, NOW + 3 * HOUR_MS);
    expect(Date.parse(later.hourly[0].time) - Date.parse(b.hourly[0].time)).toBe(3 * HOUR_MS);
  });

  it('has a forecaster discussion', async () => {
    const afd = await getMockDiscussion(name, NOW);
    expect(afd.wfo).toBe(b.point.wfo);
    expect(afd.text).toMatch(/Area Forecast Discussion/);
    expect(afd.url).toMatch(/^https:\/\//);
  });
});

describe('summer mock (hot, humid, stormy)', () => {
  const b = getMockBundle('summer', NOW);

  it('feels 8-10 °F hotter than the air because of humidity', () => {
    const c = b.current!;
    expect(c.feelsLikeKind).toBe('heat-index');
    const gap = cToF(c.feelsLikeC as number) - cToF(c.tempC as number);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(10.5);
  });

  it('has afternoon thunderstorms in the hourly and daily data', () => {
    expect(b.hourly.some((h) => h.icon === 'thunderstorm' || h.icon === 'severe-thunderstorm')).toBe(true);
    expect(b.hourly.some((h) => (h.thunderChancePct ?? 0) >= 60)).toBe(true);
    expect(b.daily.some((d) => d.icon === 'thunderstorm' || d.icon === 'severe-thunderstorm')).toBe(true);
  });

  it('has an active Severe Thunderstorm Warning with long text and a polygon', () => {
    const svr = b.alerts[0];
    expect(svr.event).toBe('Severe Thunderstorm Warning');
    expect(svr.severity).toBe('Severe');
    expect(svr.description.length).toBeGreaterThan(400);
    expect(svr.description).toMatch(/\n/); // hard line breaks, as NWS publishes them
    expect(svr.instruction?.length).toBeGreaterThan(200);
    expect(svr.geometry?.type).toBe('Polygon');
    const ring = (svr.geometry?.coordinates as number[][][])[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Date.parse(svr.expires as string)).toBeGreaterThan(NOW);
    expect(b.alerts.map((a) => a.severity)).toEqual(['Severe', 'Moderate', 'Minor']);
  });

  it('has official AirNow AQI 112 (Unhealthy for Sensitive Groups) and UV around 9', () => {
    expect(b.airNow).toMatchObject({ source: 'airnow', aqi: 112, primaryPollutant: 'O3' });
    expect(aqiCategory(112)).toBe('usg');
    expect(b.airForecast.length).toBeGreaterThanOrEqual(3);
    expect(b.airForecast.some((d) => d.aqi === null && d.categoryNumber !== null)).toBe(true); // category-only day
    const uvMax = Math.max(...b.hourly.map((h) => h.uvIndex ?? 0));
    expect(uvMax).toBeGreaterThanOrEqual(9);
    expect(b.daily[0].uvIndexMax).toBeGreaterThanOrEqual(9);
  });

  it('has no source problems', () => {
    expect(b.problems).toEqual([]);
  });
});

describe('winter mock (windy, snowy)', () => {
  const b = getMockBundle('winter', NOW);

  it('has a wind chill far below the air temperature', () => {
    const c = b.current!;
    expect(c.feelsLikeKind).toBe('wind-chill');
    expect(cToF(c.tempC as number) - cToF(c.feelsLikeC as number)).toBeGreaterThanOrEqual(15);
    expect(b.hourly.every((h) => h.feelsLikeKind === 'wind-chill')).toBe(true);
  });

  it('has snow, gusts and no alerts', () => {
    expect(b.hourly.filter((h) => (h.snowMm ?? 0) > 0).length).toBeGreaterThan(10);
    expect(b.hourly.some((h) => h.icon.includes('snow'))).toBe(true);
    expect(b.hourly.some((h) => (h.windGustKph ?? 0) > 50)).toBe(true);
    expect(b.hourly.some((h) => h.windGustKph === null)).toBe(true); // gust is optional in the contract
    expect(b.alerts).toEqual([]);
  });

  it('gets AQI from Open-Meteo and reports a UV outage as a partial failure', () => {
    expect(b.airNow?.source).toBe('open-meteo');
    expect(b.hourly[0].aqi).toBe(b.airNow?.aqi);
    expect(b.hourly[119].aqi).not.toBeNull();
    expect(b.hourly[120].aqi).toBeNull(); // the AQI forecast horizon is about five days
    expect(b.hourly.every((h) => h.uvIndex === null)).toBe(true);
    expect(b.problems).toEqual([{ source: 'open-meteo-uv', message: expect.any(String) }]);
  });
});

describe('isMockName', () => {
  it('accepts exactly the known names', () => {
    expect(isMockName('summer')).toBe(true);
    expect(isMockName('winter')).toBe(true);
    expect(isMockName('spring')).toBe(false);
    expect(isMockName(null)).toBe(false);
  });
});
