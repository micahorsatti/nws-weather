/**
 * Live smoke test against the real APIs. Skipped unless LIVE=1:
 *
 *   LIVE=1 npx vitest run src/data/live.test.ts
 *
 * It prints a compact summary per location. Set AIRNOW_KEY to also exercise the AirNow path
 * (the key is never printed).
 */
import { describe, expect, it } from 'vitest';
import { loadWeather } from './assemble';
import { loadForecastDiscussion } from './nws/discussion';
import { searchPlaces } from './geocode';
import { placeIdFor, type DailyForecast, type Place, type WeatherBundle } from './types';
import { cToF } from '../lib/units';

type Env = { LIVE?: string; AIRNOW_KEY?: string };
const env: Env = (globalThis as { process?: { env?: Env } }).process?.env ?? {};
const live = env.LIVE === '1';

const place = (name: string, lat: number, lon: number): Place => ({ id: placeIdFor(lat, lon), name, lat, lon, kind: 'search' });

const PLACES = [place('Linn, KS', 39.7456, -97.0892), place('Phoenix, AZ', 33.4484, -112.074), place('San Juan, PR', 18.4655, -66.1057)];

const f0 = (v: number | null): string => (v === null ? '—' : String(Math.round(cToF(v))));

function summarize(b: WeatherBundle): string {
  const c = b.current;
  const first = b.hourly[0];
  const last = b.hourly[b.hourly.length - 1];
  const sources = (days: DailyForecast[]): string => `${days.filter((d) => d.source === 'nws').length} nws + ${days.filter((d) => d.source === 'gfs').length} gfs`;
  const lines = [
    `=== ${b.place.name}  (${b.point.wfo} ${b.point.gridX},${b.point.gridY}  ${b.point.timeZone}  radar ${b.point.radarStation ?? 'none'})`,
    `current: ${c ? `${f0(c.tempC)}°F feels ${f0(c.feelsLikeC)}°F [${c.feelsLikeKind}] ${c.description} (${c.icon}${c.isDaytime ? ', day' : ', night'}) via ${c.source}${c.stationId ? ' ' + c.stationId : ''} @ ${c.observedAt}` : 'none'}`,
    `hourly: ${b.hourly.length} points ${first?.time ?? '-'} -> ${last?.time ?? '-'}; first: ${first ? `${f0(first.tempC)}°F feels ${f0(first.feelsLikeC)} [${first.feelsLikeKind}] ${first.shortForecast} uv ${first.uvIndex ?? '—'} aqi ${first.aqi ?? '—'}` : '-'}`,
    `daily: ${b.daily.length} (${sources(b.daily)}): ${b.daily.map((d) => `${d.date.slice(5)}${d.source === 'gfs' ? '*' : ''} ${f0(d.highC)}/${f0(d.lowC)}`).join(' | ')}`,
    `sun: ${b.sun.sunrise} -> ${b.sun.sunset} (${b.sun.daylightMinutes} min)`,
    `aqi: ${b.airNow ? `${b.airNow.aqi} ${b.airNow.primaryPollutant ?? ''} via ${b.airNow.source}${b.airNow.reportingArea ? ' ' + b.airNow.reportingArea : ''}` : 'none'}; forecast days ${b.airForecast.length} (${[...new Set(b.airForecast.map((d) => d.source))].join(',')})`,
    `alerts: ${b.alerts.length}${b.alerts.length ? ' (' + b.alerts.map((a) => `${a.event} [${a.severity}]`).join('; ') + ')' : ''}`,
    `forecastUpdatedAt: ${b.forecastUpdatedAt}; problems: ${b.problems.length ? b.problems.map((p) => `${p.source}: ${p.message}`).join(' | ') : 'none'}`,
  ];
  return lines.join('\n');
}

describe.skipIf(!live)('live smoke test (real APIs)', () => {
  for (const p of PLACES) {
    it(`loadWeather ${p.name}`, async () => {
      const bundle = await loadWeather(p, { airNowKey: env.AIRNOW_KEY });
      console.log(summarize(bundle));
      expect(bundle.hourly.length).toBeGreaterThan(100);
      expect(bundle.daily.length).toBe(10);
      expect(bundle.daily.filter((d) => d.source === 'nws').length).toBeGreaterThanOrEqual(6);
      expect(bundle.current).not.toBeNull();
      expect(JSON.stringify(bundle)).not.toContain('NaN');
    }, 90_000);
  }

  it('searchPlaces', async () => {
    const queries = ['Springfield', '66952', 'Linn, KS', 'San Juan', 'Hagatna'];
    for (const q of queries) {
      const results = await searchPlaces(q);
      console.log(`search "${q}": ${results.slice(0, 5).map((r) => `${r.name} (${r.lat},${r.lon})`).join('; ') || 'no results'}`);
      expect(results.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('loadForecastDiscussion', async () => {
    const afd = await loadForecastDiscussion('TOP');
    console.log(`AFD TOP issued ${afd.issuedAt}, ${afd.text.length} chars, ${afd.url}`);
    expect(afd.text.length).toBeGreaterThan(500);
  }, 60_000);
});
