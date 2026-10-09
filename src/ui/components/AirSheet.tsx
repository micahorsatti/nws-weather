import type { AirQualityDay, AirQualityNow } from '../../data/types';
import { AQI_INFO, aqiCategory, aqiCategoryFromNumber } from '../../lib/scales';
import type { AqiCategory } from '../../lib/scales';
import { monthDayOfKey, weekdayOfKey } from '../lib/time';
import { AqiBadge } from './Badges';
import { POLLUTANT_NAMES, sourceLabel } from './DetailTiles';
import { Sheet } from './Sheet';

const ROWS: { cat: AqiCategory; range: string }[] = [
  { cat: 'good', range: '0–50' },
  { cat: 'moderate', range: '51–100' },
  { cat: 'usg', range: '101–150' },
  { cat: 'unhealthy', range: '151–200' },
  { cat: 'very-unhealthy', range: '201–300' },
  { cat: 'hazardous', range: '301+' },
];

export interface AirSheetProps {
  air: AirQualityNow | null;
  aqi: number | null;
  days: AirQualityDay[];
  todayKey: string;
  onClose: () => void;
}

export function AirSheet({ air, aqi, days, todayKey, onClose }: AirSheetProps) {
  const cat = aqi !== null ? aqiCategory(aqi) : null;
  const upcoming = days.filter((d) => d.date >= todayKey);
  return (
    <Sheet title="Air quality" onClose={onClose} subtitle={sourceLabel(air)}>
      {cat !== null && aqi !== null ? (
        <section className="air-now" aria-label="Current air quality">
          <AqiBadge aqi={aqi} className="badge--lg" />
          <p className="air-now__advice">{AQI_INFO[cat].advice}</p>
          {air?.primaryPollutant ? (
            <p className="muted">Main pollutant: {POLLUTANT_NAMES[air.primaryPollutant] ?? air.primaryPollutant}</p>
          ) : null}
        </section>
      ) : (
        <p className="notice">Air quality isn&rsquo;t available right now.</p>
      )}

      <h3 className="sheet__section">The AQI scale</h3>
      {/* A list, not a table: no hidden caption/header cells (visually-hidden table parts can lose their
          table semantics or widen the page), and each category reads naturally on a narrow screen. */}
      <ol className="aqi-scale" role="list" aria-label="Air Quality Index categories">
        {ROWS.map(({ cat: c, range }) => {
          const info = AQI_INFO[c];
          const current = c === cat;
          return (
            <li key={c} className={current ? 'aqi-scale__item is-current' : 'aqi-scale__item'} aria-current={current ? 'true' : undefined}>
              <span className="aqi-scale__swatch" style={{ background: info.color }} aria-hidden="true" />
              <div className="aqi-scale__text">
                <p className="aqi-scale__name">
                  <strong>{info.label}</strong>
                  <span className="aqi-scale__range num">{range}</span>
                  {current ? <span className="aqi-scale__here">You are here</span> : null}
                </p>
                <p className="aqi-scale__advice">{info.advice}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {upcoming.length > 0 ? (
        <>
          <h3 className="sheet__section">Forecast</h3>
          <ul className="air-days" role="list">
            {upcoming.map((d) => {
              const dayCat = d.aqi !== null ? aqiCategory(d.aqi) : d.categoryNumber !== null ? aqiCategoryFromNumber(d.categoryNumber) : null;
              return (
                <li key={d.date} className="air-day">
                  <div className="air-day__head">
                    <span className="air-day__date">
                      <strong>{d.date === todayKey ? 'Today' : weekdayOfKey(d.date)}</strong> <span className="muted">{monthDayOfKey(d.date)}</span>
                    </span>
                    <AqiBadge aqi={d.aqi} category={dayCat} />
                  </div>
                  {d.primaryPollutant ? <p className="muted">Main pollutant: {POLLUTANT_NAMES[d.primaryPollutant] ?? d.primaryPollutant}</p> : null}
                  {d.discussion ? <p className="air-day__text">{d.discussion}</p> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <p className="muted sheet__foot">
        {air?.source === 'airnow'
          ? 'Official readings and forecasts come from the EPA’s AirNow program.'
          : 'This is a computer-model estimate from Open-Meteo (Copernicus CAMS), not an official reading. Add a free AirNow key in Settings for official EPA readings.'}
      </p>
    </Sheet>
  );
}
