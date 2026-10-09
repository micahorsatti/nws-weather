import { describe, expect, it } from 'vitest';
import { compassPoint, formatPrecip, formatTemp, formatWind, temp } from './units';
import { aqiCategory, uvCategory } from './scales';

describe('units', () => {
  it('converts and rounds temperatures', () => {
    expect(temp(24.444444, 'imperial')).toBe(76);
    expect(temp(-0.2, 'metric')).toBe(0);
    expect(formatTemp(null, 'imperial')).toBe('—');
    expect(formatTemp(0, 'imperial', true)).toBe('32°F');
  });

  it('formats wind and precipitation', () => {
    expect(formatWind(19.312128, 'imperial')).toBe('12 mph');
    expect(formatPrecip(6.35, 'imperial')).toBe('0.25 in');
    expect(formatPrecip(0.1, 'imperial')).toBe('<0.01 in');
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });

  it('categorizes AQI and UV', () => {
    expect(aqiCategory(42)).toBe('good');
    expect(aqiCategory(101)).toBe('usg');
    expect(uvCategory(2.4)).toBe('low');
    expect(uvCategory(2.6)).toBe('moderate');
    expect(uvCategory(11)).toBe('extreme');
  });
});
