import { IconChevronDown, IconPin, IconRefresh, IconSliders } from './Icons';

export interface TopBarProps {
  /** Place name; null before the first place is chosen (the bar then shows the app name). */
  title: string | null;
  updatedLabel: string | null;
  /** Absolute time of the last update, for the tooltip. */
  updatedTitle?: string;
  refreshing: boolean;
  onOpenPlaces: () => void;
  onRefresh: (() => void) | null;
  onOpenSettings: () => void;
}

export function TopBar({ title, updatedLabel, updatedTitle, refreshing, onOpenPlaces, onRefresh, onOpenSettings }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="topbar__place">
          {title ? (
            <button type="button" className="place-btn" onClick={onOpenPlaces} aria-haspopup="dialog" aria-label={`${title}. Change place`}>
              <IconPin size={18} className="place-btn__pin" />
              <span className="place-btn__name">{title}</span>
              <IconChevronDown size={18} />
            </button>
          ) : (
            <h1 className="topbar__app">NWS Weather</h1>
          )}
          {title && updatedLabel ? (
            <p className="topbar__updated" title={updatedTitle} data-testid="updated">
              {updatedLabel}
            </p>
          ) : null}
        </div>
        <div className="topbar__actions">
          {onRefresh ? (
            <button type="button" className="icon-btn" onClick={onRefresh} disabled={refreshing} aria-label="Refresh" aria-busy={refreshing} data-testid="refresh">
              <IconRefresh size={22} className={refreshing ? 'spin' : undefined} />
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-haspopup="dialog" aria-label="Settings">
            <IconSliders size={22} />
          </button>
        </div>
      </div>
      <span className="sr-only" role="status">
        {refreshing ? 'Refreshing forecast' : ''}
      </span>
    </header>
  );
}

export interface StatusBannerProps {
  tone: 'offline' | 'error';
  children: string;
  onRetry?: () => void;
}

/** A calm, one-line notice under the top bar (offline, or a failed refresh while older data is shown). */
export function StatusBanner({ tone, children, onRetry }: StatusBannerProps) {
  return (
    <div className={`status-banner status-banner--${tone}`} role="status" data-testid="status-banner">
      <span>{children}</span>
      {onRetry ? (
        <button type="button" className="linklike" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
