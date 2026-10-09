import type { AlertSeverity, WeatherAlert } from '../../data/types';
import { formatClockMaybeDay, parseTime } from '../lib/time';
import { IconAlert, IconChevronRight } from './Icons';

export const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  Extreme: 'sev-extreme',
  Severe: 'sev-severe',
  Moderate: 'sev-moderate',
  Minor: 'sev-minor',
  Unknown: 'sev-unknown',
};

/** "until 9:15 PM" (with the weekday when it ends on another day), or null when no end time is known. */
export function untilText(alert: WeatherAlert, now: number, tz: string): string | null {
  const end = parseTime(alert.ends ?? alert.expires);
  return end === null ? null : `until ${formatClockMaybeDay(end, now, tz)}`;
}

export interface AlertsBannerProps {
  alerts: WeatherAlert[];
  now: number;
  tz: string;
  onOpen: () => void;
}

/** The most severe active alert, its end time, and how many more there are. Tap opens the full list. */
export function AlertsBanner({ alerts, now, tz, onOpen }: AlertsBannerProps) {
  const first = alerts[0];
  if (!first) return null;
  const more = alerts.length - 1;
  const until = untilText(first, now, tz);
  return (
    <button
      type="button"
      className={`alert-banner ${SEVERITY_CLASS[first.severity]}`}
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="alert-banner"
    >
      <IconAlert size={22} className="alert-banner__icon" />
      <span className="alert-banner__text">
        <span className="alert-banner__event">{first.event}</span>
        {until ? <span className="alert-banner__until">{until}</span> : null}
      </span>
      {more > 0 ? <span className="alert-banner__more">+{more} more</span> : null}
      <IconChevronRight size={18} className="alert-banner__chev" />
    </button>
  );
}
