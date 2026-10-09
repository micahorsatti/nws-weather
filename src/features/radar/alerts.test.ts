import { describe, expect, it } from 'vitest';
import type { AlertGeometry, AlertSeverity, WeatherAlert } from '../../data/types';
import { alertShapes, alertStyle, expiresLabel, normalizeGeometry, popupText } from './alerts';

const NOW = Date.parse('2026-10-09T02:30:00Z');
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

const square = (lon: number, lat: number, d = 0.2): number[][] => [
  [lon - d, lat - d],
  [lon + d, lat - d],
  [lon + d, lat + d],
  [lon - d, lat + d],
  [lon - d, lat - d],
];

function alert(over: Partial<WeatherAlert> & { geometry?: AlertGeometry | null }): WeatherAlert {
  return {
    id: 'a',
    event: 'Tornado Warning',
    headline: 'x',
    severity: 'Extreme',
    urgency: 'Immediate',
    certainty: 'Observed',
    effective: null,
    onset: null,
    expires: inMin(30),
    ends: null,
    areaDesc: '',
    senderName: '',
    description: '',
    instruction: null,
    url: null,
    geometry: { type: 'Polygon', coordinates: [square(-97, 39)] },
    ...over,
  };
}

/** Hue in degrees of a #rrggbb color. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('normalizeGeometry', () => {
  it('passes a valid polygon through', () => {
    const g: AlertGeometry = { type: 'Polygon', coordinates: [square(-97, 39)] };
    expect(normalizeGeometry(g)).toEqual(g);
  });

  it('keeps [lon, lat] order untouched (the controller swaps for Leaflet)', () => {
    const g = normalizeGeometry({ type: 'Polygon', coordinates: [square(-97, 39)] });
    expect((g?.coordinates as number[][][])[0]?.[0]).toEqual([-97.2, 38.8]);
  });

  it('keeps holes and drops invalid holes', () => {
    const hole = square(-97, 39, 0.05);
    const g = normalizeGeometry({ type: 'Polygon', coordinates: [square(-97, 39), hole, [[0, 0], [1, 1]]] });
    expect(g?.coordinates).toHaveLength(2);
  });

  it('rejects polygons with an unusable outer ring', () => {
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] })).toBeNull(); // 3 positions
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[Number.NaN, 1], [1, 1], [1, 2], [Number.NaN, 1]]] })).toBeNull();
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[200, 1], [201, 1], [201, 2], [200, 1]]] })).toBeNull(); // lon out of range
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[10, 95], [11, 95], [11, 96], [10, 95]]] })).toBeNull(); // lat out of range
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [] })).toBeNull();
  });

  it('filters a MultiPolygon down to its valid polygons', () => {
    const g = normalizeGeometry({ type: 'MultiPolygon', coordinates: [[square(-97, 39)], [[[0, 0]]], [square(-90, 35)]] });
    expect(g?.type).toBe('MultiPolygon');
    expect(g?.coordinates).toHaveLength(2);
    expect(normalizeGeometry({ type: 'MultiPolygon', coordinates: [[[[0, 0]]]] })).toBeNull();
  });

  it('rejects things that are not polygon geometry', () => {
    expect(normalizeGeometry(null)).toBeNull();
    expect(normalizeGeometry(undefined)).toBeNull();
    expect(normalizeGeometry({ type: 'Point', coordinates: [1, 2] } as unknown as AlertGeometry)).toBeNull();
    expect(normalizeGeometry({ type: 'Polygon' } as unknown as AlertGeometry)).toBeNull();
  });
});

describe('alertShapes', () => {
  it('drops alerts without a polygon (zone-based alerts)', () => {
    expect(alertShapes([alert({ geometry: null })], NOW)).toEqual([]);
  });

  it('drops alerts whose polygon is malformed', () => {
    expect(alertShapes([alert({ geometry: { type: 'Polygon', coordinates: [[[1, 1]]] } })], NOW)).toEqual([]);
  });

  it('drops alerts that have already ended, but only when every end time is past', () => {
    expect(alertShapes([alert({ expires: inMin(-5), ends: null })], NOW)).toEqual([]);
    expect(alertShapes([alert({ expires: inMin(-5), ends: inMin(-1) })], NOW)).toEqual([]);
    expect(alertShapes([alert({ expires: inMin(-5), ends: inMin(90) })], NOW)).toHaveLength(1); // a watch that outlives its message
    expect(alertShapes([alert({ expires: inMin(10), ends: inMin(-1) })], NOW)).toHaveLength(1);
  });

  it('keeps alerts with no times at all, and tolerates unparseable ones', () => {
    expect(alertShapes([alert({ expires: null, ends: null })], NOW)).toHaveLength(1);
    expect(alertShapes([alert({ expires: 'soon', ends: null })], NOW)).toHaveLength(1);
  });

  it('orders least severe first so the most severe is drawn on top', () => {
    const severities: AlertSeverity[] = ['Severe', 'Minor', 'Extreme', 'Unknown', 'Moderate'];
    const shapes = alertShapes(severities.map((severity, i) => alert({ id: String(i), severity })), NOW);
    expect(shapes.map((s) => s.severity)).toEqual(['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme']);
  });

  it('carries event, id and expiry, falling back to the end time when there is no expiry', () => {
    const exp = inMin(30);
    const [shape] = alertShapes([alert({ id: 'z', event: 'Flood Watch', expires: exp })], NOW);
    expect(shape).toMatchObject({ id: 'z', event: 'Flood Watch', expires: Date.parse(exp) });
    const [fromEnds] = alertShapes([alert({ expires: null, ends: inMin(45) })], NOW);
    expect(fromEnds?.expires).toBe(Date.parse(inMin(45)));
  });
});

describe('alertStyle', () => {
  const isRed = (h: number) => h >= 350 || h <= 12;

  it.each(['light', 'dark'] as const)('colors by severity in the %s theme: Extreme and Severe red, Moderate orange, Minor yellow', (theme) => {
    expect(isRed(hue(alertStyle('Extreme', theme).color))).toBe(true);
    expect(isRed(hue(alertStyle('Severe', theme).color))).toBe(true);
    const orange = hue(alertStyle('Moderate', theme).color);
    expect(orange).toBeGreaterThanOrEqual(22);
    expect(orange).toBeLessThanOrEqual(38);
    const yellow = hue(alertStyle('Minor', theme).color);
    expect(yellow).toBeGreaterThanOrEqual(42);
    expect(yellow).toBeLessThanOrEqual(58);
  });

  it('uses theme-appropriate shades and a translucent fill in the same color', () => {
    expect(alertStyle('Extreme', 'light').color).not.toBe(alertStyle('Extreme', 'dark').color);
    const s = alertStyle('Severe', 'dark');
    expect(s.fillColor).toBe(s.color);
    expect(s.fillOpacity).toBeGreaterThan(0);
    expect(s.fillOpacity).toBeLessThan(0.3);
    expect(s.weight).toBeGreaterThanOrEqual(2);
  });

  it('outlines the most severe alerts a little heavier', () => {
    expect(alertStyle('Extreme', 'light').weight).toBeGreaterThan(alertStyle('Minor', 'light').weight);
  });
});

describe('popup text', () => {
  const opts = { locale: 'en-US', timeZone: 'America/Chicago' };
  const clean = (s: string) => s.replace(/\s/g, ' ');

  it('labels a same-day expiry with just the time', () => {
    // NOW is 21:30 on Oct 8 in Chicago; 4:15 PM... use 11:15 PM the same evening.
    expect(clean(expiresLabel(Date.parse('2026-10-09T04:15:00Z'), NOW, opts))).toBe('Expires 11:15 PM');
  });

  it('adds the weekday when the expiry is on another day', () => {
    expect(clean(expiresLabel(Date.parse('2026-10-09T21:15:00Z'), NOW, opts))).toBe('Expires Fri 4:15 PM');
  });

  it('is empty when there is no expiry', () => {
    expect(expiresLabel(null, NOW, opts)).toBe('');
  });

  it('puts the event in the title and severity plus expiry in the detail', () => {
    const [shape] = alertShapes([alert({ event: 'Severe Thunderstorm Warning', severity: 'Severe', expires: '2026-10-09T04:15:00Z' })], NOW);
    const { title, detail } = popupText(shape!, NOW, opts);
    expect(title).toBe('Severe Thunderstorm Warning');
    expect(clean(detail)).toBe('Severe · Expires 11:15 PM');
  });

  it('leaves out an unknown severity', () => {
    const [shape] = alertShapes([alert({ severity: 'Unknown', expires: '2026-10-09T04:15:00Z' })], NOW);
    expect(clean(popupText(shape!, NOW, opts).detail)).toBe('Expires 11:15 PM');
  });
});
