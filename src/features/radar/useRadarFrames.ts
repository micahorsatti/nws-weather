/**
 * Loads and refreshes the list of radar frames for a location: official MRMS WMS first, the backup
 * mosaic when that fails, a refresh every 5 minutes while mounted, and a way for the view to report
 * that a source's images would not load.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMesonetFrames, sourceKey } from './frames';
import type { RadarFrame, RadarSource } from './frames';
import { loadRadarFrames } from './loader';
import { MINUTE_MS } from './radarTime';
import { hasBackupSource, pickRegion } from './region';
import type { RadarRegion } from './region';

/** How often the frame list is refreshed while the view is open. */
export const REFRESH_MS = 5 * MINUTE_MS;
/** After the WMS images fail to load, stay on the backup source this long before trying the WMS again. */
const BACKUP_HOLD_MS = 15 * MINUTE_MS;

export type FramesStatus = 'loading' | 'ready' | 'error' | 'no-coverage';

export interface RadarFramesState {
  status: FramesStatus;
  /** The radar region covering the location (null when none does). */
  region: RadarRegion | null;
  source: RadarSource | null;
  /** Oldest first, newest last. */
  frames: RadarFrame[];
  /** User-facing reason when status is 'error'. */
  message: string | null;
  /** Bumps whenever loading restarts (retry, new place, source switch) so the view can reset per-load state. */
  epoch: number;
  /** Start over after an error. */
  retry: () => void;
  /** The view calls this when the current source's images will not load. */
  reportFailure: () => void;
}

interface Core {
  status: 'loading' | 'ready' | 'error';
  source: RadarSource | null;
  frames: RadarFrame[];
  message: string | null;
  epoch: number;
}

const LOADING: Core = { status: 'loading', source: null, frames: [], message: null, epoch: 0 };

function sameFrames(a: readonly RadarFrame[], b: readonly RadarFrame[]): boolean {
  return a.length === b.length && a.every((f, i) => f.id === b[i]?.id);
}

function describeFailure(): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? "You're offline. Connect to the internet to load radar."
    : "Radar couldn't be loaded right now.";
}

export function useRadarFrames(lat: number, lon: number): RadarFramesState {
  const region = useMemo(() => pickRegion(lat, lon), [lat, lon]);
  const [core, setCore] = useState<Core>(LOADING);
  const [attempt, setAttempt] = useState(0);

  const coreRef = useRef(core);
  const backupUntil = useRef(0);
  const lastLoadedAt = useRef(0);
  useEffect(() => {
    coreRef.current = core;
  }, [core]);

  useEffect(() => {
    if (!region) return;
    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;
    const abort = new AbortController();

    // A new place or a retry starts from "loading"; the very first run (and StrictMode's second) is a no-op.
    setCore((prev) => (prev.status === 'loading' ? prev : { ...LOADING, epoch: prev.epoch + 1 }));

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await loadRadarFrames(region, { signal: abort.signal, preferBackup: Date.now() < backupUntil.current });
        if (cancelled) return;
        lastLoadedAt.current = Date.now();
        setCore((prev) => {
          const sameSource = prev.source !== null && sourceKey(prev.source) === sourceKey(result.source);
          if (prev.status === 'ready' && sameSource && sameFrames(prev.frames, result.frames)) return prev;
          return {
            status: 'ready',
            source: result.source,
            frames: result.frames,
            message: null,
            epoch: sameSource ? prev.epoch : prev.epoch + 1,
          };
        });
      } catch {
        if (cancelled) return;
        // A failed refresh keeps showing what we have; only a first load becomes an error.
        setCore((prev) => (prev.status === 'ready' ? prev : { ...prev, status: 'error', message: describeFailure(), frames: [], source: null }));
      } finally {
        inFlight = false;
      }
    };

    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), REFRESH_MS);
    };
    const tick = async () => {
      // An error stays put until the user retries (or the network returns); no flicker of auto-retries.
      if (coreRef.current.status !== 'error') await load();
      schedule();
    };
    // The first load always runs: on a retry the ref still holds the old error until the next render.
    void load().then(schedule);

    const refreshNow = () => {
      window.clearTimeout(timer);
      void load().finally(schedule);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadedAt.current >= REFRESH_MS) refreshNow();
    };
    const onOnline = () => {
      if (coreRef.current.status === 'error') refreshNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [region, attempt]);

  const retry = useCallback(() => {
    backupUntil.current = 0;
    setAttempt((n) => n + 1);
  }, []);

  const reportFailure = useCallback(() => {
    const cur = coreRef.current;
    if (cur.status !== 'ready' || !cur.source) return;
    const epoch = cur.epoch + 1;
    if (cur.source.kind === 'wms' && hasBackupSource(region)) {
      // The official images would not load: switch to the backup mosaic, once. If that fails too, it is an error.
      backupUntil.current = Date.now() + BACKUP_HOLD_MS;
      setCore((prev) =>
        prev.epoch === cur.epoch
          ? { status: 'ready', source: { kind: 'mesonet' }, frames: buildMesonetFrames(Date.now()), message: null, epoch }
          : prev,
      );
      return;
    }
    setCore((prev) =>
      prev.epoch === cur.epoch ? { status: 'error', source: null, frames: [], message: "Radar images couldn't be loaded.", epoch } : prev,
    );
  }, [region]);

  if (!region) {
    return { status: 'no-coverage', region: null, source: null, frames: [], message: null, epoch: 0, retry, reportFailure };
  }
  // Frames from another region must never be shown for even one render after the location moves.
  const stale = core.source?.kind === 'wms' && core.source.region.id !== region.id;
  return { ...(stale ? { ...LOADING, epoch: core.epoch } : core), region, retry, reportFailure };
}
