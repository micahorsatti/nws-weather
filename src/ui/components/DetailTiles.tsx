import type { ReactNode } from 'react';
import type { AirQualityNow, DailyForecast, HourlyPoint, WeatherBundle } from '../../data/types';
import { AQI_INFO, UV_INFO, aqiCategory, uvCategory } from '../../lib/scales';
import type { AqiCategory, UvCategory } from '../../lib/scales';
import {
  compassPoint,
  formatPercent,
  formatPrecip,
  formatPressure,
  formatSnow,
  formatTemp,
  formatVisibility,
  formatWind,
  wind,
  windUnit,
} from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import { compassWords, clamp, dewPointComfort } from '../lib/format';
import { maxOf } from '../lib/derive';
import type { CurrentView, SunView } from '../lib/derive';
import { formatClock, formatDuration, localDateKey, parseTime } from '../lib/time';
import { IconChevronRight } from './Icons';

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function Tile({ title, children, span2, className }: { title: string; children: ReactNode; span2?: boolean; className?: string }) {
  return (
    <section className={`tile${span2 ? ' tile--wide' : ''}${className ? ` ${className}` : ''}`} aria-label={title}>
      <h3 className="tile__label">{title}</h3>
      {children}
    </section>
  );
}

export interface DetailTilesProps {
  bundle: WeatherBundle;
  current: CurrentView | null;
  hours: HourlyPoint[];
  today: DailyForecast | null;
  sun: SunView;
  units: UnitSystem;
  tz: string;
  now: number;
  onOpenAir: () => void;
}

export function DetailTiles({ bundle, current, hours, today, sun, units, tz, now, onOpenAir }: DetailTilesProps) {
  const uvNow = hours[0]?.uvIndex ?? null;
  const uvMax = today?.uvIndexMax ?? maxOf(hours.filter((h) => localDateKey(parseTime(h.time) ?? now, tz) === localDateKey(now, tz)).map((h) => h.uvIndex));
  const aqiNow = bundle.airNow?.aqi ?? hours[0]?.aqi ?? null;

  return (
    <div className="tiles" data-testid="tiles">
      <WindTile current={current} units={units} />
      <UvTile now={uvNow} max={uvMax} />
      <AirTile air={bundle.airNow} aqi={aqiNow} onOpen={onOpenAir} />
      <PrecipTile hours={hours} today={today} units={units} />
      <HumidityTile current={current} units={units} />
      <PressureTile current={current} units={units} />
      <SunTile sun={sun} bundle={bundle} now={now} tz={tz} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ wind

function Compass({ deg, size = 54 }: { deg: number | null; size?: number }) {
  const c = size / 2;
  const r = c - 3;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="compass" aria-hidden="true" focusable="false">
      <circle cx={c} cy={c} r={r} className="compass__ring" />
      {[0, 90, 180, 270].map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1={c + Math.sin(rad) * (r - 1)}
            y1={c - Math.cos(rad) * (r - 1)}
            x2={c + Math.sin(rad) * (r - 6)}
            y2={c - Math.cos(rad) * (r - 6)}
            className="compass__tick"
          />
        );
      })}
      <text x={c} y={c - r + 16} textAnchor="middle" className="compass__n">
        N
      </text>
      {deg !== null ? (
        <g transform={`rotate(${(deg + 180) % 360} ${c} ${c})`}>
          <path d={`M${c} ${c - r + 20} L${c + 7} ${c + 12} L${c} ${c + 6} L${c - 7} ${c + 12} Z`} className="compass__arrow" />
        </g>
      ) : null}
    </svg>
  );
}

function WindTile({ current, units }: { current: CurrentView | null; units: UnitSystem }) {
  const speed = current ? wind(current.windKph, units) : null;
  const gust = current?.windGustKph ?? null;
  const deg = current?.windDirDeg ?? null;
  const calm = speed !== null && speed === 0;
  const from = deg !== null ? compassPoint(deg) : null;
  return (
    <Tile title="Wind">
      <div className="tile__row">
        <div>
          <p className="tile__value num">
            {speed === null ? '—' : calm ? 'Calm' : speed}
            {speed !== null && !calm ? <span className="tile__unit"> {windUnit(units)}</span> : null}
          </p>
          <p className="tile__sub">
            {from && !calm ? (
              <>
                <span className="sr-only">From the {compassWords(from)}</span>
                <span aria-hidden="true">From {from}</span>
              </>
            ) : (
              ' '
            )}
          </p>
          {isNum(gust) && !calm ? <p className="tile__sub">Gusts {formatWind(gust, units)}</p> : null}
        </div>
        {!calm ? <Compass deg={deg} /> : null}
      </div>
    </Tile>
  );
}

// ------------------------------------------------------------------------------------------ UV

const UV_ORDER: UvCategory[] = ['low', 'moderate', 'high', 'very-high', 'extreme'];
/** Index scale ranges (low 0–2, moderate 3–5, high 6–7, very high 8–10, extreme 11+) as widths of the 0–12 bar. */
const UV_SPANS = [3, 3, 2, 3, 1];

function uvPosition(uv: number): number {
  const total = UV_SPANS.reduce((a, b) => a + b, 0);
  return clamp(uv, 0, total) / total;
}

function UvTile({ now, max }: { now: number | null; max: number | null }) {
  const nowCat = now !== null ? uvCategory(now) : null;
  const maxCat = max !== null ? uvCategory(max) : null;
  const advice = (maxCat ?? nowCat) ? UV_INFO[(maxCat ?? nowCat) as UvCategory].advice : null;
  return (
    <Tile title="UV index">
      {now === null && max === null ? (
        <p className="tile__value tile__value--none">—</p>
      ) : (
        <>
          <div className="tile__value-row">
            <p className="tile__value num">{now !== null ? Math.round(now) : '—'}</p>
            {nowCat ? <span className="tile__cat">{UV_INFO[nowCat].label}</span> : null}
          </div>
          <div className="scale-wrap">
            <div className="scale" aria-hidden="true">
              <div className="scale__bar">
                {UV_ORDER.map((k, i) => (
                  <span key={k} style={{ background: UV_INFO[k].color, flexGrow: UV_SPANS[i] }} />
                ))}
              </div>
              {now !== null ? <span className="scale__marker" style={{ left: `${uvPosition(now) * 100}%` }} /> : null}
            </div>
          </div>
          {max !== null ? (
            <p className="tile__sub">
              Today&rsquo;s max <strong className="num">{Math.round(max)}</strong> · {UV_INFO[uvCategory(max)].label}
            </p>
          ) : null}
          {advice ? <p className="tile__sub tile__advice">{advice}</p> : null}
        </>
      )}
    </Tile>
  );
}

// ------------------------------------------------------------------------------------------ AQI

const AQI_ORDER: AqiCategory[] = ['good', 'moderate', 'usg', 'unhealthy', 'very-unhealthy', 'hazardous'];
const AQI_BREAKS = [0, 50, 100, 150, 200, 300, 500];

export function aqiPosition(aqi: number): number {
  const a = clamp(aqi, 0, 500);
  for (let i = 0; i < AQI_ORDER.length; i++) {
    if (a <= AQI_BREAKS[i + 1]) {
      const lo = AQI_BREAKS[i];
      const hi = AQI_BREAKS[i + 1];
      return (i + (a - lo) / (hi - lo)) / AQI_ORDER.length;
    }
  }
  return 1;
}

export const POLLUTANT_NAMES: Record<string, string> = {
  O3: 'ozone (O₃)',
  'PM2.5': 'fine particles (PM2.5)',
  PM10: 'coarse particles (PM10)',
  NO2: 'nitrogen dioxide (NO₂)',
  SO2: 'sulfur dioxide (SO₂)',
  CO: 'carbon monoxide (CO)',
};

export function sourceLabel(air: AirQualityNow | null): string {
  if (!air) return 'Open-Meteo model';
  return air.source === 'airnow' ? `AirNow${air.reportingArea ? ` · ${air.reportingArea}` : ''}` : 'Open-Meteo model';
}

function AirTile({ air, aqi, onOpen }: { air: AirQualityNow | null; aqi: number | null; onOpen: () => void }) {
  const cat = aqi !== null ? aqiCategory(aqi) : null;
  return (
    <button type="button" className="tile tile--btn" onClick={onOpen} aria-haspopup="dialog" aria-label={aqi === null ? 'Air quality, unavailable' : `Air quality ${Math.round(aqi)}, ${AQI_INFO[cat as AqiCategory].label}. Open details`}>
      <h3 className="tile__label">
        Air quality
        <IconChevronRight size={14} className="tile__chev" />
      </h3>
      {aqi === null || cat === null ? (
        <>
          <p className="tile__value tile__value--none">—</p>
          <p className="tile__sub">Not available right now</p>
        </>
      ) : (
        <>
          <div className="tile__value-row">
            <p className="tile__value num">{Math.round(aqi)}</p>
            <span className="tile__cat">{AQI_INFO[cat].label}</span>
          </div>
          <div className="scale-wrap">
            <div className="scale" aria-hidden="true">
              <div className="scale__bar">
                {AQI_ORDER.map((k) => (
                  <span key={k} style={{ background: AQI_INFO[k].color }} />
                ))}
              </div>
              <span className="scale__marker" style={{ left: `${aqiPosition(aqi) * 100}%` }} />
            </div>
          </div>
          <p className="tile__sub">
            {air?.primaryPollutant ? <>Main pollutant: {air.primaryPollutant.replace('O3', 'O₃').replace('NO2', 'NO₂').replace('SO2', 'SO₂')}</> : 'Air quality index'}
          </p>
          <p className="tile__sub tile__src">{sourceLabel(air)}</p>
        </>
      )}
    </button>
  );
}

// ------------------------------------------------------------------------------------------ precipitation

function PrecipTile({ hours, today, units }: { hours: HourlyPoint[]; today: DailyForecast | null; units: UnitSystem }) {
  const next = hours.slice(0, 12);
  const chance = next.length ? maxOf(next.map((h) => h.precipChancePct)) : null;
  const amount = today?.precipMm ?? null;
  const snow = today?.snowMm ?? null;
  const hasAmount = isNum(amount) && amount > 0.05;
  const hasSnow = isNum(snow) && snow > 0.5;
  const peak = Math.max(10, ...next.map((h) => h.precipChancePct ?? 0));
  return (
    <Tile title="Precipitation">
      <p className="tile__value num">{chance === null ? '—' : formatPercent(chance)}</p>
      <p className="tile__sub">{chance === null ? ' ' : 'chance in the next 12 h'}</p>
      {next.length > 0 ? (
        <div className="spark" aria-hidden="true">
          {next.map((h, i) => (
            <span key={i} className="spark__bar" style={{ height: `${Math.max(4, ((h.precipChancePct ?? 0) / peak) * 100)}%`, opacity: (h.precipChancePct ?? 0) > 0 ? 1 : 0.35 }} />
          ))}
        </div>
      ) : null}
      <p className="tile__sub">
        {hasAmount ? <>Expected today: <strong className="num">{formatPrecip(amount, units)}</strong></> : 'None expected today'}
        {hasSnow ? <> · snow <strong className="num">{formatSnow(snow, units)}</strong></> : null}
      </p>
    </Tile>
  );
}

// ------------------------------------------------------------------------------------------ humidity, pressure

function HumidityTile({ current, units }: { current: CurrentView | null; units: UnitSystem }) {
  const comfort = dewPointComfort(current?.dewpointC);
  return (
    <Tile title="Humidity">
      <p className="tile__value num">{formatPercent(current?.humidityPct)}</p>
      <p className="tile__sub">
        Dew point <strong className="num">{formatTemp(current?.dewpointC, units)}</strong>
      </p>
      {comfort ? <p className="tile__sub">{comfort.label}</p> : null}
    </Tile>
  );
}

function PressureTile({ current, units }: { current: CurrentView | null; units: UnitSystem }) {
  return (
    <Tile title="Pressure">
      <p className="tile__value tile__value--sm num">{formatPressure(current?.pressurePa, units)}</p>
      <p className="tile__sub">Visibility</p>
      <p className="tile__value tile__value--sm num">{formatVisibility(current?.visibilityM, units)}</p>
    </Tile>
  );
}

// ------------------------------------------------------------------------------------------ sun

function sunStatus(sun: SunView, bundle: WeatherBundle, now: number, tz: string): string | null {
  const { sunrise, sunset } = sun;
  if (sunrise === null || sunset === null) return null;
  if (now < sunrise) return `Sunrise in ${formatDuration((sunrise - now) / 60_000)}`;
  if (now < sunset) return `Sunset in ${formatDuration((sunset - now) / 60_000)}`;
  const tomorrow = bundle.daily.find((d) => d.date > localDateKey(now, tz));
  const nextRise = parseTime(tomorrow?.sunrise);
  return nextRise !== null && nextRise > now ? `Sunrise in ${formatDuration((nextRise - now) / 60_000)}` : `Sun set ${formatDuration((now - sunset) / 60_000)} ago`;
}

function SunTile({ sun, bundle, now, tz }: { sun: SunView; bundle: WeatherBundle; now: number; tz: string }) {
  const { sunrise, sunset } = sun;
  const have = sunrise !== null && sunset !== null;
  const t = have ? (now - sunrise) / (sunset - sunrise) : null;
  const up = t !== null && t >= 0 && t <= 1;

  const W = 300;
  const cx = 150;
  const cy = 88;
  const rx = 128;
  const ry = 70;
  const p = t !== null ? clamp(t, 0, 1) : 0;
  const px = cx - rx * Math.cos(Math.PI * p);
  const py = cy - ry * Math.sin(Math.PI * p);
  const arc = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`;
  const status = sunStatus(sun, bundle, now, tz);

  return (
    <Tile title="Sunrise & sunset" span2 className="tile--sun">
      {have ? (
        <>
          <svg viewBox={`0 0 ${W} 108`} className="sunarc" aria-hidden="true" focusable="false">
            <line x1={10} y1={cy} x2={W - 10} y2={cy} className="sunarc__horizon" />
            <path d={arc} className="sunarc__track" />
            {t !== null && t > 0 ? <path d={arc} pathLength={1} strokeDasharray={`${p} 1`} className="sunarc__done" /> : null}
            {up ? (
              <g>
                <circle cx={px} cy={py} r={13} className="sunarc__halo" />
                <circle cx={px} cy={py} r={8} className="sunarc__sun" />
              </g>
            ) : (
              <circle cx={t !== null && t > 1 ? cx + rx : cx - rx} cy={cy} r={5} className="sunarc__ghost" />
            )}
          </svg>
          <div className="sun-times">
            <div>
              <p className="sun-times__label">Sunrise</p>
              <p className="sun-times__value num">{formatClock(sunrise, tz)}</p>
            </div>
            <div className="sun-times__mid">
              {status ? <p className="sun-times__status">{status}</p> : null}
              {sun.daylightMinutes !== null ? <p className="tile__sub">Daylight {formatDuration(sun.daylightMinutes)}</p> : null}
            </div>
            <div>
              <p className="sun-times__label">Sunset</p>
              <p className="sun-times__value num">{formatClock(sunset, tz)}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="tile__sub">Sunrise and sunset times aren&rsquo;t available for this date.</p>
      )}
    </Tile>
  );
}
