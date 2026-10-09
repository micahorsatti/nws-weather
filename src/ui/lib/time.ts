/**
 * Time helpers. Every time shown to the user is rendered in the *forecast location's* zone
 * (PointInfo.timeZone), never the device's, and always with en-US conventions (this is a US-only product).
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const cache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${tz}|${JSON.stringify(options)}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options });
    cache.set(id, f);
  }
  return f;
}

/** A usable IANA zone: the given one if valid, otherwise the device zone, otherwise UTC. */
export function resolveZone(tz: string | null | undefined): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** ISO string to epoch ms, or null when missing or unparseable. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** "8:42 PM" */
export function formatClock(ms: number, tz: string): string {
  return dtf(tz, { hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** "9 PM" */
export function formatHour(ms: number, tz: string): string {
  return dtf(tz, { hour: 'numeric' }).format(ms);
}

/** "Thu" or "Thursday" */
export function formatWeekday(ms: number, tz: string, style: 'short' | 'long' = 'short'): string {
  return dtf(tz, { weekday: style }).format(ms);
}

/** "Oct 9" */
export function formatMonthDay(ms: number, tz: string): string {
  return dtf(tz, { month: 'short', day: 'numeric' }).format(ms);
}

/** "Thu 8:42 PM" */
export function formatDayClock(ms: number, tz: string): string {
  return `${formatWeekday(ms, tz)} ${formatClock(ms, tz)}`;
}

/** "Thu, Oct 9, 8:42 PM" */
export function formatFull(ms: number, tz: string): string {
  return dtf(tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** "8:42 PM" today, "Thu 8:42 PM" on another day (relative to `now`, both in the location's zone). */
export function formatClockMaybeDay(ms: number, now: number, tz: string): string {
  return localDateKey(ms, tz) === localDateKey(now, tz) ? formatClock(ms, tz) : formatDayClock(ms, tz);
}

function parts(ms: number, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of dtf(tz, {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms)) {
    out[p.type] = p.value;
  }
  return out;
}

/** 0–23 in the location's zone. */
export function localHour(ms: number, tz: string): number {
  return Number(parts(ms, tz).hour) % 24;
}

/** "YYYY-MM-DD" in the location's zone. */
export function localDateKey(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Offset (ms) of `tz` from UTC at the instant `ms`: local wall time minus UTC. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function dateKeyParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** Epoch ms of a wall-clock time on a local date in `tz`. */
export function zonedToMs(dateKey: string, hour: number, minute: number, tz: string): number {
  const { y, m, d } = dateKeyParts(dateKey);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const off1 = tzOffsetMs(guess, tz);
  const ms = guess - off1;
  const off2 = tzOffsetMs(ms, tz);
  return off2 === off1 ? ms : guess - off2;
}

/** Calendar-date arithmetic on "YYYY-MM-DD" keys (no time zone involved). */
export function addDaysToKey(key: string, days: number): string {
  const { y, m, d } = dateKeyParts(key);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday name of a "YYYY-MM-DD" date. */
export function weekdayOfKey(key: string, style: 'short' | 'long' = 'short'): string {
  const { y, m, d } = dateKeyParts(key);
  return dtf('UTC', { weekday: style }).format(Date.UTC(y, m - 1, d, 12));
}

/** "Oct 9" for a "YYYY-MM-DD" date. */
export function monthDayOfKey(key: string): string {
  const { y, m, d } = dateKeyParts(key);
  return dtf('UTC', { month: 'short', day: 'numeric' }).format(Date.UTC(y, m - 1, d, 12));
}

/** ISO-8601 with the zone's numeric offset, e.g. "2026-10-08T21:00:00-05:00". */
export function isoInZone(ms: number, tz: string): string {
  const p = parts(ms, tz);
  const off = tzOffsetMs(ms, tz);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off) / 60_000;
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function formatAgo(thenMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

/** "14 h 19 m", "45 m", "3 h". */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} m`;
  return r === 0 ? `${h} h` : `${h} h ${r} m`;
}
