// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarFrame } from './frames';
import type { LoadedFrames } from './loader';
import { RADAR_REGIONS } from './region';
import { REFRESH_MS, useRadarFrames } from './useRadarFrames';

const loadRadarFrames = vi.hoisted(() => vi.fn());
vi.mock('./loader', () => ({ loadRadarFrames }));

const conus = RADAR_REGIONS.find((r) => r.id === 'conus')!;
const alaska = RADAR_REGIONS.find((r) => r.id === 'alaska')!;

// Linn, KS (CONUS), Anchorage (Alaska), Pago Pago (no coverage)
const LINN = [39.678, -96.952] as const;
const ANCHORAGE = [61.218, -149.9] as const;
const PAGO = [-14.275, -170.702] as const;

const frame = (id: string): RadarFrame => ({ id, time: Date.parse('2026-10-09T02:00:00Z'), approximate: false, param: id });
const official = (region: typeof conus, ...ids: string[]): LoadedFrames => ({ source: { kind: 'wms', region }, frames: ids.map(frame) });
const backup = (): LoadedFrames => ({ source: { kind: 'mesonet' }, frames: ['m1', 'm2'].map(frame) });

/** Let pending promise callbacks run (and React commit), without moving the clock. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const lastOptions = () => loadRadarFrames.mock.calls[loadRadarFrames.mock.calls.length - 1]?.[1] as { signal: AbortSignal; preferBackup: boolean };

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-09T02:30:00Z') });
  loadRadarFrames.mockReset();
});

afterEach(() => {
  // Vitest runs without globals here, so Testing Library's automatic cleanup is not registered: unmount
  // explicitly (before restoring real timers) or earlier tests' hooks keep their document listeners.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRadarFrames: loading', () => {
  it('starts loading, then reports the frames for the location’s region', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a', 'b', 'c'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    expect(result.current.status).toBe('loading');
    expect(result.current.frames).toEqual([]);
    expect(result.current.region?.id).toBe('conus');

    await settle();
    expect(result.current.status).toBe('ready');
    expect(result.current.frames.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.source).toEqual({ kind: 'wms', region: conus });
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
    expect(loadRadarFrames.mock.calls[0]?.[0]).toBe(conus);
    expect(lastOptions().preferBackup).toBe(false);
  });

  it('reports no coverage, and never calls the network, where there is no radar layer', async () => {
    const { result } = renderHook(() => useRadarFrames(...PAGO));
    await settle();
    expect(result.current.status).toBe('no-coverage');
    expect(result.current.region).toBeNull();
    expect(loadRadarFrames).not.toHaveBeenCalled();
  });

  it('treats non-finite coordinates as no coverage', async () => {
    const { result } = renderHook(() => useRadarFrames(Number.NaN, Number.NaN));
    await settle();
    expect(result.current.status).toBe('no-coverage');
    expect(loadRadarFrames).not.toHaveBeenCalled();
  });
});

describe('useRadarFrames: errors and retry', () => {
  it('shows an error when the first load fails, and retry starts over', async () => {
    loadRadarFrames.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(official(conus, 'a'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe("Radar couldn't be loaded right now.");
    expect(result.current.frames).toEqual([]);
    expect(result.current.source).toBeNull();
    const epochBefore = result.current.epoch;

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await settle();
    expect(result.current.status).toBe('ready');
    expect(result.current.frames.map((f) => f.id)).toEqual(['a']);
    expect(result.current.epoch).toBeGreaterThan(epochBefore);
    expect(loadRadarFrames).toHaveBeenCalledTimes(2);
  });

  it('says so when the device is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    loadRadarFrames.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    expect(result.current.message).toMatch(/offline/i);
  });

  it('does not keep retrying on its own while in the error state', async () => {
    loadRadarFrames.mockRejectedValue(new Error('down'));
    renderHook(() => useRadarFrames(...LINN));
    await settle();
    await advance(REFRESH_MS * 3);
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
  });

  it('tries again when the network comes back', async () => {
    loadRadarFrames.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(official(conus, 'a'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    expect(result.current.status).toBe('error');
    act(() => void window.dispatchEvent(new Event('online')));
    await settle();
    expect(result.current.status).toBe('ready');
  });
});

describe('useRadarFrames: refreshing while open', () => {
  it('refreshes every 5 minutes and swaps in new frames', async () => {
    expect(REFRESH_MS).toBe(5 * 60_000);
    loadRadarFrames.mockResolvedValueOnce(official(conus, 'a', 'b')).mockResolvedValueOnce(official(conus, 'a', 'c'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    expect(result.current.frames.map((f) => f.id)).toEqual(['a', 'b']);
    const epoch = result.current.epoch;

    await advance(REFRESH_MS - 1000);
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(loadRadarFrames).toHaveBeenCalledTimes(2);
    expect(result.current.frames.map((f) => f.id)).toEqual(['a', 'c']);
    expect(result.current.epoch).toBe(epoch); // same source: the view keeps its per-load state
  });

  it('keeps the same array when a refresh finds nothing new, so nothing re-renders downstream', async () => {
    loadRadarFrames.mockImplementation(async () => official(conus, 'a', 'b'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    const before = result.current.frames;
    await advance(REFRESH_MS);
    expect(loadRadarFrames).toHaveBeenCalledTimes(2);
    expect(result.current.frames).toBe(before);
  });

  it('keeps showing the current frames when a refresh fails', async () => {
    loadRadarFrames.mockResolvedValueOnce(official(conus, 'a', 'b')).mockRejectedValue(new Error('flaky'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    await advance(REFRESH_MS);
    expect(result.current.status).toBe('ready');
    expect(result.current.frames.map((f) => f.id)).toEqual(['a', 'b']);
    await advance(REFRESH_MS); // and it keeps trying
    expect(loadRadarFrames).toHaveBeenCalledTimes(3);
  });

  it('moves from the backup source to the official one when the official comes back', async () => {
    loadRadarFrames.mockResolvedValueOnce(backup()).mockResolvedValueOnce(official(conus, 'a', 'b'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    expect(result.current.source?.kind).toBe('mesonet');
    const epoch = result.current.epoch;
    await advance(REFRESH_MS);
    expect(result.current.source?.kind).toBe('wms');
    expect(result.current.epoch).toBeGreaterThan(epoch);
  });

  it('refreshes when the page becomes visible again after a long time away', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    renderHook(() => useRadarFrames(...LINN));
    await settle();
    vi.setSystemTime(Date.now() + 20 * 60_000); // the clock moved on, but no timer fired (a sleeping phone)
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await settle();
    expect(loadRadarFrames).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on becoming visible when the data is fresh', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    renderHook(() => useRadarFrames(...LINN));
    await settle();
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await settle();
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
  });
});

describe('useRadarFrames: images that will not load (reportFailure)', () => {
  it('switches the continental US to the backup source, and prefers it for the next 15 minutes', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a', 'b'));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    const epoch = result.current.epoch;

    act(() => result.current.reportFailure());
    expect(result.current.status).toBe('ready');
    expect(result.current.source).toEqual({ kind: 'mesonet' });
    expect(result.current.frames).toHaveLength(6);
    expect(result.current.epoch).toBeGreaterThan(epoch);

    loadRadarFrames.mockResolvedValue(backup());
    await advance(REFRESH_MS); // 5 minutes: still holding on the backup
    expect(lastOptions().preferBackup).toBe(true);
    await advance(REFRESH_MS * 2); // 15 minutes: try the official source again
    expect(lastOptions().preferBackup).toBe(false);
  });

  it('is an error when the backup source fails too', async () => {
    loadRadarFrames.mockResolvedValue(backup());
    const { result } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    act(() => result.current.reportFailure());
    expect(result.current.status).toBe('error');
    expect(result.current.message).toMatch(/couldn't be loaded/);
    expect(result.current.frames).toEqual([]);
  });

  it('is an error outside the continental US, where there is no backup', async () => {
    loadRadarFrames.mockResolvedValue(official(alaska, 'a'));
    const { result } = renderHook(() => useRadarFrames(...ANCHORAGE));
    await settle();
    expect(result.current.status).toBe('ready');
    act(() => result.current.reportFailure());
    expect(result.current.status).toBe('error');
  });

  it('ignores a failure report while still loading', async () => {
    loadRadarFrames.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRadarFrames(...LINN));
    act(() => result.current.reportFailure());
    expect(result.current.status).toBe('loading');
  });
});

describe('useRadarFrames: location and lifecycle', () => {
  it('never shows the old region’s frames for the new place, and loads the new region', async () => {
    loadRadarFrames.mockImplementation(async (region: typeof conus) => official(region, region.id === 'conus' ? 'c1' : 'ak1'));
    const { result, rerender } = renderHook(({ at }: { at: readonly [number, number] }) => useRadarFrames(...at), {
      initialProps: { at: LINN as readonly [number, number] },
    });
    await settle();
    expect(result.current.frames.map((f) => f.id)).toEqual(['c1']);
    const firstSignal = loadRadarFrames.mock.calls[0]?.[1].signal as AbortSignal;

    rerender({ at: ANCHORAGE });
    // The very render after the move must not carry the continental frames.
    expect(result.current.frames).toEqual([]);
    expect(result.current.region?.id).toBe('alaska');
    expect(firstSignal.aborted).toBe(true);
    await settle();
    expect(result.current.frames.map((f) => f.id)).toEqual(['ak1']);
    expect(loadRadarFrames.mock.calls[1]?.[0]).toBe(alaska);
  });

  it('does not reload when the location moves within the same region', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    const { rerender } = renderHook(({ at }: { at: readonly [number, number] }) => useRadarFrames(...at), {
      initialProps: { at: LINN as readonly [number, number] },
    });
    await settle();
    rerender({ at: [47.6, -122.3] });
    await settle();
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
  });

  it('goes to no-coverage when the location leaves every region', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    const { result, rerender } = renderHook(({ at }: { at: readonly [number, number] }) => useRadarFrames(...at), {
      initialProps: { at: LINN as readonly [number, number] },
    });
    await settle();
    rerender({ at: PAGO });
    expect(result.current.status).toBe('no-coverage');
    expect(result.current.frames).toEqual([]);
  });

  it('stops everything on unmount: aborts the request and cancels the refresh timer', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    const { unmount } = renderHook(() => useRadarFrames(...LINN));
    await settle();
    const signal = lastOptions().signal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    await advance(REFRESH_MS * 3);
    expect(loadRadarFrames).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives React StrictMode’s double-mounted effects without a duplicate refresh loop', async () => {
    loadRadarFrames.mockResolvedValue(official(conus, 'a'));
    const { StrictMode } = await import('react');
    renderHook(() => useRadarFrames(...LINN), { wrapper: StrictMode });
    await settle();
    const afterMount = loadRadarFrames.mock.calls.length;
    expect(afterMount).toBeLessThanOrEqual(2); // the discarded first mount may have started one load
    await advance(REFRESH_MS);
    // Exactly one live refresh loop: one more call, not two.
    expect(loadRadarFrames.mock.calls.length).toBe(afterMount + 1);
  });
});
