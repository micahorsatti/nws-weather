import { describe, expect, it } from 'vitest';
import { AQI_INFO, UV_INFO, aqiCategory, aqiCategoryFromNumber, uvCategory } from './scales';

/** WCAG 2.x relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('category chip colors', () => {
  // The chips print 12-13 px bold numbers on the category color, which is "normal" text for WCAG: 4.5:1.
  const pairs = [
    ...Object.entries(AQI_INFO).map(([key, v]) => [`AQI ${key}`, v.color, v.onColor] as const),
    ...Object.entries(UV_INFO).map(([key, v]) => [`UV ${key}`, v.color, v.onColor] as const),
  ];

  it.each(pairs)('%s: the number is readable on its color (>= 4.5:1)', (_name, background, text) => {
    expect(contrast(background, text)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the official category colors for the swatches and scale bars', () => {
    expect(Object.values(AQI_INFO).map((v) => v.color)).toEqual(['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023']);
    expect(Object.values(UV_INFO).map((v) => v.color)).toEqual(['#3ea72d', '#fff300', '#f18b00', '#e53210', '#b567a4']);
  });
});

describe('category boundaries', () => {
  it('maps AQI values to the six EPA categories at the published breakpoints', () => {
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map(aqiCategory)).toEqual([
      'good',
      'good',
      'moderate',
      'moderate',
      'usg',
      'usg',
      'unhealthy',
      'unhealthy',
      'very-unhealthy',
      'very-unhealthy',
      'hazardous',
      'hazardous',
    ]);
    expect([1, 2, 3, 4, 5, 6].map(aqiCategoryFromNumber)).toEqual(['good', 'moderate', 'usg', 'unhealthy', 'very-unhealthy', 'hazardous']);
    expect(aqiCategoryFromNumber(0)).toBeNull();
    expect(aqiCategoryFromNumber(7)).toBeNull();
  });

  it('maps the UV index to the WHO categories, judging the number the user sees (rounded)', () => {
    expect([0, 2, 2.4, 2.5, 5, 5.4, 5.5, 7, 7.4, 7.5, 10, 10.4, 10.5, 13].map(uvCategory)).toEqual([
      'low',
      'low',
      'low',
      'moderate', // 2.5 shows as "3"
      'moderate',
      'moderate',
      'high', // 5.5 shows as "6"
      'high',
      'high',
      'very-high', // 7.5 shows as "8"
      'very-high',
      'very-high',
      'extreme', // 10.5 shows as "11"
      'extreme',
    ]);
  });
});
