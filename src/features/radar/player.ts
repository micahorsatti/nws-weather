/** Pure animation-loop rules. The React timer lives in RadarView; these decide what happens at each tick. */

/** How long each frame stays up while playing. */
export const FRAME_DWELL_MS = 550;
/** The loop lingers on the newest frame before starting over. */
export const LATEST_DWELL_MS = 1600;
/** How soon to look again when the next frame's tiles are still loading. */
export const WAIT_POLL_MS = 120;

/** The frame after `index`, wrapping from the newest back to the oldest. */
export function nextIndex(index: number, count: number): number {
  return count <= 0 ? 0 : (index + 1) % count;
}

/** The frame before `index`, wrapping from the oldest to the newest. */
export function prevIndex(index: number, count: number): number {
  return count <= 0 ? 0 : (index - 1 + count) % count;
}

/** How long to hold `index` before advancing. */
export function dwellFor(index: number, count: number): number {
  return index === count - 1 ? LATEST_DWELL_MS : FRAME_DWELL_MS;
}

/** Keep a selection valid when the frame list changes length. */
export function clampIndex(index: number, count: number): number {
  return count <= 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
}
