/**
 * Time helpers. Everything is zone-explicit: nothing in the data layer may depend on the machine's
 * time zone (no Date#getHours/getDate/new Date(y, m, d) — only UTC math and Intl with a timeZone).
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      // Unknown zone name (corrupt cache, typo): behave as UTC rather than throwing.
      f = tz === 'UTC' ? undefined : formatterFor('UTC');
      if (!f) throw new Error('Intl.DateTimeFormat is unavailable');
    }
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const out: ZonedParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) {
    switch (part.type) {
      case 'year':
        out.year = Number(part.value);
        break;
      case 'month':
        out.month = Number(part.value);
        break;
      case 'day':
        out.day = Number(part.value);
        break;
      case 'hour':
        out.hour = Number(part.value) % 24;
        break;
      case 'minute':
        out.minute = Number(part.value);
        break;
      case 'second':
        out.second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return out;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function localDateOf(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return ymd(p.year, p.month, p.day);
}

/** Wall-clock hour (0-23) of an instant in a zone. */
export function localHourOf(ms: number, tz: string): number {
  return zonedParts(ms, tz).hour;
}

/** Zone offset from UTC at an instant, in ms (positive east). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** The instant at which the wall clock in `tz` reads `date` hour:minute (earliest one when ambiguous). */
export function zonedWallToMs(date: string, hour: number, minute: number, tz: string): number {
  const [y, m, d] = splitDate(date);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (zone-free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = splitDate(a);
  const [by, bm, bd] = splitDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** Local midnight (start of the calendar day) as an instant. */
export function startOfLocalDay(date: string, tz: string): number {
  return zonedWallToMs(date, 0, 0, tz);
}

/** Length of a local calendar day in hours: 23, 24 or 25 around DST changes. */
export function hoursInLocalDay(date: string, tz: string): number {
  return Math.round((startOfLocalDay(addDays(date, 1), tz) - startOfLocalDay(date, tz)) / HOUR_MS);
}

export const floorToHour = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** 'YYYY-MM-DDTHH:mm:ssZ' (no milliseconds). */
export function isoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Epoch ms of an ISO-8601 string, or null. */
export function parseTime(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const DURATION_RE =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** ISO-8601 duration ("PT1H", "P1DT6H", "P7DT12H") in ms, or null if malformed. Years/months are approximated. */
export function parseIsoDuration(text: string): number | null {
  const m = DURATION_RE.exec(text.trim());
  if (!m) return null;
  const n = (i: number): number => (m[i] === undefined ? 0 : Number(m[i]));
  if (m.slice(1).every((g) => g === undefined)) return null; // bare "P" or "PT"
  const days = n(1) * 365 + n(2) * 30 + n(3) * 7 + n(4);
  return days * DAY_MS + n(5) * HOUR_MS + n(6) * MINUTE_MS + n(7) * 1000;
}

export interface TimeInterval {
  start: number;
  end: number;
}

/**
 * NWS "validTime": an ISO-8601 interval, "2026-10-08T17:00:00+00:00/PT1H" (start/duration) —
 * "start/end" is accepted too. Returns epoch-ms bounds, or null if unusable.
 */
export function parseValidTime(validTime: unknown): TimeInterval | null {
  if (typeof validTime !== 'string') return null;
  const slash = validTime.indexOf('/');
  if (slash < 0) return null;
  const start = Date.parse(validTime.slice(0, slash));
  if (!Number.isFinite(start)) return null;
  const tail = validTime.slice(slash + 1).trim();
  const end = tail.startsWith('P') ? (() => {
    const d = parseIsoDuration(tail);
    return d === null ? NaN : start + d;
  })() : Date.parse(tail);
  if (!Number.isFinite(end) || end <= start) return null;
  return { start, end };
}
