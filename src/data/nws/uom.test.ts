import { describe, expect, it } from 'vitest';
import { convertUom, stripUnitNamespace } from './uom';

describe('unit-of-measure conversion', () => {
  it('converts temperatures to °C', () => {
    expect(convertUom(21, 'wmoUnit:degC', 'temperature')).toBe(21);
    expect(convertUom(32, 'wmoUnit:degF', 'temperature')).toBe(0);
    expect(convertUom(212, 'wmoUnit:degF', 'temperature')).toBeCloseTo(100, 10);
    expect(convertUom(273.15, 'wmoUnit:K', 'temperature')).toBeCloseTo(0, 10);
  });

  it('converts speeds to km/h', () => {
    expect(convertUom(12.964, 'wmoUnit:km_h-1', 'speed')).toBe(12.964);
    expect(convertUom(10, 'wmoUnit:m_s-1', 'speed')).toBeCloseTo(36, 10);
    expect(convertUom(10, 'wmoUnit:kt', 'speed')).toBeCloseTo(18.52, 10);
    expect(convertUom(10, 'wmoUnit:mi_h-1', 'speed')).toBeCloseTo(16.09344, 10);
  });

  it('converts depths to mm', () => {
    expect(convertUom(2.5, 'wmoUnit:mm', 'precip')).toBe(2.5);
    expect(convertUom(2.5, 'wmoUnit:cm', 'precip')).toBe(25);
    expect(convertUom(1, 'wmoUnit:in', 'precip')).toBeCloseTo(25.4, 10);
    expect(convertUom(0.003, 'wmoUnit:m', 'precip')).toBeCloseTo(3, 10);
  });

  it('converts pressure to Pa, distance to m, percent and angle unchanged', () => {
    expect(convertUom(1015, 'wmoUnit:hPa', 'pressure')).toBe(101500);
    expect(convertUom(101520, 'wmoUnit:Pa', 'pressure')).toBe(101520);
    expect(convertUom(16, 'wmoUnit:km', 'distance')).toBe(16000);
    expect(convertUom(16090, 'wmoUnit:m', 'distance')).toBe(16090);
    expect(convertUom(55, 'wmoUnit:percent', 'percent')).toBe(55);
    expect(convertUom(150, 'wmoUnit:degree_(angle)', 'angle')).toBe(150);
  });

  it('assumes the canonical unit when the layer names none (NWS omits uom on some layers)', () => {
    expect(convertUom(40, undefined, 'percent')).toBe(40);
    expect(convertUom(40, '', 'percent')).toBe(40);
    expect(convertUom(40, null, 'temperature')).toBe(40);
  });

  it('refuses an unrecognised unit rather than guessing', () => {
    expect(convertUom(40, 'wmoUnit:furlong_fortnight-1', 'speed')).toBeNull();
    expect(convertUom(40, 'wmoUnit:degC', 'speed')).toBeNull();
  });

  it('returns null for missing or non-finite values', () => {
    expect(convertUom(null, 'wmoUnit:degC', 'temperature')).toBeNull();
    expect(convertUom(undefined, 'wmoUnit:degC', 'temperature')).toBeNull();
    expect(convertUom(NaN, 'wmoUnit:degC', 'temperature')).toBeNull();
    expect(convertUom('21', 'wmoUnit:degC', 'temperature')).toBeNull();
  });

  it('strips unit namespaces', () => {
    expect(stripUnitNamespace('wmoUnit:degC')).toBe('degC');
    expect(stripUnitNamespace('nwsUnit:thing')).toBe('thing');
    expect(stripUnitNamespace('degC')).toBe('degC');
  });
});
