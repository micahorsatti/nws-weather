import { useState } from 'react';
import type { WeatherBundle } from '../data/types';
import type { UnitSystem } from '../lib/units';
import { AirSheet } from './components/AirSheet';
import { AlertsBanner } from './components/AlertsBanner';
import { AlertsSheet } from './components/AlertsSheet';
import { DailyList } from './components/DailyList';
import { DetailTiles } from './components/DetailTiles';
import { DiscussionSheet } from './components/DiscussionSheet';
import type { DiscussionLoader } from './components/DiscussionSheet';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HourlyCard } from './components/HourlyCard';
import { RadarCard } from './components/RadarCard';
import { activeAlerts, currentView, futureHours, sunView, todayEntry, upcomingDays } from './lib/derive';
import { localDateKey, resolveZone } from './lib/time';

export interface WeatherScreenProps {
  bundle: WeatherBundle;
  /** The one clock for the screen (epoch ms). */
  now: number;
  units: UnitSystem;
  /** Fetches the forecaster discussion; injected so tests and mock mode don't touch the network. */
  loadDiscussion: DiscussionLoader;
}

type SheetName = 'alerts' | 'discussion' | 'air' | null;

/** Everything shown for a loaded bundle: alerts, hero, hourly chart, radar, detail tiles, 10-day list, footer. */
export function WeatherScreen({ bundle, now, units, loadDiscussion }: WeatherScreenProps) {
  const [sheet, setSheet] = useState<SheetName>(null);
  const tz = resolveZone(bundle.point.timeZone);
  const hours = futureHours(bundle.hourly, now);
  const current = currentView(bundle, now, hours);
  const today = todayEntry(bundle.daily, now, tz);
  const days = upcomingDays(bundle.daily, now, tz);
  const alerts = activeAlerts(bundle.alerts, now);
  const sun = sunView(bundle, now, tz);
  const aqiNow = bundle.airNow?.aqi ?? hours[0]?.aqi ?? null;
  const close = () => setSheet(null);

  return (
    <div className="screen" data-testid="screen">
      {alerts.length > 0 ? (
        <div className="slot slot--alerts">
          <AlertsBanner alerts={alerts} now={now} tz={tz} onOpen={() => setSheet('alerts')} />
        </div>
      ) : null}

      <div className="slot slot--hero">
        <Hero current={current} today={today} units={units} tz={tz} />
      </div>

      <div className="slot slot--hourly">
        <HourlyCard hourly={bundle.hourly} now={now} tz={tz} units={units} />
      </div>

      <div className="slot slot--radar">
        <RadarCard lat={bundle.place.lat} lon={bundle.place.lon} alerts={alerts} />
      </div>

      <div className="slot slot--tiles">
        <DetailTiles
          bundle={bundle}
          current={current}
          hours={hours}
          today={today}
          sun={sun}
          units={units}
          tz={tz}
          now={now}
          onOpenAir={() => setSheet('air')}
        />
      </div>

      <div className="slot slot--daily">
        <DailyList days={days} currentTempC={current?.tempC ?? null} units={units} tz={tz} now={now} onOpenDiscussion={() => setSheet('discussion')} />
      </div>

      <div className="slot slot--footer">
        <Footer problems={bundle.problems} />
      </div>

      {sheet === 'alerts' ? <AlertsSheet alerts={alerts} now={now} tz={tz} onClose={close} /> : null}
      {sheet === 'air' ? <AirSheet air={bundle.airNow} aqi={aqiNow} days={bundle.airForecast} todayKey={localDateKey(now, tz)} onClose={close} /> : null}
      {sheet === 'discussion' ? <DiscussionSheet wfo={bundle.point.wfo} tz={tz} load={loadDiscussion} onClose={close} /> : null}
    </div>
  );
}
