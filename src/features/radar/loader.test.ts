import { describe, expect, it, vi } from 'vitest';
import conusXml from './__fixtures__/conus-capabilities.xml?raw';
import { loadRadarFrames, loadWmsFrames } from './loader';
import { RADAR_REGIONS } from './region';

const conus = RADAR_REGIONS.find((r) => r.id === 'conus')!;
const alaska = RADAR_REGIONS.find((r) => r.id === 'alaska')!;
const NOW = Date.parse('2026-10-09T02:31:20Z');

type FetchImpl = typeof fetch;
type FetchCall = { url: string; signal: AbortSignal | undefined };

/** A fetch stub that serves scripted responses in order and records calls. Honors abort signals. */
function scriptedFetch(script: Array<'ok' | 'http503' | 'junk' | 'network' | 'hang'>) {
  const calls: FetchCall[] = [];
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    calls.push({ url, signal });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      if (step === 'ok') resolve(new Response(conusXml, { status: 200, headers: { 'Content-Type': 'text/xml' } }));
      else if (step === 'http503') resolve(new Response('Service Unavailable', { status: 503 }));
      else if (step === 'junk') resolve(new Response('<html><body>maintenance</body></html>', { status: 200 }));
      else if (step === 'network') reject(new TypeError('Failed to fetch'));
      // 'hang': never settles, until aborted
    });
  });
  return { impl: impl as unknown as FetchImpl, calls, spy: impl };
}

describe('loadWmsFrames', () => {
  it('requests the region’s capabilities and returns the frames', async () => {
    const f = scriptedFetch(['ok']);
    const frames = await loadWmsFrames(conus, { fetchImpl: f.impl });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe(
      'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.3.0&request=GetCapabilities',
    );
    expect(frames.length).toBeGreaterThanOrEqual(8);
    expect(frames[frames.length - 1]?.param).toBe('2026-10-09T02:28:09.000Z');
  });

  it('retries once after a failure', async () => {
    const f = scriptedFetch(['network', 'ok']);
    const frames = await loadWmsFrames(conus, { fetchImpl: f.impl, retryDelayMs: 0 });
    expect(f.calls).toHaveLength(2);
    expect(frames.length).toBeGreaterThan(0);
  });

  it.each([
    ['a network error', 'network'],
    ['an HTTP 503', 'http503'],
    ['a 200 that is not capabilities', 'junk'],
  ] as const)('gives up after two failed attempts (%s)', async (_label, step) => {
    const f = scriptedFetch([step]);
    await expect(loadWmsFrames(conus, { fetchImpl: f.impl, retryDelayMs: 0 })).rejects.toThrow();
    expect(f.calls).toHaveLength(2);
  });

  it('times out a request that never answers', async () => {
    const f = scriptedFetch(['hang']);
    const started = Date.now();
    await expect(loadWmsFrames(conus, { fetchImpl: f.impl, timeoutMs: 25, retryDelayMs: 0 })).rejects.toThrow();
    expect(f.calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('stops at once when aborted, without a retry', async () => {
    const f = scriptedFetch(['hang']);
    const ctl = new AbortController();
    const promise = loadWmsFrames(conus, { fetchImpl: f.impl, signal: ctl.signal, timeoutMs: 5000, retryDelayMs: 5000 });
    ctl.abort();
    await expect(promise).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
});

describe('loadRadarFrames', () => {
  it('uses the official WMS when it answers', async () => {
    const f = scriptedFetch(['ok']);
    const result = await loadRadarFrames(conus, { fetchImpl: f.impl, now: NOW });
    expect(result.source).toEqual({ kind: 'wms', region: conus });
    expect(result.frames[0]?.id).toMatch(/^wms:conus:/);
  });

  it('falls back to the Mesonet mosaic for the continental US when capabilities fail', async () => {
    const f = scriptedFetch(['network']);
    const result = await loadRadarFrames(conus, { fetchImpl: f.impl, retryDelayMs: 0, now: NOW });
    expect(result.source).toEqual({ kind: 'mesonet' });
    expect(result.frames).toHaveLength(6);
    expect(result.frames.every((fr) => fr.approximate)).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it('has no fallback outside the continental US: it rejects', async () => {
    const f = scriptedFetch(['http503']);
    await expect(loadRadarFrames(alaska, { fetchImpl: f.impl, retryDelayMs: 0, now: NOW })).rejects.toThrow(/503/);
  });

  it('skips the WMS entirely when told to prefer the backup (continental US)', async () => {
    const f = scriptedFetch(['ok']);
    const result = await loadRadarFrames(conus, { fetchImpl: f.impl, preferBackup: true, now: NOW });
    expect(result.source.kind).toBe('mesonet');
    expect(f.calls).toHaveLength(0);
  });

  it('ignores preferBackup where there is no backup', async () => {
    const f = scriptedFetch(['ok']);
    const result = await loadRadarFrames(alaska, { fetchImpl: f.impl, preferBackup: true });
    expect(result.source.kind).toBe('wms');
    expect(f.calls).toHaveLength(1);
  });

  it('does not fall back when the caller aborts', async () => {
    const f = scriptedFetch(['hang']);
    const ctl = new AbortController();
    const promise = loadRadarFrames(conus, { fetchImpl: f.impl, signal: ctl.signal, timeoutMs: 5000, retryDelayMs: 5000, now: NOW });
    ctl.abort();
    await expect(promise).rejects.toThrow();
  });
});
