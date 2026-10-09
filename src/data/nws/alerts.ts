/** Active NWS alerts (watches, warnings, advisories) for a point. */
import { GEO_JSON, fetchJson } from '../http';
import { parseTime } from '../time';
import type { AlertGeometry, AlertSeverity, WeatherAlert } from '../types';
import { arr, obj, str } from '../util';
import { NWS_BASE } from './points';

const SEVERITY_RANK: Record<AlertSeverity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

function severityOf(v: unknown): AlertSeverity {
  return typeof v === 'string' && v in SEVERITY_RANK ? (v as AlertSeverity) : 'Unknown';
}

function parseGeometry(raw: unknown): AlertGeometry | null {
  const g = obj(raw);
  if (!g || !Array.isArray(g.coordinates)) return null;
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates as number[][][] };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates as number[][][][] };
  return null;
}

function parseAlert(raw: unknown): WeatherAlert | null {
  const f = obj(raw);
  const p = obj(f?.properties);
  if (!f || !p) return null;
  const event = str(p.event);
  const id = str(p.id) ?? str(f.id) ?? str(p['@id']);
  if (!event || !id) return null;
  return {
    id,
    event,
    headline: str(p.headline) ?? event,
    severity: severityOf(p.severity),
    urgency: str(p.urgency) ?? 'Unknown',
    certainty: str(p.certainty) ?? 'Unknown',
    effective: str(p.effective),
    onset: str(p.onset),
    expires: str(p.expires),
    ends: str(p.ends),
    areaDesc: str(p.areaDesc) ?? '',
    senderName: str(p.senderName) ?? '',
    description: typeof p.description === 'string' ? p.description.trim() : '',
    instruction: str(p.instruction),
    url: str(p['@id']) ?? str(f.id),
    geometry: parseGeometry(f.geometry),
  };
}

/** Earliest relevant start: onset, else effective. */
function startMs(a: WeatherAlert): number {
  return parseTime(a.onset) ?? parseTime(a.effective) ?? Number.MAX_SAFE_INTEGER;
}

/** Most severe first, then earliest onset. */
export function sortAlerts(alerts: WeatherAlert[]): WeatherAlert[] {
  return [...alerts].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || startMs(a) - startMs(b));
}

/**
 * Parse an /alerts/active response. Alerts that already ended/expired (the feed can lag) are dropped
 * when `now` is given.
 */
export function parseAlerts(json: unknown, now?: number): WeatherAlert[] {
  const alerts = arr(obj(json)?.features)
    .map(parseAlert)
    .filter((a): a is WeatherAlert => a !== null)
    .filter((a) => {
      if (now === undefined) return true;
      const end = Math.max(parseTime(a.expires) ?? -Infinity, parseTime(a.ends) ?? -Infinity);
      return end === -Infinity || end > now;
    });
  return sortAlerts(alerts);
}

export async function loadAlerts(lat: number, lon: number, now: number, signal?: AbortSignal): Promise<WeatherAlert[]> {
  const url = `${NWS_BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  return parseAlerts(await fetchJson<unknown>(url, { signal, accept: GEO_JSON }), now);
}
