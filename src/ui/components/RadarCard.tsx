import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WeatherAlert } from '../../data/types';
import { usePageLock, useRestoreFocus } from '../useModal';
import { IconChevronRight, IconClose } from './Icons';

// The radar view is a heavy chunk (Leaflet + map code): load it only when the user opens radar.
const RadarView = lazy(() => import('../../features/radar/RadarView'));

/** Decorative radar sweep with reflectivity blobs (colors follow the usual radar convention, not the theme). */
function RadarArt() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false" className="radar-art">
      <rect width="64" height="64" rx="16" className="radar-art__bg" />
      <circle cx="32" cy="32" r="22" className="radar-art__ring" />
      <circle cx="32" cy="32" r="12" className="radar-art__ring" />
      <path d="M32 32 L52 20" className="radar-art__sweep" />
      <ellipse cx="42" cy="22" rx="7" ry="5" fill="#2fbf57" opacity="0.85" />
      <ellipse cx="40" cy="23" rx="4" ry="3" fill="#f5d23a" />
      <ellipse cx="39" cy="23" rx="2" ry="1.5" fill="#e8483b" />
      <ellipse cx="20" cy="41" rx="6" ry="4" fill="#2fbf57" opacity="0.8" />
      <ellipse cx="19" cy="41" rx="3" ry="2" fill="#f5d23a" />
      <circle cx="32" cy="32" r="1.8" className="radar-art__dot" />
    </svg>
  );
}

export interface RadarCardProps {
  lat: number;
  lon: number;
  alerts: WeatherAlert[];
}

export function RadarCard({ lat, lon, alerts }: RadarCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="card radar-card" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="radar-card">
        <RadarArt />
        <span className="radar-card__text">
          <strong>Radar</strong>
          <span>See where rain and storms are right now</span>
        </span>
        <IconChevronRight size={20} className="radar-card__chev" />
      </button>
      {open ? <RadarHost lat={lat} lon={lon} alerts={alerts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Hosts the radar view full-screen. RadarView is a complete dialog on its own (initial focus, Escape, Tab
 * trap), so this adds only what it can't: lock the page behind it, a loading/failure state, and returning
 * focus to the button that opened it.
 */
function RadarHost({ lat, lon, alerts, onClose }: RadarCardProps & { onClose: () => void }) {
  usePageLock();
  useRestoreFocus();
  return createPortal(
    <RadarBoundary onClose={onClose}>
      <Suspense fallback={<RadarMessage title="Loading radar…" busy onClose={onClose} />}>
        <RadarView lat={lat} lon={lon} alerts={alerts} onClose={onClose} />
      </Suspense>
    </RadarBoundary>,
    document.body,
  );
}

/** Full-screen stand-in while the radar chunk loads, or when it can't. Has its own Close button and Escape. */
function RadarMessage({ title, busy, detail, onClose }: { title: string; busy?: boolean; detail?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div ref={ref} className="radar-message-screen" role="dialog" aria-modal="true" aria-label="Weather radar" tabIndex={-1}>
      <div className="radar-message" role={busy ? 'status' : 'alert'}>
        {busy ? <span className="spinner spinner--lg" aria-hidden="true" /> : null}
        <p className="radar-message__title">{title}</p>
        {detail ? <p className="muted">{detail}</p> : null}
        <button type="button" className="btn" onClick={onClose}>
          <IconClose size={16} /> Close
        </button>
      </div>
    </div>
  );
}

class RadarBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Radar failed', error, info.componentStack);
  }
  render() {
    if (this.state.failed) {
      return <RadarMessage title="Radar couldn’t load." detail="Check your connection and try again." onClose={this.props.onClose} />;
    }
    return this.props.children;
  }
}
