/**
 * Full-screen weather radar overlay: NWS MRMS base reflectivity animated over a gray basemap, with the
 * location marker and active alert polygons. The UI lazy-loads this module and renders it on top of the app.
 *
 *   const RadarView = lazy(() => import('../features/radar/RadarView'));
 *   <RadarView lat={...} lon={...} alerts={bundle.alerts} onClose={...} />
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import 'leaflet/dist/leaflet.css';
import './radar.css';
import type { WeatherAlert } from '../../data/types';
import { alertShapes } from './alerts';
import { MAP_BACKGROUND } from './basemap';
import { useDocumentVisible, useLatestRef, useMediaQuery, useNow, useTheme } from './hooks';
import { RadarMapController } from './mapController';
import { dwellFor, nextIndex, prevIndex, WAIT_POLL_MS } from './player';
import { formatAge, formatClock, minutesAgo } from './radarTime';
import { Attribution, CloseIcon, Controls, Legend } from './RadarParts';
import { useRadarFrames } from './useRadarFrames';

export interface RadarViewProps {
  lat: number;
  lon: number;
  alerts: WeatherAlert[];
  onClose: () => void;
}

const NO_READY: ReadonlySet<string> = new Set();
/** If the first frame has not painted this long after the frames were chosen, treat the source as failed. */
const PAINT_TIMEOUT_MS = 25_000;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside the dialog. */
function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (!root.contains(active)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function RadarView({ lat, lon, alerts, onClose }: RadarViewProps) {
  const theme = useTheme();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const visible = useDocumentVisible();
  const now = useNow(30_000);

  const rootRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<RadarMapController | null>(null);
  const [controller, setController] = useState<RadarMapController | null>(null);

  // Invalid coordinates must not crash Leaflet; fall back to the middle of the continental US.
  const validCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const mapLat = validCoords ? Math.max(-85, Math.min(85, lat)) : 39.8;
  const mapLon = validCoords ? Math.max(-180, Math.min(180, lon)) : -98.6;

  const radar = useRadarFrames(validCoords ? lat : NaN, validCoords ? lon : NaN);
  const { status, frames, source, region, epoch, reportFailure, retry } = radar;

  const [ready, setReady] = useState<ReadonlySet<string>>(NO_READY);
  const readyRef = useRef<ReadonlySet<string>>(NO_READY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(() => !reducedMotion);
  const [paintedEpoch, setPaintedEpoch] = useState(-1);

  // The selection follows a scan id, so a refresh that keeps the scan keeps the selection, and one that
  // drops it (it aged out, or the newest scan replaced it) lands on the newest frame.
  const found = selectedId === null ? -1 : frames.findIndex((f) => f.id === selectedId);
  const index = frames.length === 0 ? 0 : found >= 0 ? found : frames.length - 1;
  const current = frames[index];
  const newest = frames[frames.length - 1];

  const latest = useLatestRef({
    lat: mapLat,
    lon: mapLon,
    theme,
    reducedMotion,
    onClose,
    reportFailure,
    currentId: current?.id,
    newestId: newest?.id,
  });

  // --- the map: created once per mount (twice under StrictMode in dev) and torn down completely ---------
  useEffect(() => {
    const el = mapElRef.current;
    if (!el) return;
    const init = latest.current;
    const c = new RadarMapController(el, {
      lat: init.lat,
      lon: init.lon,
      theme: init.theme,
      reducedMotion: init.reducedMotion,
      callbacks: {
        onReadyChange: (set) => {
          readyRef.current = set;
          setReady(set);
        },
        onFrameFailed: (id) => {
          const cur = latest.current;
          if (id === cur.newestId || id === cur.currentId) cur.reportFailure();
        },
      },
    });
    controllerRef.current = c;
    setController(c);
    return () => {
      controllerRef.current = null;
      readyRef.current = NO_READY;
      setController(null);
      setReady(NO_READY);
      c.destroy();
    };
  }, [latest]);

  // Frames first, so that when the location moves to another region the old region's layers are gone
  // before the map moves (otherwise they would fetch a screenful of tiles for the new view).
  useEffect(() => {
    controller?.setFrames(source, frames);
  }, [controller, source, frames]);

  // Declared after setFrames so a new frame list is on the map before it is asked to show one of them.
  const currentId = current?.id;
  useEffect(() => {
    if (controller && currentId) controller.showFrame(currentId);
  }, [controller, currentId, frames]);

  useEffect(() => {
    controller?.setTheme(theme);
  }, [controller, theme]);

  useEffect(() => {
    controller?.setLocation(mapLat, mapLon);
  }, [controller, mapLat, mapLon]);

  // Alert polygons. Re-filtered as the clock ticks so an alert that ends while the radar is open goes away,
  // and keyed by content so a parent re-render with equal alerts does not redraw them and close a popup
  // the user has open.
  const shapes = useMemo(() => alertShapes(Array.isArray(alerts) ? alerts : [], now), [alerts, now]);
  const shapesKey = shapes.map((s) => `${s.id}|${s.severity}|${s.expires}`).join(';');
  const stableShapes = useMemo(() => shapes, [shapesKey]); // deliberately keyed by content, not identity
  useEffect(() => {
    controller?.setAlerts(stableShapes);
  }, [controller, stableShapes]);

  // --- loading indicator and failure watchdog -----------------------------------------------------------
  const currentReady = current ? ready.has(current.id) : false;
  useEffect(() => {
    if (currentReady) setPaintedEpoch(epoch);
  }, [currentReady, epoch]);
  const painted = paintedEpoch === epoch;

  useEffect(() => {
    if (status !== 'ready' || painted || !visible) return;
    const id = window.setTimeout(reportFailure, PAINT_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [status, painted, visible, epoch, reportFailure]);

  // --- playback ----------------------------------------------------------------------------------------
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  const running = playing && visible && status === 'ready' && frames.length > 1;
  useEffect(() => {
    if (!running) return;
    let id: number;
    const advance = () => {
      const target = frames[nextIndex(index, frames.length)];
      if (target && readyRef.current.has(target.id)) setSelectedId(target.id);
      else id = window.setTimeout(advance, WAIT_POLL_MS); // its tiles are still loading: look again shortly
    };
    id = window.setTimeout(advance, dwellFor(index, frames.length));
    return () => window.clearTimeout(id);
  }, [running, index, frames]);

  const select = (i: number) => {
    const frame = frames[i];
    if (frame) setSelectedId(frame.id);
  };
  const onPlayPause = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index === frames.length - 1) select(0); // from the newest frame, start over at once
    setPlaying(true);
  };
  const onStep = (delta: -1 | 1) => {
    setPlaying(false);
    select(delta < 0 ? prevIndex(index, frames.length) : nextIndex(index, frames.length));
  };
  const onScrub = (i: number) => {
    setPlaying(false);
    select(i);
  };

  // --- dialog behavior: initial focus, Escape, Tab trap, focus restore ---------------------------------
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // this dialog is on top: keep app-level Escape handlers from also firing
        // An open alert popup closes first; the next Escape closes the radar.
        if (!controllerRef.current?.closePopup()) latest.current.onClose();
      } else if (event.key === 'Tab') {
        trapTab(event, rootRef.current);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [latest]);

  // --- labels ------------------------------------------------------------------------------------------
  const loadedCount = frames.reduce((n, f) => n + (ready.has(f.id) ? 1 : 0), 0);
  const timeLabel = current ? `${current.approximate ? '~' : ''}${formatClock(current.time)}` : status === 'loading' ? 'Loading…' : '—';
  const ageLabel = current ? formatAge(minutesAgo(current.time, now), current.approximate) : '';
  const regionLabel = source?.kind === 'mesonet' ? 'Backup source' : (source?.kind === 'wms' ? source.region : region)?.label ?? '';
  const usingBackup = source?.kind === 'mesonet';
  const showLoading = status === 'loading' || (status === 'ready' && !painted);

  return (
    <div
      ref={rootRef}
      className="rv-root"
      role="dialog"
      aria-modal="true"
      aria-label="Weather radar"
      data-rv-theme={theme}
      style={{ '--rv-map-bg': MAP_BACKGROUND[theme] } as CSSProperties}
    >
      <div className="rv-stage">
        <div ref={mapElRef} className="rv-map" />

        <header className="rv-top">
          <button ref={closeRef} type="button" className="rv-close" aria-label="Close radar" onClick={() => onClose()}>
            <CloseIcon />
          </button>
          <div className="rv-title">
            <span className="rv-title-main">Radar</span>
            {regionLabel && <span className="rv-title-sub">{regionLabel}</span>}
          </div>
        </header>

        <div className="rv-notes" role="status">
          {showLoading && (
            <span className="rv-chip">
              <span className="rv-spinner" aria-hidden="true" />
              Loading radar…
            </span>
          )}
          {usingBackup && <span className="rv-chip">Using backup radar source</span>}
        </div>

        {status === 'error' && (
          <div className="rv-center">
            <div className="rv-card" role="alert">
              <p className="rv-card-title">{radar.message ?? "Radar couldn't be loaded."}</p>
              <button type="button" className="rv-action" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        )}
        {status === 'no-coverage' && (
          <div className="rv-center">
            <div className="rv-card" role="status">
              <p className="rv-card-title">Radar isn&rsquo;t available for this location.</p>
              <p className="rv-card-note">NWS radar covers the 50 states, Puerto Rico, the Virgin Islands and Guam.</p>
            </div>
          </div>
        )}

        <div className="rv-bottom">
          <Legend />
          <Attribution kind={usingBackup ? 'mesonet' : 'wms'} />
        </div>
      </div>

      <Controls
        count={frames.length}
        index={index}
        playing={playing}
        timeLabel={timeLabel}
        ageLabel={ageLabel}
        loadedCount={loadedCount}
        onPlayPause={onPlayPause}
        onStep={onStep}
        onScrub={onScrub}
      />
    </div>
  );
}
