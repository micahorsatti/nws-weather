/**
 * Turns the app's WeatherAlert[] into drawable shapes: validates geometry, drops alerts that have
 * already ended, orders them so the most severe is drawn on top, and picks severity colors.
 * Pure module: no DOM, no Leaflet.
 */
import type { AlertGeometry, AlertSeverity, WeatherAlert } from '../../data/types';
import { formatClock } from './radarTime';
import type { LocaleOptions } from './radarTime';
import type { Theme } from './theme';

type Position = number[];

export interface AlertShape {
  id: string;
  event: string;
  severity: AlertSeverity;
  /** Epoch ms, or null when NWS gave none. */
  expires: number | null;
  /** Cleaned GeoJSON ([lon, lat] order). */
  geometry: AlertGeometry;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };

/** Outline colors per theme: Extreme/Severe red, Moderate orange, Minor yellow, Unknown slate. */
const SEVERITY_COLOR: Record<AlertSeverity, Record<Theme, string>> = {
  Extreme: { light: '#b3121b', dark: '#ff5c5c' },
  Severe: { light: '#d4322c', dark: '#ff7566' },
  Moderate: { light: '#e8780a', dark: '#ffa13d' },
  Minor: { light: '#c79a00', dark: '#ffd83d' },
  Unknown: { light: '#5f6e84', dark: '#a3b1c6' },
};

export interface AlertStyle {
  color: string;
  weight: number;
  opacity: number;
  fillColor: string;
  fillOpacity: number;
  lineJoin: 'round';
}

export function alertStyle(severity: AlertSeverity, theme: Theme): AlertStyle {
  const color = SEVERITY_COLOR[severity][theme];
  const strong = severity === 'Extreme' || severity === 'Severe';
  return { color, weight: strong ? 3 : 2.5, opacity: 0.95, fillColor: color, fillOpacity: strong ? 0.16 : 0.12, lineJoin: 'round' };
}

function isPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  );
}

/** A linear ring needs 4+ valid positions (closed ring). Null when it is not usable. */
function cleanRing(ring: unknown): Position[] | null {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) return null;
  return ring as Position[];
}

/** Outer ring plus any holes; invalid holes are dropped, an invalid outer ring voids the polygon. */
function cleanPolygon(rings: unknown): Position[][] | null {
  if (!Array.isArray(rings)) return null;
  const outer = cleanRing(rings[0]);
  if (!outer) return null;
  const holes = rings.slice(1).map(cleanRing).filter((r): r is Position[] => r !== null);
  return [outer, ...holes];
}

/** Validate NWS geometry before handing it to Leaflet. Null when nothing drawable remains. */
export function normalizeGeometry(geometry: AlertGeometry | null | undefined): AlertGeometry | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === 'Polygon') {
    const poly = cleanPolygon(geometry.coordinates);
    return poly ? { type: 'Polygon', coordinates: poly } : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = (geometry.coordinates as unknown[]).map(cleanPolygon).filter((p): p is Position[][] => p !== null);
    return polys.length > 0 ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Alerts that have a drawable polygon and have not ended, least severe first so the most severe lands on
 * top. An alert is "ended" only when both its expires and ends times (whichever exist) are past.
 */
export function alertShapes(alerts: readonly WeatherAlert[], now: number): AlertShape[] {
  const shapes: AlertShape[] = [];
  for (const alert of alerts) {
    const geometry = normalizeGeometry(alert.geometry);
    if (!geometry) continue;
    const expires = parseMs(alert.expires);
    const ends = parseMs(alert.ends);
    const last = Math.max(expires ?? -Infinity, ends ?? -Infinity);
    if (Number.isFinite(last) && last < now) continue;
    shapes.push({ id: alert.id, event: alert.event, severity: alert.severity, expires: expires ?? ends, geometry });
  }
  return shapes.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

const dayKey = (ms: number, { locale, timeZone }: LocaleOptions) =>
  new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).format(ms);

/** "Expires 4:15 PM" today, "Expires Fri 4:15 PM" on another day, "" when unknown. */
export function expiresLabel(expires: number | null, now: number, opts: LocaleOptions = {}): string {
  if (expires === null) return '';
  const time = formatClock(expires, opts);
  if (dayKey(expires, opts) === dayKey(now, opts)) return `Expires ${time}`;
  const weekday = new Intl.DateTimeFormat(opts.locale, { weekday: 'short', timeZone: opts.timeZone }).format(expires);
  return `Expires ${weekday} ${time}`;
}

/** The two lines of an alert popup. */
export function popupText(shape: AlertShape, now: number, opts: LocaleOptions = {}): { title: string; detail: string } {
  const parts = [shape.severity === 'Unknown' ? '' : shape.severity, expiresLabel(shape.expires, now, opts)];
  return { title: shape.event, detail: parts.filter(Boolean).join(' · ') };
}
