import { describe, expect, it } from 'vitest';
import {
  LEGEND_BANDS,
  LEGEND_DESCRIPTION,
  LEGEND_MAX_DBZ,
  LEGEND_MIN_DBZ,
  LEGEND_STOPS,
  LEGEND_TICKS,
  legendGradient,
  legendPercent,
} from './legend';

describe('reflectivity legend', () => {
  it('spans light rain to hail-level reflectivity', () => {
    expect(LEGEND_MIN_DBZ).toBeLessThanOrEqual(10);
    expect(LEGEND_MAX_DBZ).toBeGreaterThanOrEqual(65);
  });

  it('has color stops in ascending dBZ order inside the range', () => {
    const dbz = LEGEND_STOPS.map((s) => s.dbz);
    expect(dbz).toEqual([...dbz].sort((a, b) => a - b));
    expect(dbz[0]).toBe(LEGEND_MIN_DBZ);
    expect(dbz[dbz.length - 1]).toBe(LEGEND_MAX_DBZ);
    for (const s of LEGEND_STOPS) expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('follows the MRMS palette: blue, green, yellow/orange, red, white/purple', () => {
    const at = (dbz: number) => LEGEND_STOPS.find((s) => s.dbz === dbz)?.color;
    expect(at(10)).toBe('#4f8cb9'); // blue
    expect(at(25)).toBe('#0cb512'); // green
    expect(at(38)).toBe('#ffe101'); // yellow
    expect(at(47.6)).toBe('#fd0000'); // red begins just under 48
    expect(at(57.6)).toBe('#fefcff'); // white begins just under 58 (hail-level)
    expect(at(70)).toBe('#7800e2'); // purple
  });

  it('places values along the bar as percentages', () => {
    expect(legendPercent(LEGEND_MIN_DBZ)).toBe(0);
    expect(legendPercent(LEGEND_MAX_DBZ)).toBe(100);
    expect(legendPercent(37.5)).toBeCloseTo(50, 5);
  });

  it('builds a left-to-right CSS gradient with every stop', () => {
    const css = legendGradient();
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    for (const s of LEGEND_STOPS) expect(css).toContain(s.color);
    expect(css).toContain('#556ca4 0.0%');
    expect(css).toContain('#7800e2 100.0%');
  });

  it('labels ticks and plain-language bands inside the bar, light to hail', () => {
    for (const t of LEGEND_TICKS) {
      expect(t).toBeGreaterThanOrEqual(LEGEND_MIN_DBZ);
      expect(t).toBeLessThanOrEqual(LEGEND_MAX_DBZ);
    }
    expect(LEGEND_BANDS.map((b) => b.label)).toEqual(['Light', 'Moderate', 'Heavy', 'Hail']);
    const positions = LEGEND_BANDS.map((b) => b.dbz);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('has a screen-reader description that names the colors', () => {
    expect(LEGEND_DESCRIPTION).toMatch(/dBZ/);
    for (const word of ['blue', 'green', 'yellow', 'red', 'purple', 'hail']) expect(LEGEND_DESCRIPTION.toLowerCase()).toContain(word);
  });
});
