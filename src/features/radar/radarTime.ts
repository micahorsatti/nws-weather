/**
 * Pure time logic for radar frames: parse a WMS time dimension, choose the frames to animate, and
 * format frame times. No DOM, no Leaflet.
 */

export const MINUTE_MS = 60_000;

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const DURATION_RE = new RegExp(
  `^P(?:${NUM}Y)?(?:${NUM}M)?(?:${NUM}W)?(?:${NUM}D)?(?:T(?:${NUM}H)?(?:${NUM}M)?(?:${NUM}S)?)?$`,
  'i',
);

/** ISO 8601 duration ("PT10M", "P1DT2H") to milliseconds. Years count 365 days and months 30. Null if invalid. */
export function parseIsoDuration(text: string): number | null {
  const s = text.trim();
  const m = DURATION_RE.exec(s);
  // "P" and "PT" alone match the pattern but carry no value.
  if (!m || /^PT?$/i.test(s) || /T$/i.test(s)) return null;
  const [y, mo, w, d, h, mi, sec] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  const days = (y ?? 0) * 365 + (mo ?? 0) * 30 + (w ?? 0) * 7 + (d ?? 0);
  return (((days * 24 + (h ?? 0)) * 60 + (mi ?? 0)) * 60 + (sec ?? 0)) * 1000;
}

/** One WMS time value to epoch ms. Values without a zone are UTC, as the WMS spec requires. */
export function parseTimestamp(text: string): number | null {
  let s = text.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null; // rejects "current", "now", garbage
  if (/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * Parse a WMS time dimension value into ascending, de-duplicated epoch ms.
 * Accepts comma lists ("t1,t2,t3"), intervals ("start/end/PT2M") and any mix of the two.
 * A huge interval is expanded from its start but only the most recent `maxPerInterval` entries are kept.
 */
export function parseTimeDimension(text: string, options: { maxPerInterval?: number } = {}): number[] {
  const maxPerInterval = options.maxPerInterval ?? 1000;
  const out = new Set<number>();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const pieces = part.split('/').map((p) => p.trim());
    if (pieces.length === 1) {
      const t = parseTimestamp(pieces[0] ?? '');
      if (t !== null) out.add(t);
      continue;
    }
    const start = parseTimestamp(pieces[0] ?? '');
    const end = parseTimestamp(pieces[1] ?? '');
    if (start === null || end === null) continue;
    const period = pieces[2] ? parseIsoDuration(pieces[2]) : null;
    if (!period || period <= 0 || end < start) {
      // No usable period: keep the two endpoints rather than inventing entries.
      out.add(start);
      if (end >= start) out.add(end);
      continue;
    }
    const count = Math.floor((end - start) / period) + 1;
    for (let i = Math.max(0, count - maxPerInterval); i < count; i++) out.add(start + i * period);
  }
  return [...out].sort((a, b) => a - b);
}

export interface FramePlan {
  /** Spacing of the animation frames, in minutes. */
  stepMin: number;
  /** How far back from the newest scan the loop reaches, in minutes. */
  historyMin: number;
  /** A grid frame must be at least this much older than the newest scan (avoids near-duplicates). */
  minGapMin: number;
  /** How far a real scan may sit from its 10-minute grid line before the line is skipped, in minutes. */
  toleranceMin: number;
}

/** About 85 minutes at 10-minute spacing, plus the newest scan: 9 or 10 frames. */
export const DEFAULT_FRAME_PLAN: FramePlan = { stepMin: 10, historyMin: 85, minGapMin: 4, toleranceMin: 4 };

/** Index of the value in a sorted array closest to `target`. */
function nearestIndex(sorted: readonly number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((sorted[lo - 1] as number) - target) <= Math.abs((sorted[lo] as number) - target)) return lo - 1;
  return lo;
}

/**
 * Choose the radar scans to animate: the newest scan plus the scan nearest to every 10-minute clock line
 * (:00, :10, :20 ...) in the preceding ~85 minutes. Anchoring to clock lines instead of "newest minus
 * k*10" keeps the older frames identical from one refresh to the next, so the layers that are already
 * loaded can be reused and only the newest frame needs fetching.
 *
 * `times` may be unsorted. The newest advertised scan is always the last frame: the choice depends only
 * on the server's list, never on the device clock (a radar time dimension has no future entries, and a
 * wrong device clock must not make us show stale scans as "latest"). Returns ascending epoch ms, newest
 * last; [] when there are no times.
 */
export function pickFrameTimes(times: readonly number[], plan: Partial<FramePlan> = {}): number[] {
  const { stepMin, historyMin, minGapMin, toleranceMin } = { ...DEFAULT_FRAME_PLAN, ...plan };
  const sorted = [...new Set(times)].filter(Number.isFinite).sort((a, b) => a - b);
  const latest = sorted[sorted.length - 1];
  if (latest === undefined) return [];

  const step = stepMin * MINUTE_MS;
  const tolerance = toleranceMin * MINUTE_MS;
  const picked = new Set<number>([latest]);
  const lastLine = latest - minGapMin * MINUTE_MS;
  for (let line = Math.ceil((latest - historyMin * MINUTE_MS) / step) * step; line <= lastLine; line += step) {
    const t = sorted[nearestIndex(sorted, line)] as number;
    if (Math.abs(t - line) <= tolerance && t < latest) picked.add(t);
  }
  return [...picked].sort((a, b) => a - b);
}

/** Whole minutes between a frame and now, never negative (a slow device clock must not print "-1 min"). */
export function minutesAgo(frameMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - frameMs) / MINUTE_MS));
}

/** "just now", "7 min ago", "~12 min ago" (approximate times from the backup source). */
export function formatAge(minutes: number, approximate = false): string {
  if (minutes < 1) return 'just now';
  return `${approximate ? '~' : ''}${minutes} min ago`;
}

export interface LocaleOptions {
  /** BCP 47 tag; defaults to the device locale. */
  locale?: string;
  /** IANA zone; defaults to the device zone. Tests pass it to be deterministic. */
  timeZone?: string;
}

/** Short local clock time, e.g. "9:28 PM". */
export function formatClock(ms: number, { locale, timeZone }: LocaleOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(ms);
}
