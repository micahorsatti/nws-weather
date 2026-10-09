/**
 * Finds out which radar frames exist: asks the region's WMS for its time dimension, and falls back to the
 * Iowa Mesonet mosaic (continental US only) when that fails. The only module here that touches the network.
 */
import { parseCapabilities } from './capabilities';
import { buildMesonetFrames, buildWmsFrames } from './frames';
import type { RadarFrame, RadarSource } from './frames';
import { capabilitiesUrl, hasBackupSource } from './region';
import type { RadarRegion } from './region';

export interface LoaderOptions {
  signal?: AbortSignal;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Pause before the single retry of a failed capabilities request. */
  retryDelayMs?: number;
  /** Clock override for tests (only the backup source's estimated times use the clock). */
  now?: number;
}

export interface LoadedFrames {
  source: RadarSource;
  frames: RadarFrame[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 700;

async function fetchText(url: string, { signal, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: LoaderOptions): Promise<string> {
  const ctl = new AbortController();
  const forwardAbort = () => ctl.abort(signal?.reason);
  if (signal?.aborted) ctl.abort(signal.reason);
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(new Error('Request timed out')), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Resolves after `ms`, or immediately when the signal aborts; never leaves a timer or listener behind. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** One capabilities round trip: the frames for a region, or a thrown Error. */
async function requestWmsFrames(region: RadarRegion, options: LoaderOptions): Promise<RadarFrame[]> {
  const xml = await fetchText(capabilitiesUrl(region), options);
  const caps = parseCapabilities(xml, region.layer);
  if (!caps) throw new Error('Radar service returned no time dimension');
  const frames = buildWmsFrames(region, caps.times);
  if (frames.length === 0) throw new Error('Radar service listed no scans');
  return frames;
}

/** Frames for a WMS region. Retries once after a short pause; throws if both attempts fail or the signal aborts. */
export async function loadWmsFrames(region: RadarRegion, options: LoaderOptions = {}): Promise<RadarFrame[]> {
  try {
    return await requestWmsFrames(region, options);
  } catch (first) {
    if (options.signal?.aborted) throw first;
    await sleep(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, options.signal);
    if (options.signal?.aborted) throw first;
    return requestWmsFrames(region, options);
  }
}

/**
 * Load frames for a region: the official MRMS WMS first, then (continental US only) the backup mosaic.
 * `preferBackup` skips straight to the backup, for when the WMS answered but its images would not load.
 * Throws when neither source is available or the signal aborts.
 */
export async function loadRadarFrames(
  region: RadarRegion,
  options: LoaderOptions & { preferBackup?: boolean } = {},
): Promise<LoadedFrames> {
  let failure: unknown = new Error('Radar is unavailable');
  if (!options.preferBackup || !hasBackupSource(region)) {
    try {
      return { source: { kind: 'wms', region }, frames: await loadWmsFrames(region, options) };
    } catch (err) {
      if (options.signal?.aborted) throw err;
      failure = err;
    }
  }
  if (hasBackupSource(region)) {
    return { source: { kind: 'mesonet' }, frames: buildMesonetFrames(options.now ?? Date.now()) };
  }
  throw failure;
}
