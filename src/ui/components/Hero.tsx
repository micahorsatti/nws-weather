import type { CSSProperties } from 'react';
import type { DailyForecast } from '../../data/types';
import { formatTemp, temp } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import type { CurrentView } from '../lib/derive';
import { feelsLikeNote } from '../lib/feels';
import { skyFor } from '../lib/sky';
import { formatClock, parseTime } from '../lib/time';
import { IconTriDown, IconTriUp } from './Icons';
import { ICON_LABELS, WxIcon } from './WxIcon';

export interface HeroProps {
  current: CurrentView | null;
  today: DailyForecast | null;
  units: UnitSystem;
  tz: string;
}

export function Hero({ current, today, units, tz }: HeroProps) {
  const unitLetter = units === 'imperial' ? 'F' : 'C';
  const unitWord = units === 'imperial' ? 'Fahrenheit' : 'Celsius';

  if (!current) {
    return (
      <section className="hero hero--empty" aria-label="Current conditions">
        <p className="hero__desc">Current conditions aren&rsquo;t available right now.</p>
      </section>
    );
  }

  const sky = skyFor(current.icon, current.isDaytime);
  const style = { '--sky-top': sky.top, '--sky-bottom': sky.bottom } as CSSProperties;
  const t = temp(current.tempC, units);
  const feelsC = current.feelsLikeC ?? current.tempC;
  const feels = formatTemp(feelsC, units);
  const high = today?.highC ?? null;
  const low = today?.lowC ?? null;
  const observedAt = parseTime(current.observedAt);
  const note = feelsLikeNote(current.feelsLikeKind, current.tempC, current.feelsLikeC, units);
  const description = current.description || ICON_LABELS[current.icon];

  const provenance =
    current.source === 'forecast'
      ? 'Estimated from the forecast'
      : `Observed${observedAt !== null ? ` ${formatClock(observedAt, tz)}` : ''}${current.stationName ? ` · ${current.stationName}` : ''}`;

  return (
    <section className="hero on-sky" style={style} data-sky={sky.key} data-decor={sky.decor} aria-label="Current conditions" data-testid="hero">
      <div className="hero__main">
        <p className="hero__temp" data-testid="hero-temp">
          <span className="sr-only">{t === null ? 'Temperature unknown' : `${t} degrees ${unitWord}`}</span>
          <span aria-hidden="true">
            <span className="hero__num">{t === null ? '—' : t}</span>
            <span className="hero__unit">
              <span className="hero__deg">°</span>
              {unitLetter}
            </span>
          </span>
        </p>
        <div className="hero__cond">
          <WxIcon icon={current.icon} day={current.isDaytime} size={76} />
          <p className="hero__desc">{description}</p>
        </div>
      </div>

      <p className="hero__feels" data-testid="hero-feels">
        <span className="hero__feels-label">Feels like</span> <span className="hero__feels-value">{feels}</span>
      </p>
      {note ? (
        <p className="hero__note" data-testid="hero-note">
          {note}
        </p>
      ) : null}

      {high !== null || low !== null ? (
        <p className="hero__hl" data-testid="hero-hl">
          {high !== null ? (
            <span className="hero__hl-item">
              <IconTriUp />
              <span className="sr-only">High</span>
              <span aria-hidden="true">H</span> {formatTemp(high, units)}
            </span>
          ) : null}
          {low !== null ? (
            <span className="hero__hl-item">
              <IconTriDown />
              <span className="sr-only">Low</span>
              <span aria-hidden="true">L</span> {formatTemp(low, units)}
            </span>
          ) : null}
        </p>
      ) : null}

      <p className="hero__prov" data-testid="hero-provenance">
        {provenance}
      </p>
    </section>
  );
}
