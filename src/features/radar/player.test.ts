import { describe, expect, it } from 'vitest';
import { FRAME_DWELL_MS, LATEST_DWELL_MS, WAIT_POLL_MS, clampIndex, dwellFor, nextIndex, prevIndex } from './player';

describe('animation loop rules', () => {
  it('advances through the frames and wraps from the newest back to the oldest', () => {
    expect(nextIndex(0, 9)).toBe(1);
    expect(nextIndex(7, 9)).toBe(8);
    expect(nextIndex(8, 9)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
  });

  it('steps backward and wraps from the oldest to the newest', () => {
    expect(prevIndex(5, 9)).toBe(4);
    expect(prevIndex(0, 9)).toBe(8);
  });

  it('lingers on the newest frame before looping', () => {
    expect(dwellFor(8, 9)).toBe(LATEST_DWELL_MS);
    expect(dwellFor(0, 9)).toBe(FRAME_DWELL_MS);
    expect(dwellFor(7, 9)).toBe(FRAME_DWELL_MS);
    expect(LATEST_DWELL_MS).toBeGreaterThan(FRAME_DWELL_MS * 2);
  });

  it('keeps frames on screen long enough to read but short enough to feel like motion', () => {
    expect(FRAME_DWELL_MS).toBeGreaterThanOrEqual(300);
    expect(FRAME_DWELL_MS).toBeLessThanOrEqual(900);
    expect(WAIT_POLL_MS).toBeLessThan(FRAME_DWELL_MS);
  });

  it('is safe with no frames', () => {
    expect(nextIndex(0, 0)).toBe(0);
    expect(prevIndex(0, 0)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('clamps a selection to the frame list', () => {
    expect(clampIndex(-2, 9)).toBe(0);
    expect(clampIndex(4, 9)).toBe(4);
    expect(clampIndex(12, 9)).toBe(8);
  });
});
