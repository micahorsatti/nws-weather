/** Presentational pieces of the radar overlay: icons, legend, attribution, and the playback controls. */
import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import { attributionFor } from './basemap';
import { LEGEND_BANDS, LEGEND_DESCRIPTION, LEGEND_TICKS, legendGradient, legendPercent } from './legend';
import type { RadarSource } from './frames';

const ICON = { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true, focusable: false } as const;

export function CloseIcon() {
  return (
    <svg {...ICON}>
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...ICON}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...ICON}>
      <rect x="6.5" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" />
      <rect x="13.7" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" />
    </svg>
  );
}

function StepBackIcon() {
  return (
    <svg {...ICON}>
      <rect x="5.5" y="6" width="2.6" height="12" rx="1" fill="currentColor" />
      <path d="M18.5 6v12l-9-6z" fill="currentColor" />
    </svg>
  );
}

function StepForwardIcon() {
  return (
    <svg {...ICON}>
      <rect x="15.9" y="6" width="2.6" height="12" rx="1" fill="currentColor" />
      <path d="M5.5 6v12l9-6z" fill="currentColor" />
    </svg>
  );
}

const GRADIENT = legendGradient();

/** Compact dBZ legend: gradient bar, tick labels, and plain-language bands. */
export function Legend() {
  return (
    <div className="rv-legend" role="img" aria-label={LEGEND_DESCRIPTION}>
      <div className="rv-legend-head" aria-hidden="true">
        Reflectivity <span>dBZ</span>
      </div>
      <div className="rv-legend-bar" aria-hidden="true" style={{ background: GRADIENT }} />
      <div className="rv-legend-ticks" aria-hidden="true">
        {LEGEND_TICKS.map((dbz) => (
          <span key={dbz} style={{ left: `${legendPercent(dbz)}%` }}>
            {dbz}
          </span>
        ))}
      </div>
      <div className="rv-legend-bands" aria-hidden="true">
        {LEGEND_BANDS.map((band) => (
          <span key={band.label} style={{ left: `${legendPercent(band.dbz)}%` }}>
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Map and radar credits; links open in a new tab. */
export function Attribution({ kind }: { kind: RadarSource['kind'] }) {
  return (
    <p className="rv-attrib">
      {attributionFor(kind).map((segment, i) => (
        <Fragment key={i}>
          {segment.href ? (
            <a href={segment.href} target="_blank" rel="noopener noreferrer">
              {segment.text}
            </a>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </p>
  );
}

export interface ControlsProps {
  count: number;
  index: number;
  playing: boolean;
  /** "9:28 PM" */
  timeLabel: string;
  /** "12 min ago" */
  ageLabel: string;
  /** Frames whose tiles are loaded; shown while fewer than `count`. */
  loadedCount: number;
  onPlayPause: () => void;
  onStep: (delta: -1 | 1) => void;
  onScrub: (index: number) => void;
}

/** Play/pause, step buttons, the time readout, and the scrubber. */
export function Controls({ count, index, playing, timeLabel, ageLabel, loadedCount, onPlayPause, onStep, onScrub }: ControlsProps) {
  const disabled = count < 2;
  const isPlaying = playing && !disabled;
  const fill = count > 1 ? (index / (count - 1)) * 100 : 100;
  const loading = count > 0 && loadedCount < count;
  return (
    <div className="rv-controls">
      <div className="rv-controls-row">
        <button type="button" className="rv-btn" aria-label="Previous frame" disabled={disabled} onClick={() => onStep(-1)}>
          <StepBackIcon />
        </button>
        <button
          type="button"
          className="rv-btn rv-play"
          aria-label={isPlaying ? 'Pause radar loop' : 'Play radar loop'}
          disabled={disabled}
          onClick={onPlayPause}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="rv-btn" aria-label="Next frame" disabled={disabled} onClick={() => onStep(1)}>
          <StepForwardIcon />
        </button>
        <div className="rv-time">
          <div className="rv-time-main">{timeLabel}</div>
          <div className="rv-time-sub">{loading ? `${ageLabel} · loading ${loadedCount}/${count}` : ageLabel}</div>
        </div>
      </div>
      <input
        type="range"
        className="rv-slider"
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={Math.min(index, Math.max(0, count - 1))}
        disabled={disabled}
        aria-label="Radar frame time"
        aria-valuetext={ageLabel ? `${timeLabel}, ${ageLabel}` : timeLabel}
        style={{ '--rv-fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onScrub(Number(e.currentTarget.value))}
      />
    </div>
  );
}
