import { describe, expect, it } from 'vitest';
import { fToC } from '../../lib/units';
import { feelsComparison, feelsDelta, feelsLikeNote } from './feels';

const c = fToC;

describe('feelsLikeNote (hero explanation)', () => {
  it('says humidity makes it feel warmer when the heat index runs at least 2° above the air', () => {
    expect(feelsLikeNote('heat-index', c(90), c(99), 'imperial')).toBe('Humidity makes it feel warmer');
    expect(feelsLikeNote('heat-index', c(86), c(88), 'imperial')).toBe('Humidity makes it feel warmer'); // exactly +2
  });

  it('does not claim humidity makes it warmer in dry heat (Phoenix: 84° air, "Feels like 82°")', () => {
    expect(feelsLikeNote('heat-index', c(84), c(82), 'imperial')).toBe('Dry air makes it feel a little cooler');
    expect(feelsLikeNote('heat-index', c(105), c(96), 'imperial')).toBe('Dry air makes it feel a little cooler');
  });

  it('stays quiet when the difference is under 2° either way', () => {
    expect(feelsLikeNote('heat-index', c(84), c(85), 'imperial')).toBeNull();
    expect(feelsLikeNote('heat-index', c(84), c(83), 'imperial')).toBeNull();
    expect(feelsLikeNote('heat-index', c(84), c(84), 'imperial')).toBeNull();
  });

  it('explains wind chill only when it feels at least 2° colder', () => {
    expect(feelsLikeNote('wind-chill', c(20), c(8), 'imperial')).toBe('Wind makes it feel colder');
    expect(feelsLikeNote('wind-chill', c(30), c(28), 'imperial')).toBe('Wind makes it feel colder'); // exactly -2
    expect(feelsLikeNote('wind-chill', c(30), c(29), 'imperial')).toBeNull();
    // A wind-chill reading above the air temperature makes no sense; say nothing rather than something wrong.
    expect(feelsLikeNote('wind-chill', c(30), c(36), 'imperial')).toBeNull();
  });

  it('has nothing to explain when the feels-like value is just the air temperature', () => {
    expect(feelsLikeNote('actual', c(70), c(70), 'imperial')).toBeNull();
    expect(feelsLikeNote('actual', c(70), c(60), 'imperial')).toBeNull();
  });

  it('applies the threshold to the numbers the user sees (rounded, in the display unit)', () => {
    // 29.4 °C -> 85 °F and 28.3 °C -> 83 °F: a 2° gap as displayed.
    expect(feelsLikeNote('heat-index', 29.4, 28.3, 'imperial')).toBe('Dry air makes it feel a little cooler');
    // In Celsius the same readings are 29° and 28°: only a 1° gap, so no line.
    expect(feelsLikeNote('heat-index', 29.4, 28.3, 'metric')).toBeNull();
    expect(feelsLikeNote('heat-index', 30, 32, 'metric')).toBe('Humidity makes it feel warmer');
  });

  it('is silent when either value is missing', () => {
    expect(feelsLikeNote('heat-index', null, c(90), 'imperial')).toBeNull();
    expect(feelsLikeNote('heat-index', c(90), null, 'imperial')).toBeNull();
    expect(feelsLikeNote('wind-chill', undefined, undefined, 'metric')).toBeNull();
  });

  it('never uses the technical names', () => {
    const lines = [
      feelsLikeNote('heat-index', c(90), c(99), 'imperial'),
      feelsLikeNote('heat-index', c(84), c(82), 'imperial'),
      feelsLikeNote('wind-chill', c(20), c(8), 'imperial'),
    ].join(' ');
    expect(lines).not.toMatch(/heat index|wind chill/i);
  });
});

describe('feelsDelta / feelsComparison', () => {
  it('measures the gap in displayed whole degrees', () => {
    expect(feelsDelta(c(84), c(82), 'imperial')).toBe(-2);
    expect(feelsDelta(c(90), c(99), 'imperial')).toBe(9);
    expect(feelsDelta(null, c(1), 'imperial')).toBeNull();
  });

  it('words the hourly readout with the same direction and threshold', () => {
    expect(feelsComparison('heat-index', c(90), c(99), 'imperial')).toBe('9° warmer');
    expect(feelsComparison('heat-index', c(84), c(82), 'imperial')).toBe('2° cooler');
    expect(feelsComparison('wind-chill', c(20), c(2), 'imperial')).toBe('18° colder');
    expect(feelsComparison('heat-index', c(84), c(83), 'imperial')).toBeNull();
    expect(feelsComparison('actual', c(60), c(60), 'imperial')).toBeNull();
  });
});
