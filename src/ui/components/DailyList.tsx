import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { DailyForecast, ForecastPeriod } from '../../data/types';
import { formatPrecip, formatSnow, formatTemp, formatWind } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import { heatGradient } from '../lib/heat';
import { formatClock, localDateKey, monthDayOfKey, parseTime, weekdayOfKey } from '../lib/time';
import { AqiBadge, UvBadge } from './Badges';
import { IconChevronDown } from './Icons';
import { ICON_LABELS, WxIcon } from './WxIcon';

export interface DailyListProps {
  days: DailyForecast[];
  currentTempC: number | null;
  units: UnitSystem;
  tz: string;
  now: number;
  onOpenDiscussion?: () => void;
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const EXTENDED_DIVIDER = 'Extended outlook · NOAA GFS model, lower confidence';

export function DailyList({ days, currentTempC, units, tz, now, onOpenDiscussion }: DailyListProps) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const todayKey = localDateKey(now, tz);

  // One shared scale across every day so bars are comparable at a glance.
  const lows = days.map((d) => d.lowC).filter(isNum);
  const highs = days.map((d) => d.highC).filter(isNum);
  const scaleMin = lows.length ? Math.min(...lows, ...(isNum(currentTempC) ? [currentTempC] : [])) : 0;
  const scaleMax = highs.length ? Math.max(...highs, ...(isNum(currentTempC) ? [currentTempC] : [])) : 1;
  const span = Math.max(1, scaleMax - scaleMin);
  const pct = (c: number) => ((c - scaleMin) / span) * 100;

  const nws = days.filter((d) => d.source === 'nws');
  const gfs = days.filter((d) => d.source === 'gfs');

  const renderRow = (d: DailyForecast) => (
    <DayRow
      key={d.date}
      day={d}
      isToday={d.date === todayKey}
      open={openDate === d.date}
      onToggle={() => setOpenDate((cur) => (cur === d.date ? null : d.date))}
      pct={pct}
      currentTempC={d.date === todayKey ? currentTempC : null}
      units={units}
      tz={tz}
    />
  );

  return (
    <section className="card daily" aria-labelledby="daily-title" data-testid="daily">
      <div className="card__head">
        <h2 id="daily-title" className="card__title">
          {days.length}-day forecast
        </h2>
      </div>

      {nws.length > 0 ? (
        <ol className="days" role="list" aria-label="Forecast days">
          {nws.map(renderRow)}
        </ol>
      ) : null}

      {gfs.length > 0 ? (
        <>
          <div className="days-divider" role="separator" aria-label={EXTENDED_DIVIDER} data-testid="extended-divider">
            <span>{EXTENDED_DIVIDER}</span>
          </div>
          <ol className="days days--extended" role="list" aria-label="Extended outlook days">
            {gfs.map(renderRow)}
          </ol>
        </>
      ) : null}

      {days.length === 0 ? <p className="muted">The daily forecast isn&rsquo;t available right now.</p> : null}

      {onOpenDiscussion ? (
        <button type="button" className="link-row" onClick={onOpenDiscussion} aria-haspopup="dialog">
          <span>Read the forecaster&rsquo;s discussion</span>
          <IconChevronDown size={18} className="link-row__chev" />
        </button>
      ) : null}
    </section>
  );
}

interface DayRowProps {
  day: DailyForecast;
  isToday: boolean;
  open: boolean;
  onToggle: () => void;
  pct: (c: number) => number;
  currentTempC: number | null;
  units: UnitSystem;
  tz: string;
}

function DayRow({ day, isToday, open, onToggle, pct, currentTempC, units, tz }: DayRowProps) {
  const panelId = useId();
  const extended = day.source === 'gfs';
  const name = isToday ? 'Today' : weekdayOfKey(day.date);
  const precip = isNum(day.precipChancePct) && day.precipChancePct >= 10 ? Math.round(day.precipChancePct) : null;
  const lowC = day.lowC;
  const highC = day.highC;
  const barLow = lowC ?? highC;
  const barHigh = highC ?? lowC;
  const hasBar = isNum(barLow) && isNum(barHigh);
  const left = hasBar ? pct(barLow) : 0;
  const width = hasBar ? Math.max(pct(barHigh) - pct(barLow), 2.5) : 0;
  const iconLabel = day.summary || ICON_LABELS[day.icon];

  const spoken = [
    `${isToday ? 'Today' : weekdayOfKey(day.date, 'long')}, ${monthDayOfKey(day.date)}`,
    iconLabel,
    isNum(highC) ? `high ${formatTemp(highC, units)}` : null,
    isNum(lowC) ? `low ${formatTemp(lowC, units)}` : null,
    precip !== null ? `${precip} percent chance of precipitation` : null,
    extended ? 'extended outlook, lower confidence' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className={open ? 'day day--open' : 'day'} data-extended={extended ? 'true' : undefined} data-testid="day-row">
      <button type="button" className="day__row" aria-expanded={open} aria-controls={panelId} onClick={onToggle} aria-label={spoken}>
        <span className="day__name" aria-hidden="true">
          <strong>{name}</strong>
          <small>{monthDayOfKey(day.date)}</small>
        </span>
        <span className="day__icon" aria-hidden="true">
          <WxIcon icon={day.icon} day={day.isDaytimeIcon} size={34} />
        </span>
        <span className="day__pop" aria-hidden="true">
          {precip !== null ? (
            <>
              <svg viewBox="0 0 10 12" width="8" height="10" className="day__drop" aria-hidden="true">
                <path d="M5 .8C3.2 3.4 1.2 5.5 1.2 7.7a3.8 3.8 0 0 0 7.6 0C8.8 5.5 6.8 3.4 5 .8z" fill="currentColor" />
              </svg>
              {precip}%
            </>
          ) : null}
        </span>
        <span className="day__lo num" aria-hidden="true">
          {formatTemp(lowC, units)}
        </span>
        <span className="day__bar" aria-hidden="true">
          {hasBar ? (
            <span
              className="day__range"
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundImage: heatGradient(barLow, barHigh) }}
            />
          ) : null}
          {isNum(currentTempC) ? <span className="day__now" style={{ left: `${pct(currentTempC)}%` }} /> : null}
        </span>
        <span className="day__hi num" aria-hidden="true">
          {formatTemp(highC, units)}
        </span>
        <IconChevronDown size={16} className="day__chev" />
      </button>

      {open ? (
        <div id={panelId} className="day__panel" role="region" aria-label={`${weekdayOfKey(day.date, 'long')} details`}>
          <DayDetails day={day} units={units} tz={tz} />
        </div>
      ) : null}
    </li>
  );
}

function PeriodText({ period, units }: { period: ForecastPeriod; units: UnitSystem }) {
  return (
    <div className="period">
      <h4 className="period__name">{period.name}</h4>
      <p className="period__text">{period.detailedForecast}</p>
      {units === 'metric' ? <p className="period__note">The forecaster&rsquo;s text is written in °F and mph.</p> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DayDetails({ day, units, tz }: { day: DailyForecast; units: UnitSystem; tz: string }) {
  const sunrise = parseTime(day.sunrise);
  const sunset = parseTime(day.sunset);
  const hasFeels = isNum(day.feelsLikeHighC) || isNum(day.feelsLikeLowC);
  const hasWind = isNum(day.windKph);
  const precipAmount = isNum(day.precipMm) && day.precipMm > 0;
  const snowAmount = isNum(day.snowMm) && day.snowMm > 0;
  const noText = !day.day && !day.night;

  return (
    <>
      {day.day ? <PeriodText period={day.day} units={units} /> : null}
      {day.night ? <PeriodText period={day.night} units={units} /> : null}
      {noText ? (
        <div className="period">
          <h4 className="period__name">{day.source === 'gfs' ? 'Model outlook' : 'Outlook'}</h4>
          <p className="period__text">
            {day.summary || ICON_LABELS[day.icon]}.{' '}
            {day.source === 'gfs'
              ? 'This day comes from NOAA’s GFS computer model rather than a forecaster, so expect it to change.'
              : 'No written forecast is available for this day.'}
          </p>
        </div>
      ) : null}

      <dl className="facts">
        {hasFeels ? (
          <Fact label="Feels like">
            {isNum(day.feelsLikeHighC) ? <>High {formatTemp(day.feelsLikeHighC, units)}</> : null}
            {isNum(day.feelsLikeHighC) && isNum(day.feelsLikeLowC) ? ' · ' : null}
            {isNum(day.feelsLikeLowC) ? <>Low {formatTemp(day.feelsLikeLowC, units)}</> : null}
          </Fact>
        ) : null}
        {hasWind ? (
          <Fact label="Wind">
            Up to {formatWind(day.windKph, units)}
            {isNum(day.windGustKph) && day.windGustKph > (day.windKph ?? 0) + 8 ? <>, gusts {formatWind(day.windGustKph, units)}</> : null}
          </Fact>
        ) : null}
        {isNum(day.uvIndexMax) ? (
          <Fact label="UV index (max)">
            <UvBadge uv={day.uvIndexMax} />
          </Fact>
        ) : null}
        {isNum(day.aqiMax) ? (
          <Fact label="Air quality (max)">
            <AqiBadge aqi={day.aqiMax} />
          </Fact>
        ) : null}
        {precipAmount || snowAmount || isNum(day.precipChancePct) ? (
          <Fact label="Precipitation">
            {isNum(day.precipChancePct) ? `${Math.round(day.precipChancePct)}% chance` : null}
            {precipAmount ? <>{isNum(day.precipChancePct) ? ' · ' : null}{formatPrecip(day.precipMm, units)}</> : null}
            {snowAmount ? <> · snow {formatSnow(day.snowMm, units)}</> : null}
          </Fact>
        ) : null}
        {sunrise !== null && sunset !== null ? (
          <Fact label="Sunrise · sunset">
            {formatClock(sunrise, tz)} · {formatClock(sunset, tz)}
          </Fact>
        ) : null}
      </dl>
    </>
  );
}

