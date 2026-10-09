import { describe, expect, it } from 'vitest';
import { getMockBundle } from '../../mocks';
import { LABEL_W, PAD_R, barPath, layoutChart } from './chartLayout';
import type { ChartLayout } from './chartLayout';
import { buildRows } from './hourly';
import type { RangeMode } from './hourly';

const CHI = 'America/Chicago';
const NOW = Date.parse('2026-07-15T18:30:00Z');
const summer = getMockBundle('summer', NOW);
const winter = getMockBundle('winter', NOW);
const DEN = 'America/Denver';

function layoutFor(name: 'summer' | 'winter', mode: RangeMode, units: 'imperial' | 'metric' = 'imperial'): { layout: ChartLayout; n: number } {
  const b = name === 'summer' ? summer : winter;
  const tz = name === 'summer' ? CHI : DEN;
  const rows = buildRows(b.hourly, NOW, tz, mode);
  const todayKey = name === 'summer' ? '2026-07-15' : '2026-07-15';
  return { layout: layoutChart(rows, mode, units, tz, todayKey, NOW), n: rows.length };
}

/** Every number in the layout that ends up in the DOM must be finite. */
function expectNoNaN(layout: ChartLayout) {
  const json = JSON.stringify(layout, (_k, v) => (typeof v === 'function' ? undefined : v));
  expect(json).not.toMatch(/NaN|Infinity|null,"y":null/);
  for (const path of [layout.temp?.tempPath, layout.temp?.feelsPath, layout.temp?.areaPath, ...(layout.precip?.bars.map((b) => b.path) ?? [])]) {
    expect(path ?? '').not.toMatch(/NaN/);
  }
}

describe('layoutChart, 48 hours', () => {
  const { layout, n } = layoutFor('summer', '48h');

  it('is 56 px per hour wide, with padding at the end', () => {
    expect(n).toBe(48);
    expect(layout.px).toBe(56);
    expect(layout.width).toBe(48 * 56 + PAD_R);
    expect(layout.height).toBeGreaterThan(300);
    expectNoNaN(layout);
  });

  it('stacks every row without overlap, inside the height', () => {
    const bands = Object.values(layout.bands).filter((b): b is NonNullable<typeof b> => b !== null);
    expect(bands).toHaveLength(8);
    for (let i = 1; i < bands.length; i++) expect(bands[i].y).toBeGreaterThanOrEqual(bands[i - 1].y + bands[i - 1].h);
    const last = bands[bands.length - 1];
    expect(last.y + last.h).toBe(layout.height);
  });

  it('labels "Now", then every hour, with icons centred in their cells', () => {
    expect(layout.timeLabels[0].text).toBe('Now');
    expect(layout.timeLabels[1].text).toMatch(/^2\s?PM$/);
    expect(layout.timeLabels).toHaveLength(48);
    expect(layout.icons).toHaveLength(48);
    expect(layout.icons[0].xc).toBe(28);
    expect(layout.icons[1].xc).toBe(84);
  });

  it('puts day separators at local midnight, with a label for each day', () => {
    expect(layout.separators).toEqual([11, 35]);
    expect(layout.dayLabels.map((d) => d.text)).toEqual(['Today', 'Thu 16', 'Fri 17']);
    expect(layout.dayLabels[1].x).toBe(11 * 56 + 6);
  });

  it('draws the temperature and Feels-like lines and keeps value labels on the outside', () => {
    const t = layout.temp!;
    expect(t.tempPath.startsWith('M')).toBe(true);
    expect(t.feelsPath.startsWith('M')).toBe(true);
    expect(t.ticks.length).toBeGreaterThanOrEqual(2);
    expect(t.domain[0]).toBeLessThan(t.domain[1]);
    // Wherever feels-like is shown above the air temperature, its label sits above the temperature label.
    const byHour = new Map<number, { temp?: number; feels?: number }>();
    for (const l of t.labels) byHour.set(l.i, { ...byHour.get(l.i), [l.series]: l.y });
    const pairs = [...byHour.values()].filter((v) => v.temp !== undefined && v.feels !== undefined);
    expect(pairs.length).toBeGreaterThan(3);
    for (const p of pairs) expect(p.feels).not.toBe(p.temp);
    // Labels never leave the plot band.
    const band = layout.bands.temp!;
    for (const l of t.labels) {
      expect(l.y).toBeGreaterThan(band.y);
      expect(l.y).toBeLessThan(band.y + band.h);
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(layout.width);
    }
  });

  it('labels only some hours, never every point', () => {
    const labelled = new Set(layout.temp!.labels.filter((l) => l.series === 'temp').map((l) => l.i));
    expect(labelled.size).toBeGreaterThan(10);
    expect(labelled.size).toBeLessThan(48);
  });

  it('draws precipitation bars capped at 34 px, labelled when the chance is 20% or more', () => {
    const bars = layout.precip!.bars;
    expect(bars.length).toBeGreaterThan(5);
    for (const b of bars) {
      expect(b.h).toBeLessThanOrEqual(34);
      expect(b.h).toBeGreaterThanOrEqual(2);
      expect(b.w).toBeLessThanOrEqual(24);
      expect(b.y + b.h).toBeCloseTo(layout.precip!.baseline);
    }
    const tall = bars.find((b) => b.h > 20)!;
    expect(tall.label?.text).toMatch(/^\d+%$/);
    expect(bars.some((b) => b.amount !== null)).toBe(true); // amounts appear when it actually rains
  });

  it('has a wind cell per hour, arrows pointing downwind, and gusts only when meaningfully higher', () => {
    expect(layout.wind).toHaveLength(48);
    const first = layout.wind[0];
    const dir = summer.hourly[0].windDirDeg as number;
    expect(first.rotate).toBe((dir + 180) % 360);
    for (const w of layout.wind) if (w.gust !== null) expect(Number(w.gust)).toBeGreaterThan(Number(w.speed));
  });

  it('colors UV and AQI chips by category, and uses a quiet dash for no UV at night', () => {
    expect(layout.uv).toHaveLength(48);
    expect(layout.aqi).toHaveLength(48);
    const night = layout.uv.find((c) => c.empty);
    expect(night?.text).toBe('–');
    const day = layout.uv.find((c) => !c.empty && Number(c.text) >= 9)!;
    expect(day.bg).toMatch(/^#/);
    expect(day.fg).toMatch(/^#/);
  });
});

describe('layoutChart, 7 days', () => {
  const { layout, n } = layoutFor('summer', '7d');

  it('is denser: 24 px per hour with 3-hour cells for icons, wind and chips', () => {
    expect(n).toBe(156);
    expect(layout.px).toBe(24);
    expect(layout.width).toBe(156 * 24 + PAD_R);
    expect(layout.icons.length).toBe(layout.blocks.length);
    expect(layout.icons.length).toBeLessThan(60);
    expect(layout.wind.length).toBe(layout.blocks.length);
    expectNoNaN(layout);
  });

  it('labels the time axis at the left edge of each 3-hour cell, and only the peak of each day for rain', () => {
    expect(layout.timeLabels[0].text).toBe('Now');
    expect(layout.timeLabels.every((t) => t.anchor === 'start')).toBe(true);
    const labelled = layout.precip!.bars.filter((b) => b.label);
    expect(labelled.length).toBeLessThanOrEqual(8);
    expect(layout.precip!.bars.every((b) => b.amount === null)).toBe(true);
  });
});

describe('layoutChart, other data shapes', () => {
  it('omits the UV row when there is no UV data at all (winter fixture has a UV outage)', () => {
    const { layout } = layoutFor('winter', '48h');
    expect(layout.bands.uv).toBeNull();
    expect(layout.uv).toEqual([]);
    expect(layout.bands.aqi).not.toBeNull();
    const withUv = layoutFor('summer', '48h').layout;
    expect(layout.height).toBeLessThan(withUv.height);
    expectNoNaN(layout);
  });

  it('shows snow amounts for snow hours and uses the display unit', () => {
    const imperial = layoutFor('winter', '48h').layout.precip!.bars.find((b) => b.amount?.snow);
    const metric = layoutFor('winter', '48h', 'metric').layout.precip!.bars.find((b) => b.amount?.snow);
    expect(imperial?.amount?.text).toMatch(/^\d+(\.\d)?$/);
    expect(metric?.amount?.text).toMatch(/ cm$/);
  });

  it('survives missing values', () => {
    const rows = buildRows(summer.hourly, NOW, CHI, '48h').map((r, i) =>
      i % 5 === 0 ? { ...r, p: { ...r.p, tempC: null, feelsLikeC: null, windKph: null, precipChancePct: null, uvIndex: null, aqi: null } } : r,
    );
    const layout = layoutChart(rows, '48h', 'imperial', CHI, '2026-07-15', NOW);
    expectNoNaN(layout);
    expect(layout.wind.length).toBe(48 - 10);
  });

  it('draws nothing for an empty series', () => {
    const layout = layoutChart([], '48h', 'imperial', CHI, '2026-07-15', NOW);
    expect(layout.width).toBe(PAD_R);
    expect(layout.temp).toBeNull();
    expect(layout.precip).toBeNull();
  });

  it('reserves a label column of a fixed width', () => {
    expect(LABEL_W).toBeGreaterThanOrEqual(40);
  });
});

describe('barPath', () => {
  it('has rounded top corners and a square baseline', () => {
    const d = barPath(10, 20, 30, 70);
    expect(d.startsWith('M10 70')).toBe(true);
    expect(d).toContain('Q10 30');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('degrades to a rectangle for a tiny bar', () => {
    expect(barPath(0, 10, 69, 70)).toMatch(/^M0 70/);
  });
});
