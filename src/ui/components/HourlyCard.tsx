import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { HourlyPoint } from '../../data/types';
import { formatPercent, formatPrecip, formatSnow, formatTemp, formatWind, compassPoint } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';
import { layoutChart, LABEL_W } from '../lib/chartLayout';
import type { ChartLayout } from '../lib/chartLayout';
import { futureHours } from '../lib/derive';
import { feelsComparison } from '../lib/feels';
import { buildRows, summarizeHours } from '../lib/hourly';
import type { HourRow, RangeMode } from '../lib/hourly';
import { formatDayClock, formatHour, formatWeekday, localDateKey } from '../lib/time';
import { useCoarsePointer } from '../hooks';
import { AqiBadge, UvBadge } from './Badges';
import { IconWindArrow } from './Icons';
import { Segmented } from './Segmented';
import { ICON_LABELS, WxIcon } from './WxIcon';
import { precipUnit } from '../lib/format';

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export interface HourlyCardProps {
  hourly: HourlyPoint[];
  now: number;
  tz: string;
  units: UnitSystem;
}

export function HourlyCard({ hourly, now, tz, units }: HourlyCardProps) {
  const [mode, setMode] = useState<RangeMode>('48h');
  const [selectedT, setSelectedT] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const coarse = useCoarsePointer();
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Hours that have already passed are dropped at render time (a cached bundle can be hours old).
  const firstHour = futureHours(hourly, now)[0]?.time ?? null;
  const rows = useMemo(
    () => buildRows(hourly, now, tz, mode),
    // `now` is intentionally represented by `firstHour`: the rows only change when an hour rolls off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hourly, tz, mode, firstHour],
  );
  const todayKey = localDateKey(now, tz);
  const layout = useMemo(
    () => (rows.length ? layoutChart(rows, mode, units, tz, todayKey, now) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mode, units, tz, todayKey],
  );

  // The current hour is selected until the user picks another, so the readout always shows real values.
  // (If the picked hour has since rolled into the past, selection falls back to the current hour.)
  const picked = selectedT === null ? -1 : rows.findIndex((r) => r.t === selectedT);
  const selected = rows.length === 0 ? null : picked >= 0 ? picked : 0;
  const active = hoverIdx ?? selected;

  // A different range is a different chart: start again from "now".
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ left: 0 });
  }, [mode]);

  const indexAt = (clientX: number): number | null => {
    const el = svgRef.current;
    if (!el || !layout) return null;
    const left = el.getBoundingClientRect().left;
    const i = Math.floor((clientX - left) / layout.px);
    return i < 0 || i >= layout.n ? null : i;
  };

  const select = (i: number | null) => {
    if (i === null || !rows[i]) return;
    setSelectedT(rows[i].t);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse') return;
    const i = indexAt(e.clientX);
    setHoverIdx(i);
    if (e.buttons === 1) select(i);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button === 0) select(indexAt(e.clientX));
  };
  const onClick = (e: MouseEvent<SVGSVGElement>) => select(indexAt(e.clientX));

  const reveal = (i: number) => {
    const sc = scrollRef.current;
    if (!sc || !layout) return;
    const left = i * layout.px;
    const right = left + layout.px;
    if (left < sc.scrollLeft + 8) sc.scrollLeft = Math.max(0, left - 8);
    else if (right > sc.scrollLeft + sc.clientWidth - 8) sc.scrollLeft = right - sc.clientWidth + 8;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!layout) return;
    const cur = selected ?? -1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(layout.n - 1, cur + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = layout.n - 1;
    else if (e.key === 'Escape' && selectedT !== null) {
      // Back to the current hour.
      e.stopPropagation();
      setSelectedT(null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    select(next);
    reveal(next);
  };

  const summary = useMemo(
    () => summarizeHours(rows, units, tz, (ms, zone) => formatDayClock(ms, zone)),
    [rows, units, tz],
  );

  return (
    <section className="card hourly" aria-labelledby={titleId} data-testid="hourly">
      <div className="card__head">
        <h2 id={titleId} className="card__title">
          Hourly
        </h2>
        <Segmented<RangeMode>
          label="Forecast range"
          value={mode}
          onChange={setMode}
          options={[
            { value: '48h', label: '48 h', ariaLabel: 'Next 48 hours' },
            { value: '7d', label: '7 days', ariaLabel: 'Next 7 days' },
          ]}
        />
      </div>

      {layout ? (
        <>
          <ul className="legend" role="list" aria-label="Chart key">
            <li>
              <svg width="26" height="10" aria-hidden="true">
                <line x1="2" y1="5" x2="24" y2="5" className="ch-temp" />
              </svg>
              Temperature
            </li>
            <li>
              <svg width="26" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="25" y2="5" className="ch-feels" />
              </svg>
              Feels like
            </li>
            <li>
              <svg width="14" height="12" aria-hidden="true">
                <rect x="2" y="1" width="10" height="11" rx="2.5" className="ch-bar" />
              </svg>
              Precip. chance
            </li>
          </ul>

          {active !== null ? <Readout row={rows[active]} units={units} tz={tz} /> : null}

          <div className="chart" data-mode={mode}>
            <ChartAxis layout={layout} units={units} />
            <div
              ref={scrollRef}
              className="chart__scroll"
              tabIndex={0}
              role="group"
              aria-label={summary}
              onKeyDown={onKeyDown}
              data-testid="hourly-scroll"
            >
              <svg
                ref={svgRef}
                className="chart__svg"
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
                focusable="false"
                onPointerMove={onPointerMove}
                onPointerDown={onPointerDown}
                onPointerLeave={() => setHoverIdx(null)}
                onClick={onClick}
              >
                <SelectionBand layout={layout} index={active} />
                <ChartLayers layout={layout} rows={rows} />
                <SelectionMarks layout={layout} index={active} />
              </svg>
            </div>
          </div>

          <p className="chart__caption" aria-hidden="true">
            {coarse ? 'Tap an hour for details · swipe for more' : 'Click or hover an hour for details · scroll for more'}
          </p>

          <HourlyTable rows={rows} units={units} tz={tz} />
        </>
      ) : (
        <p className="muted">The hourly forecast isn&rsquo;t available right now.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------ axis column

function ChartAxis({ layout, units }: { layout: ChartLayout; units: UnitSystem }) {
  const { bands } = layout;
  const title = (key: 'precip' | 'wind' | 'uv' | 'aqi', first: string, second?: string) => {
    const b = bands[key];
    if (!b) return null;
    return (
      <g>
        <text x={LABEL_W - 8} y={b.y + 15} className="ch-rowtitle">
          {first}
        </text>
        {second ? (
          <text x={LABEL_W - 8} y={b.y + 28} className="ch-rowunit">
            {second}
          </text>
        ) : null}
      </g>
    );
  };
  return (
    <svg className="chart__axis" width={LABEL_W} height={layout.height} aria-hidden="true" focusable="false">
      {layout.temp ? (
        <g>
          <text x={LABEL_W - 8} y={(bands.temp?.y ?? 0) + 11} className="ch-rowunit">
            {units === 'imperial' ? '°F' : '°C'}
          </text>
          {layout.temp.ticks.map((t) => (
            <text key={t.text} x={LABEL_W - 8} y={t.y + 4} className="ch-tick">
              {t.text}
            </text>
          ))}
        </g>
      ) : null}
      {title('precip', 'Precip', `${precipUnit(units)} · %`)}
      {title('wind', 'Wind', units === 'imperial' ? 'mph' : 'km/h')}
      {title('uv', 'UV')}
      {title('aqi', 'AQI')}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------ chart layers

function SelectionBand({ layout, index }: { layout: ChartLayout; index: number | null }) {
  if (index === null) return null;
  return <rect x={index * layout.px} y={0} width={layout.px} height={layout.height} className="ch-select" />;
}

function SelectionMarks({ layout, index }: { layout: ChartLayout; index: number | null }) {
  if (index === null || !layout.temp) return null;
  const x = (index + 0.5) * layout.px;
  const yt = layout.temp.yTemp(index);
  const yf = layout.temp.yFeels(index);
  return (
    <g>
      <line x1={x} x2={x} y1={0} y2={layout.height} className="ch-cursor" />
      {yf !== null ? <circle cx={x} cy={yf} r={5.5} className="ch-dot ch-dot--feels" /> : null}
      {yt !== null ? <circle cx={x} cy={yt} r={5.5} className="ch-dot ch-dot--temp" /> : null}
    </g>
  );
}

const ChartLayers = memo(function ChartLayers({ layout, rows }: { layout: ChartLayout; rows: readonly HourRow[] }) {
  const { bands } = layout;
  void rows;
  return (
    <g>
      {/* day separators */}
      {layout.separators.map((i) => (
        <line key={`sep-${i}`} x1={i * layout.px} x2={i * layout.px} y1={0} y2={layout.height} className="ch-sep" />
      ))}
      {layout.dayLabels.map((d) => (
        <text key={d.dateKey} x={d.x} y={(bands.day?.y ?? 0) + 14} className="ch-day">
          {d.text}
        </text>
      ))}

      {/* time labels and condition icons */}
      {layout.timeLabels.map((t, k) => (
        <text key={k} x={t.x} y={(bands.time?.y ?? 0) + 14} textAnchor={t.anchor} className={t.text === 'Now' ? 'ch-time ch-time--now' : 'ch-time'}>
          {t.text}
        </text>
      ))}
      {layout.icons.map((c) => (
        <WxIcon key={c.i} icon={c.icon} day={c.day} size={30} x={c.xc - 15} y={(bands.icon?.y ?? 0) + 3} />
      ))}

      {/* temperature and "Feels like" */}
      {layout.temp && bands.temp ? <TempLayer layout={layout} temp={layout.temp} /> : null}

      {/* precipitation chance */}
      {layout.precip && bands.precip ? (
        <g>
          <line x1={0} x2={layout.width} y1={layout.precip.mid} y2={layout.precip.mid} className="ch-grid" />
          <line x1={0} x2={layout.width} y1={layout.precip.baseline} y2={layout.precip.baseline} className="ch-base" />
          {layout.precip.bars.length === 0 ? (
            // An empty row can look like a rendering failure; say that nothing is expected.
            <text x={10} y={layout.precip.mid + 4} className="ch-none">
              {layout.mode === '48h' ? 'No precipitation expected in the next 48 hours' : 'No precipitation expected in the next 7 days'}
            </text>
          ) : null}
          {layout.precip.bars.map((b) => (
            <g key={b.i}>
              <path d={b.path} className="ch-bar" />
              {b.label ? (
                <text x={b.label.x} y={b.label.y} className="ch-barlabel">
                  {b.label.text}
                </text>
              ) : null}
              {b.amount ? (
                <text x={b.amount.x} y={b.amount.y} className="ch-amount">
                  {b.amount.snow ? '❄ ' : ''}
                  {b.amount.text}
                </text>
              ) : null}
            </g>
          ))}
        </g>
      ) : null}

      {/* wind */}
      {bands.wind
        ? layout.wind.map((w) => (
            <g key={w.i}>
              {w.rotate !== null ? <IconWindArrow size={18} rotate={w.rotate} x={w.xc - 9} y={bands.wind!.y + 2} className="ch-windarrow" /> : null}
              <text x={w.xc} y={bands.wind!.y + 33} className="ch-wind">
                {w.speed}
              </text>
              {w.gust ? (
                <text x={w.xc} y={bands.wind!.y + 47} className="ch-gust">
                  g {w.gust}
                </text>
              ) : null}
            </g>
          ))
        : null}

      {/* UV and AQI chips */}
      {bands.uv ? <Chips cells={layout.uv} y={bands.uv.y} /> : null}
      {bands.aqi ? <Chips cells={layout.aqi} y={bands.aqi.y} /> : null}
    </g>
  );
});

function Chips({ cells, y }: { cells: ChartLayout['uv']; y: number }) {
  return (
    <g>
      {cells.map((c) =>
        c.empty ? (
          <text key={c.i} x={c.xc} y={y + 19} className="ch-chip-empty">
            {c.text}
          </text>
        ) : (
          <g key={c.i}>
            <rect x={c.xc - c.w / 2} y={y + 3} width={c.w} height={24} rx={12} fill={c.bg} />
            <text x={c.xc} y={y + 19.5} fill={c.fg} className="ch-chip">
              {c.text}
            </text>
          </g>
        ),
      )}
    </g>
  );
}

function TempLayer({ layout, temp: t }: { layout: ChartLayout; temp: NonNullable<ChartLayout['temp']> }) {
  return (
    <g>
      {t.ticks.map((tick) => (
        <line key={tick.text} x1={0} x2={layout.width} y1={tick.y} y2={tick.y} className="ch-grid" />
      ))}
      <path d={t.areaPath} className="ch-area" />
      {/* drawn first so the solid temperature line covers it wherever the two agree */}
      <path d={t.feelsPath} className="ch-feels" />
      <path d={t.tempPath} className="ch-temp" />
      {t.dots.map((d) => (
        <g key={d.i}>
          {d.yFeels !== null ? <circle cx={d.x} cy={d.yFeels} r={4} className="ch-dot ch-dot--feels" /> : null}
          {d.yTemp !== null ? <circle cx={d.x} cy={d.yTemp} r={4} className="ch-dot ch-dot--temp" /> : null}
        </g>
      ))}
      {t.labels.map((l) => (
        <text key={`${l.series}-${l.i}`} x={l.x} y={l.y} className={l.series === 'feels' ? 'ch-val ch-val--feels' : 'ch-val'}>
          {l.text}
        </text>
      ))}
    </g>
  );
}

// ------------------------------------------------------------------------------------------ readout

function Readout({ row, units, tz }: { row: HourRow; units: UnitSystem; tz: string }) {
  const p = row.p;
  const comparison = feelsComparison(p.feelsLikeKind, p.tempC, p.feelsLikeC, units);
  const hasPrecipAmount = isNum(p.precipMm) && p.precipMm > 0.025;
  const hasSnow = isNum(p.snowMm) && p.snowMm > 0.05;
  return (
    <div className="readout" data-testid="readout" role="status" aria-live="polite">
      <div className="readout__head">
        <WxIcon icon={p.icon} day={p.isDaytime} size={30} />
        <div className="readout__title">
          <p className="readout__when">
            {formatWeekday(row.t, tz)} {formatHour(row.t, tz)}
          </p>
          <p className="readout__what">{p.shortForecast || ICON_LABELS[p.icon]}</p>
        </div>
        <div className="readout__temps">
          <p className="readout__temp num">
            <span className="sr-only">Temperature </span>
            {formatTemp(p.tempC, units)}
          </p>
          <p className="readout__feels num">
            Feels like {formatTemp(p.feelsLikeC ?? p.tempC, units)}
            {comparison ? <span className="readout__sub"> · {comparison}</span> : null}
          </p>
        </div>
      </div>
      <dl className="readout__grid">
        <div>
          <dt>
            <span className="sr-only">Precipitation</span>
            <span aria-hidden="true">Precip.</span>
          </dt>
          <dd className="num">
            {formatPercent(p.precipChancePct)}
            {hasSnow ? (
              <span className="readout__sub readout__sub--block">snow {formatSnow(p.snowMm, units)}</span>
            ) : hasPrecipAmount ? (
              <span className="readout__sub readout__sub--block">{formatPrecip(p.precipMm, units)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd className="num">
            {isNum(p.windDirDeg) ? (
              <>
                <IconWindArrow size={12} rotate={(p.windDirDeg + 180) % 360} className="readout__arrow" /> {compassPoint(p.windDirDeg)}{' '}
              </>
            ) : null}
            {formatWind(p.windKph, units)}
            {isNum(p.windGustKph) ? <span className="readout__sub readout__sub--block">gusts {formatWind(p.windGustKph, units)}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Humidity</dt>
          <dd className="num">
            {formatPercent(p.humidityPct)}
            {isNum(p.dewpointC) ? <span className="readout__sub readout__sub--block">dew point {formatTemp(p.dewpointC, units)}</span> : null}
          </dd>
        </div>
        <div>
          <dt>UV index</dt>
          <dd>{isNum(p.uvIndex) ? <UvBadge uv={p.uvIndex} /> : '—'}</dd>
        </div>
        <div className="readout__cell--wide">
          <dt>Air quality</dt>
          <dd>{isNum(p.aqi) ? <AqiBadge aqi={p.aqi} /> : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ text twin

function HourlyTable({ rows, units, tz }: { rows: readonly HourRow[]; units: UnitSystem; tz: string }) {
  // The visually-hidden class goes on a wrapper: browsers don't clip a <table> to 1px, and its
  // full nowrap width would otherwise widen the page (mobile Chrome then zooms the whole app out).
  return (
    <div className="sr-only">
      <table data-testid="hourly-table">
        <caption>Hourly forecast, every value shown on the chart</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Conditions</th>
            <th scope="col">Temperature</th>
            <th scope="col">Feels like</th>
            <th scope="col">Chance of precipitation</th>
            <th scope="col">Precipitation</th>
            <th scope="col">Wind</th>
            <th scope="col">Gusts</th>
            <th scope="col">UV index</th>
            <th scope="col">Air quality index</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <th scope="row">{formatDayClock(r.t, tz)}</th>
              <td>{r.p.shortForecast}</td>
              <td>{formatTemp(r.p.tempC, units)}</td>
              <td>{formatTemp(r.p.feelsLikeC, units)}</td>
              <td>{formatPercent(r.p.precipChancePct)}</td>
              <td>{isNum(r.p.snowMm) && r.p.snowMm > 0.05 ? `Snow ${formatSnow(r.p.snowMm, units)}` : formatPrecip(r.p.precipMm, units)}</td>
              <td>
                {isNum(r.p.windDirDeg) ? `${compassPoint(r.p.windDirDeg)} ` : ''}
                {formatWind(r.p.windKph, units)}
              </td>
              <td>{isNum(r.p.windGustKph) ? formatWind(r.p.windGustKph, units) : 'None'}</td>
              <td>{isNum(r.p.uvIndex) ? Math.round(r.p.uvIndex) : 'Unavailable'}</td>
              <td>{isNum(r.p.aqi) ? Math.round(r.p.aqi) : 'Unavailable'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
