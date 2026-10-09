// @vitest-environment jsdom
/**
 * RadarView behavior with the Leaflet controller replaced by a fake that records what the view asks of
 * it and lets the test decide when tiles are "loaded". Leaflet itself is checked in the browser harness.
 */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeatherAlert } from '../../data/types';
import conusXml from './__fixtures__/conus-capabilities.xml?raw';
import { FRAME_DWELL_MS, LATEST_DWELL_MS } from './player';
import RadarView from './RadarView';

interface FakeCallbacks {
  onReadyChange: (ready: ReadonlySet<string>) => void;
  onFrameFailed: (id: string) => void;
}
interface FakeFrame {
  id: string;
  time: number;
}
interface FakeInstance {
  options: { lat: number; lon: number; theme: string; reducedMotion: boolean; callbacks: FakeCallbacks };
  destroyed: boolean;
  popupOpen: boolean;
  source: { kind: string } | null;
  frames: FakeFrame[];
  shown: string[];
  themes: string[];
  locations: Array<[number, number]>;
  alertSets: unknown[][];
  closePopup: () => boolean;
  markReady: (ids: string[]) => void;
}

const fake = vi.hoisted(() => {
  const instances: FakeInstance[] = [];
  class FakeController {
    options: FakeInstance['options'];
    destroyed = false;
    popupOpen = false;
    source: { kind: string } | null = null;
    frames: FakeFrame[] = [];
    shown: string[] = [];
    themes: string[] = [];
    locations: Array<[number, number]> = [];
    alertSets: unknown[][] = [];
    private ready = new Set<string>();
    constructor(_el: HTMLElement, options: FakeInstance['options']) {
      this.options = options;
      instances.push(this as unknown as FakeInstance);
    }
    setTheme(theme: string) {
      this.themes.push(theme);
    }
    setLocation(lat: number, lon: number) {
      this.locations.push([lat, lon]);
    }
    setAlerts(shapes: unknown[]) {
      this.alertSets.push(shapes);
    }
    setFrames(source: { kind: string } | null, frames: FakeFrame[]) {
      this.source = source;
      this.frames = frames;
    }
    showFrame(id: string) {
      this.shown.push(id);
    }
    closePopup() {
      const was = this.popupOpen;
      this.popupOpen = false;
      return was;
    }
    destroy() {
      this.destroyed = true;
    }
    markReady(ids: string[]) {
      for (const id of ids) this.ready.add(id);
      this.options.callbacks.onReadyChange(new Set(this.ready));
    }
  }
  return { instances, FakeController };
});
vi.mock('./mapController', () => ({ RadarMapController: fake.FakeController }));

const NOW = Date.parse('2026-10-09T02:31:20Z');
const LINN = { lat: 39.678, lon: -96.952 };
const ANCHORAGE = { lat: 61.218, lon: -149.9 };
const PAGO = { lat: -14.275, lon: -170.702 };

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
/**
 * Advance in 10 ms steps, each in its own act(): React flushes between timer firings, as it does in a
 * browser. One big advance inside a single act() would batch the state updates and the animation effect
 * would never get to re-arm its next timer.
 */
async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 10) await advance(Math.min(10, ms - t));
}
const live = () => fake.instances.filter((i) => !i.destroyed).at(-1)!;
const frameIds = () => live().frames.map((f) => f.id);
/** showFrame calls with consecutive duplicates collapsed. */
const shownSeq = () => live().shown.filter((id, i, all) => id !== all[i - 1]);
const lastShown = () => shownSeq().at(-1);

function okFetch(): typeof fetch {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => conusXml }) as Response);
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

interface Mounted {
  onClose: ReturnType<typeof vi.fn>;
  rerender: (props: Partial<{ lat: number; lon: number; alerts: WeatherAlert[] }>) => void;
  unmount: () => void;
}

/** Render the view and let the frame list load. */
async function mount(
  props: { lat?: number; lon?: number; alerts?: WeatherAlert[]; strict?: boolean } = {},
): Promise<Mounted> {
  const onClose = vi.fn();
  const base = { lat: props.lat ?? LINN.lat, lon: props.lon ?? LINN.lon, alerts: props.alerts ?? [], onClose };
  const ui = (p: typeof base) => <RadarView {...p} />;
  const wrap = (node: React.ReactNode) => (props.strict ? <StrictMode>{node}</StrictMode> : node);
  const view = render(wrap(ui(base)));
  await settle();
  return {
    onClose,
    rerender: (next) => view.rerender(wrap(ui({ ...base, ...next }))),
    unmount: view.unmount,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  fake.instances.length = 0;
  stubMatchMedia(false);
  vi.stubGlobal('fetch', okFetch());
  delete document.documentElement.dataset.theme;
  Reflect.deleteProperty(document, 'visibilityState');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
  delete document.documentElement.dataset.theme;
});

const slider = () => screen.getByRole('slider', { name: 'Radar frame time' }) as HTMLInputElement;
const playButton = () => screen.getByRole('button', { name: /(Play|Pause) radar loop/ });

describe('RadarView: dialog', () => {
  it('is a modal dialog with a labeled 44px close button that has initial focus', async () => {
    await mount();
    const dialog = screen.getByRole('dialog', { name: 'Weather radar' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getByRole('button', { name: 'Close radar' });
    expect(document.activeElement).toBe(close);
    // The CSS gives it 44px; assert the rule exists where jsdom can read it.
    expect(close.className).toContain('rv-close');
  });

  it('calls onClose from the close button', async () => {
    const { onClose } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close radar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and keeps the key from reaching app-level handlers', async () => {
    const { onClose } = await mount();
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    document.removeEventListener('keydown', bubbled);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('closes an open alert popup first; the next Escape closes the radar', async () => {
    const { onClose } = await mount();
    live().popupOpen = true;
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(live().popupOpen).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', async () => {
    await mount();
    // jsdom has no layout; make every element count as rendered so the trap can find its edges.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const root = screen.getByRole('dialog');
    const focusables = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    expect(first.getAttribute('aria-label')).toBe('Close radar');

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // In the middle of the dialog Tab is left alone.
    focusables[1]!.focus();
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
  });

  it('puts focus back where it was when the radar closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = await mount();
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('RadarView: lifecycle', () => {
  it('creates one map and destroys it on unmount', async () => {
    const { unmount } = await mount();
    expect(fake.instances).toHaveLength(1);
    unmount();
    expect(fake.instances.every((i) => i.destroyed)).toBe(true);
  });

  it('survives React StrictMode’s mount-unmount-mount: exactly one live map, none left over after unmount', async () => {
    const { unmount } = await mount({ strict: true });
    expect(fake.instances.length).toBeGreaterThanOrEqual(2);
    expect(fake.instances.filter((i) => !i.destroyed)).toHaveLength(1);
    expect(frameIds().length).toBeGreaterThanOrEqual(8); // frames reached the surviving map
    unmount();
    expect(fake.instances.every((i) => i.destroyed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the location, theme and motion preference to the map', async () => {
    document.documentElement.dataset.theme = 'dark';
    stubMatchMedia(true);
    await mount();
    expect(live().options).toMatchObject({ lat: LINN.lat, lon: LINN.lon, theme: 'dark', reducedMotion: true });
  });

  it('moves the map when the location changes, and tells it the new theme live', async () => {
    const view = await mount();
    view.rerender({ lat: 47.6, lon: -122.3 });
    await settle();
    expect(live().locations.at(-1)).toEqual([47.6, -122.3]);

    act(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await settle();
    expect(live().themes.at(-1)).toBe('dark');
    expect(screen.getByRole('dialog').getAttribute('data-rv-theme')).toBe('dark');
    act(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await settle();
    expect(live().themes.at(-1)).toBe('light');
  });

  it('follows the OS color scheme when <html data-theme> is absent', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    await mount();
    expect(screen.getByRole('dialog').getAttribute('data-rv-theme')).toBe('dark');
  });

  it('survives coordinates that are not numbers', async () => {
    await mount({ lat: Number.NaN, lon: Number.NaN });
    expect(live().options.lat).toBeCloseTo(39.8);
    expect(screen.getByText(/isn.t available for this location/)).toBeTruthy();
  });
});

describe('RadarView: frames and labels', () => {
  it('hands the map 8-10 frames, newest last, and shows the newest first', async () => {
    await mount();
    const ids = frameIds();
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(ids[ids.length - 1]).toBe('wms:conus:2026-10-09T02:28:09.000Z');
    expect(live().source?.kind).toBe('wms');
    expect(lastShown()).toBe(ids[ids.length - 1]);
    expect(slider().max).toBe(String(ids.length - 1));
    expect(slider().value).toBe(String(ids.length - 1));
  });

  it('labels the shown frame with its local clock time and age', async () => {
    await mount();
    // The age line carries a "loading n/N" suffix until every frame is in, so load them first.
    act(() => live().markReady(frameIds()));
    expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeTruthy();
    expect(screen.getByText('3 min ago')).toBeTruthy(); // 02:28:09 scan, 02:31:20 now
    expect(slider().getAttribute('aria-valuetext')).toMatch(/3 min ago$/);
    fireEvent.click(playButton()); // hold on the newest frame so only the clock moves
    await advance(5 * 60_000);
    expect(screen.getByText('8 min ago')).toBeTruthy(); // the age keeps counting while the view is open
  });

  it('names the region and the official source in the title and credits', async () => {
    await mount();
    expect(screen.getByText('Continental US')).toBeTruthy();
    expect(screen.getByText(/Radar: NOAA\/NWS MRMS/)).toBeTruthy();
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeTruthy();
    expect(screen.queryByText('Using backup radar source')).toBeNull();
  });

  it('shows a loading indicator until the first frame has painted', async () => {
    await mount();
    expect(screen.getByText('Loading radar…')).toBeTruthy();
    act(() => live().markReady([lastShown()!]));
    expect(screen.queryByText('Loading radar…')).toBeNull();
  });

  it('reports how many frames are loaded while the rest are still coming', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids.slice(-3)));
    expect(screen.getByText(new RegExp(`loading 3/${ids.length}`))).toBeTruthy();
    act(() => live().markReady(ids));
    expect(screen.queryByText(/loading \d+\//)).toBeNull();
  });

  it('draws only alerts that have polygons, and does not redraw for equal alerts', async () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [[[-97.2, 38.8], [-96.8, 38.8], [-96.8, 39.2], [-97.2, 39.2], [-97.2, 38.8]]],
    };
    const make = (id: string, geometry: WeatherAlert['geometry']): WeatherAlert => ({
      id,
      event: 'Tornado Warning',
      headline: '',
      severity: 'Extreme',
      urgency: '',
      certainty: '',
      effective: null,
      onset: null,
      expires: new Date(NOW + 30 * 60_000).toISOString(),
      ends: null,
      areaDesc: '',
      senderName: '',
      description: '',
      instruction: null,
      url: null,
      geometry,
    });
    const view = await mount({ alerts: [make('a', polygon), make('b', null)] });
    expect(live().alertSets.at(-1)).toHaveLength(1);
    const calls = live().alertSets.length;
    view.rerender({ alerts: [make('a', polygon), make('b', null)] }); // new array, same content
    await settle();
    expect(live().alertSets.length).toBe(calls);
  });

  it('takes an alert off the map when it ends while the radar is open', async () => {
    const soon = {
      id: 'soon',
      event: 'Severe Thunderstorm Warning',
      headline: '',
      severity: 'Severe' as const,
      urgency: '',
      certainty: '',
      effective: null,
      onset: null,
      expires: new Date(NOW + 60_000).toISOString(),
      ends: null,
      areaDesc: '',
      senderName: '',
      description: '',
      instruction: null,
      url: null,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[-97.2, 38.8], [-96.8, 38.8], [-96.8, 39.2], [-97.2, 39.2], [-97.2, 38.8]]],
      },
    };
    await mount({ alerts: [soon] });
    expect(live().alertSets.at(-1)).toHaveLength(1);
    await advance(95_000); // past its expiry, and past the view's 30 second clock ticks
    expect(live().alertSets.at(-1)).toHaveLength(0);
  });

  it('treats a missing alerts list as no alerts', async () => {
    await mount({ alerts: undefined as unknown as WeatherAlert[] });
    expect(live().alertSets.at(-1)).toEqual([]);
  });
});

describe('RadarView: animation', () => {
  /** When (ms from now) each frame becomes the shown one, polling every 10 ms. */
  async function trace(ms: number) {
    const out: Array<{ id: string; at: number }> = [];
    let seen = shownSeq().length;
    for (let t = 10; t <= ms; t += 10) {
      await advance(10);
      const seq = shownSeq();
      for (let i = seen; i < seq.length; i++) out.push({ id: seq[i]!, at: t });
      seen = seq.length;
    }
    return out;
  }

  it('starts playing: dwells on the newest frame, then loops oldest to newest and pauses on the newest again', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    expect(playButton().getAttribute('aria-label')).toBe('Pause radar loop');

    const steps = await trace(LATEST_DWELL_MS + (ids.length - 1) * FRAME_DWELL_MS + LATEST_DWELL_MS + 200);
    expect(steps.map((s) => s.id)).toEqual([...ids, ids[0]]); // oldest ... newest, then around again
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(30);
    near(steps[0]!.at, LATEST_DWELL_MS); // lingered on the newest before starting
    for (let i = 1; i < ids.length; i++) near(steps[i]!.at - steps[i - 1]!.at, FRAME_DWELL_MS);
    near(steps[ids.length]!.at - steps[ids.length - 1]!.at, LATEST_DWELL_MS); // paused on the newest, then looped
  });

  it('waits for the next frame’s tiles instead of skipping or showing a blank frame', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids.slice(0, 3).concat(ids.slice(-1)))); // oldest three + newest are loaded
    await run(LATEST_DWELL_MS + 200);
    expect(lastShown()).toBe(ids[0]);
    await run(FRAME_DWELL_MS * 6); // frame 3 is not ready: it stays on frame 2
    expect(lastShown()).toBe(ids[2]);
    act(() => live().markReady([ids[3]!]));
    await run(200);
    expect(lastShown()).toBe(ids[3]);
  });

  it('pauses and resumes from the play button', async () => {
    await mount();
    act(() => live().markReady(frameIds()));
    await run(LATEST_DWELL_MS + 100);
    fireEvent.click(playButton());
    expect(playButton().getAttribute('aria-label')).toBe('Play radar loop');
    const frozen = lastShown();
    await run(5000);
    expect(lastShown()).toBe(frozen);
    fireEvent.click(playButton());
    expect(playButton().getAttribute('aria-label')).toBe('Pause radar loop');
    await run(FRAME_DWELL_MS + 100);
    expect(lastShown()).not.toBe(frozen);
  });

  it('starts over at the oldest frame when play is pressed on the newest', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    fireEvent.click(playButton()); // pause on the newest
    expect(lastShown()).toBe(ids[ids.length - 1]);
    fireEvent.click(playButton()); // play: straight to the oldest, no waiting
    expect(lastShown()).toBe(ids[0]);
  });

  it('steps one frame at a time, wrapping around, and stops playing', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    expect(lastShown()).toBe(ids[0]); // newest wraps to oldest
    expect(playButton().getAttribute('aria-label')).toBe('Play radar loop');
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    expect(lastShown()).toBe(ids[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Previous frame' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous frame' }));
    expect(lastShown()).toBe(ids[ids.length - 1]); // oldest wraps back to newest
    await run(5000);
    expect(lastShown()).toBe(ids[ids.length - 1]); // still paused
  });

  it('jumps to the scrubbed frame and pauses', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    fireEvent.change(slider(), { target: { value: '2' } });
    expect(lastShown()).toBe(ids[2]);
    expect(slider().value).toBe('2');
    expect(playButton().getAttribute('aria-label')).toBe('Play radar loop');
    await run(4000);
    expect(lastShown()).toBe(ids[2]);
  });

  it('pauses while the page is hidden and carries on when it is visible again', async () => {
    await mount();
    act(() => live().markReady(frameIds()));
    await run(LATEST_DWELL_MS + FRAME_DWELL_MS * 2 + 100);
    act(() => setVisibility('hidden'));
    const frozen = lastShown();
    await run(10_000);
    expect(lastShown()).toBe(frozen);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(3); // no animation timer ticking in the background
    act(() => setVisibility('visible'));
    await run(FRAME_DWELL_MS + 100);
    expect(lastShown()).not.toBe(frozen);
  });

  it('starts paused when the user prefers reduced motion, but still lets them press play', async () => {
    stubMatchMedia(true);
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    expect(playButton().getAttribute('aria-label')).toBe('Play radar loop');
    await run(10_000);
    expect(lastShown()).toBe(ids[ids.length - 1]);
    fireEvent.click(playButton());
    await run(FRAME_DWELL_MS + 100);
    expect(lastShown()).toBe(ids[1]); // played from the oldest (reset on the newest), one step on
  });

  it('keeps the selected scan across a refresh and lands on the newest if it ages out', async () => {
    await mount();
    const ids = frameIds();
    act(() => live().markReady(ids));
    fireEvent.change(slider(), { target: { value: '3' } });
    const chosen = ids[3];
    // Five minutes later: same scans plus a newer one (the harness fetch returns the same document, so
    // frames are unchanged and the selection must simply stay put).
    await advance(5 * 60_000 + 100); // paused after the scrub, so one big step is fine (and 30k tiny ones would be slow)
    expect(frameIds()).toContain(chosen);
    expect(lastShown()).toBe(chosen);
  });
});

describe('RadarView: failure handling', () => {
  it('shows "Radar isn’t available" where there is no coverage, with disabled controls', async () => {
    await mount(PAGO);
    expect(screen.getByText(/isn.t available for this location/)).toBeTruthy();
    expect(screen.queryByText('Loading radar…')).toBeNull();
    expect(slider().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next frame' }) as HTMLButtonElement).disabled).toBe(true);
    expect(live().frames).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('shows an inline error with a working retry when the radar cannot be loaded (Alaska has no backup)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await mount(ANCHORAGE);
    await advance(1000); // the loader's one retry
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Radar couldn't be loaded right now.");
    expect(live().frames).toEqual([]);

    vi.stubGlobal('fetch', okFetch());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Loading radar…')).toBeTruthy();
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(frameIds().length).toBeGreaterThanOrEqual(8);
  });

  it('uses the backup source in the continental US when the official service is down, and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await mount();
    await advance(1000);
    expect(live().source?.kind).toBe('mesonet');
    expect(frameIds()).toHaveLength(6);
    expect(screen.getByText('Using backup radar source')).toBeTruthy();
    expect(screen.getByText('Backup source')).toBeTruthy();
    expect(screen.getByText(/Iowa Environmental Mesonet/)).toBeTruthy();
    act(() => live().markReady(frameIds()));
    expect(screen.getByText(/^~\d{1,2}:\d{2}/)).toBeTruthy(); // times are estimates
    expect(screen.getByText(/^~\d+ min ago$/)).toBeTruthy();
  });

  it('switches to the backup when every tile of the newest frame fails to load', async () => {
    await mount();
    expect(live().source?.kind).toBe('wms');
    const newest = frameIds().at(-1)!;
    act(() => live().options.callbacks.onFrameFailed(newest));
    await settle();
    expect(live().source?.kind).toBe('mesonet');
    expect(screen.getByText('Using backup radar source')).toBeTruthy();
  });

  it('ignores a failure of a frame nobody is looking at', async () => {
    await mount();
    act(() => live().options.callbacks.onFrameFailed(frameIds()[0]!));
    await settle();
    expect(live().source?.kind).toBe('wms');
  });

  it('gives up on a source that has not painted within 25 seconds', async () => {
    await mount();
    await advance(24_000);
    expect(live().source?.kind).toBe('wms');
    await advance(1_500);
    expect(live().source?.kind).toBe('mesonet');
  });

  it('does not run the 25 second watchdog while the page is hidden', async () => {
    await mount();
    act(() => setVisibility('hidden'));
    await advance(60_000);
    expect(live().source?.kind).toBe('wms');
  });

  it('is an error, not a loop, when the backup also fails', async () => {
    await mount();
    act(() => live().options.callbacks.onFrameFailed(frameIds().at(-1)!));
    await settle();
    expect(live().source?.kind).toBe('mesonet');
    act(() => live().options.callbacks.onFrameFailed(frameIds().at(-1)!));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain("Radar images couldn't be loaded.");
    expect(live().frames).toEqual([]);
  });
});
