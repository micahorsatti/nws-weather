import type { WeatherErrorKind } from '../../data/types';
import { WxIcon } from './WxIcon';
import type { WxIconProps } from './WxIcon';

const COPY: Record<WeatherErrorKind, { icon: WxIconProps['icon']; title: string; body: string }> = {
  'out-of-coverage': {
    icon: 'unknown',
    title: 'That place is outside the forecast area',
    body: 'NWS forecasts cover the United States and its territories — try a US location.',
  },
  network: {
    icon: 'wind',
    title: 'Can’t reach the weather service',
    body: 'Check your internet connection, then try again.',
  },
  'nws-unavailable': {
    icon: 'cloudy',
    title: 'The National Weather Service isn’t responding',
    body: 'Their servers are having trouble right now. This usually clears up within a few minutes.',
  },
  unknown: {
    icon: 'unknown',
    title: 'Something went wrong',
    body: 'The forecast couldn’t be loaded. Please try again.',
  },
};

export interface ErrorStateProps {
  kind: WeatherErrorKind;
  /** The data layer's own message, shown as a detail line. */
  detail?: string;
  onRetry: () => void;
  onChangePlace: () => void;
}

export function ErrorState({ kind, detail, onRetry, onChangePlace }: ErrorStateProps) {
  const copy = COPY[kind];
  return (
    <section className="card error-state" role="alert" data-testid="error-state" data-kind={kind}>
      <WxIcon icon={copy.icon} size={72} />
      <h2 className="error-state__title">{copy.title}</h2>
      <p className="error-state__body">{copy.body}</p>
      {detail && kind !== 'out-of-coverage' ? <p className="muted error-state__detail">{detail}</p> : null}
      <div className="error-state__actions">
        <button type="button" className={kind === 'out-of-coverage' ? 'btn' : 'btn btn--primary'} onClick={onRetry}>
          Try again
        </button>
        <button type="button" className={kind === 'out-of-coverage' ? 'btn btn--primary' : 'btn'} onClick={onChangePlace}>
          Choose another place
        </button>
      </div>
    </section>
  );
}

/** Placeholder layout with the same block sizes as the real screen, so nothing jumps when data arrives. */
export function LoadingSkeleton() {
  return (
    <div className="screen screen--skeleton" role="status" aria-label="Loading the forecast" aria-busy="true" data-testid="skeleton">
      <div className="slot slot--hero">
        <div className="skeleton skeleton--hero" />
      </div>
      <div className="slot slot--hourly">
        <div className="skeleton skeleton--card" />
      </div>
      <div className="slot slot--radar">
        <div className="skeleton skeleton--radar" />
      </div>
      <div className="slot slot--tiles">
        <div className="tiles">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton skeleton--tile" />
          ))}
          <div className="skeleton skeleton--wide" />
        </div>
      </div>
      <div className="slot slot--daily">
        <div className="skeleton skeleton--tall" />
      </div>
      <span className="sr-only">Loading the forecast…</span>
    </div>
  );
}
