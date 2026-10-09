import { describe, expect, it } from 'vitest';
import { cToF, fToC, mphToKph } from '../lib/units';
import { feelsLike, feelsLikeKind, heatIndexF, humidityFromDewpoint, windChillF } from './feelsLike';

describe('NWS heat index', () => {
  it('matches the published reference values', () => {
    expect(heatIndexF(90, 70)).toBeGreaterThanOrEqual(105);
    expect(heatIndexF(90, 70)).toBeLessThanOrEqual(106.5);
    expect(heatIndexF(96, 65)).toBeCloseTo(121, 0);
    expect(heatIndexF(100, 40)).toBeCloseTo(109, 0);
    expect(heatIndexF(86, 50)).toBeCloseTo(88, 0);
  });

  it('uses the simple Steadman formula when it says it is not hot', () => {
    // 70°F / 50%: (simple + T) / 2 < 80 -> simple formula only.
    const simple = 0.5 * (70 + 61 + (70 - 68) * 1.2 + 50 * 0.094);
    expect(heatIndexF(70, 50)).toBeCloseTo(simple, 10);
    expect(heatIndexF(70, 50)).toBeCloseTo(69.05, 2);
  });

  it('applies the low-humidity adjustment (dry heat feels cooler than the regression says)', () => {
    const dry = heatIndexF(100, 8);
    const withoutAdjustment = heatIndexF(100, 13);
    expect(dry).toBeLessThan(100);
    expect(dry).toBeLessThan(withoutAdjustment);
    expect(heatIndexF(95, 10)).toBeCloseTo(89.4, 1);
  });

  it('applies the high-humidity adjustment between 80 and 87°F', () => {
    const regression = (t: number, rh: number): number =>
      -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t - 0.05481717 * rh * rh +
      0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
    const adjustment = ((90 - 85) / 10) * ((87 - 84) / 5);
    expect(heatIndexF(84, 90)).toBeCloseTo(regression(84, 90) + adjustment, 8);
  });

  it('stays finite and increases with humidity at 95°F', () => {
    let prev = -Infinity;
    for (const rh of [20, 40, 60, 80, 100]) {
      const hi = heatIndexF(95, rh);
      expect(Number.isFinite(hi)).toBe(true);
      expect(hi).toBeGreaterThan(prev);
      prev = hi;
    }
  });
});

describe('NWS wind chill', () => {
  it('matches the published reference values', () => {
    expect(windChillF(0, 15)).toBeCloseTo(-19.4, 0);
    expect(windChillF(40, 10)).toBeCloseTo(33.6, 0);
    expect(windChillF(20, 20)).toBeCloseTo(4.4, 0);
    expect(windChillF(-20, 30)).toBeCloseTo(-53, 0);
  });
});

describe('feelsLikeKind thresholds', () => {
  it('heat index from 80°F (inclusive), regardless of wind', () => {
    expect(feelsLikeKind(fToC(79.9), 0)).toBe('actual');
    expect(feelsLikeKind(fToC(80), 0)).toBe('heat-index');
    expect(feelsLikeKind(fToC(80), mphToKph(20))).toBe('heat-index');
    expect(feelsLikeKind(fToC(100), null)).toBe('heat-index');
  });

  it('wind chill at <= 50°F with wind >= 3 mph', () => {
    expect(feelsLikeKind(fToC(50), mphToKph(3))).toBe('wind-chill');
    expect(feelsLikeKind(fToC(50), mphToKph(2.9))).toBe('actual');
    expect(feelsLikeKind(fToC(50.1), mphToKph(10))).toBe('actual');
    expect(feelsLikeKind(fToC(0), mphToKph(15))).toBe('wind-chill');
    expect(feelsLikeKind(fToC(40), null)).toBe('actual');
    expect(feelsLikeKind(fToC(40), 0)).toBe('actual');
  });

  it('is robust to float round trips at the boundaries', () => {
    expect(feelsLikeKind(fToC(80), 0)).toBe('heat-index');
    expect(feelsLikeKind(cToF(fToC(80)) >= 80 ? fToC(80) : fToC(80), 0)).toBe('heat-index');
    expect(feelsLikeKind(26.7, 0)).toBe('heat-index'); // 80.06°F
    expect(feelsLikeKind(26.6, 0)).toBe('actual'); // 79.88°F
  });
});

describe('feelsLike()', () => {
  it('is the air temperature when neither rule applies', () => {
    expect(feelsLike({ tempC: 22, humidityPct: 53, windKph: 5 })).toEqual({ feelsLikeC: 22, kind: 'actual' });
    expect(feelsLike({ tempC: 15, humidityPct: 90, windKph: 30 })).toEqual({ feelsLikeC: 15, kind: 'actual' });
  });

  it('ignores a reported heat index when the air is mild (stations report it at 72°F)', () => {
    const r = feelsLike({ tempC: 22, humidityPct: 53, windKph: 5, reportedHeatIndexC: 21.64 });
    expect(r).toEqual({ feelsLikeC: 22, kind: 'actual' });
  });

  it('ignores a reported wind chill when it is warm', () => {
    expect(feelsLike({ tempC: 25, windKph: 30, reportedWindChillC: 20 })).toEqual({ feelsLikeC: 25, kind: 'actual' });
  });

  it('prefers the reported heat index when the rule applies', () => {
    expect(feelsLike({ tempC: 33, humidityPct: 70, reportedHeatIndexC: 41 })).toEqual({ feelsLikeC: 41, kind: 'heat-index' });
  });

  it('computes the heat index when none was reported', () => {
    const r = feelsLike({ tempC: fToC(90), humidityPct: 70, windKph: 10 });
    expect(r.kind).toBe('heat-index');
    expect(cToF(r.feelsLikeC ?? NaN)).toBeCloseTo(105.9, 0);
  });

  it('prefers the reported wind chill, else computes it', () => {
    expect(feelsLike({ tempC: -7, windKph: 16.7, reportedWindChillC: -13.4 })).toEqual({ feelsLikeC: -13.4, kind: 'wind-chill' });
    const r = feelsLike({ tempC: fToC(0), windKph: mphToKph(15) });
    expect(r.kind).toBe('wind-chill');
    expect(cToF(r.feelsLikeC ?? NaN)).toBeCloseTo(-19.4, 0);
  });

  it('falls back to NWS apparentTemperature, then to the air temperature, when inputs are missing', () => {
    expect(feelsLike({ tempC: 35, apparentC: 38 })).toEqual({ feelsLikeC: 38, kind: 'heat-index' });
    expect(feelsLike({ tempC: 35 })).toEqual({ feelsLikeC: 35, kind: 'actual' });
    expect(feelsLike({ tempC: -5, windKph: 20 }).kind).toBe('wind-chill');
  });

  it('returns null feels-like (kind actual) without a temperature', () => {
    expect(feelsLike({ tempC: null, humidityPct: 50 })).toEqual({ feelsLikeC: null, kind: 'actual' });
    expect(feelsLike({ tempC: NaN })).toEqual({ feelsLikeC: null, kind: 'actual' });
  });
});

describe('humidityFromDewpoint', () => {
  it('is 100% at saturation and drops as the air dries', () => {
    expect(humidityFromDewpoint(20, 20)).toBeCloseTo(100, 5);
    expect(humidityFromDewpoint(22, 12)).toBeCloseTo(52.6, 0); // KMYZ: 22/12 °C reported 53%
    expect(humidityFromDewpoint(30, 5)).toBeLessThan(25);
  });
});
