/**
 * DEV ONLY harness for RadarView (served by radar-preview.html; never part of the production build).
 * Mimics how the app uses it: lazy-loaded, rendered over the page, inside React.StrictMode.
 */
import { StrictMode, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import '../../styles/global.css';
import type { AlertGeometry, AlertSeverity, WeatherAlert } from '../../data/types';

const RadarView = lazy(() => import('./RadarView'));

type ThemeChoice = 'light' | 'dark' | 'system';

const PLACES: Record<string, { label: string; lat: number; lon: number }> = {
  linn: { label: 'Linn, KS', lat: 39.678, lon: -96.952 },
  seattle: { label: 'Seattle', lat: 47.606, lon: -122.332 },
  miami: { label: 'Miami', lat: 25.762, lon: -80.192 },
  honolulu: { label: 'Honolulu', lat: 21.307, lon: -157.858 },
  anchorage: { label: 'Anchorage', lat: 61.218, lon: -149.9 },
  sanjuan: { label: 'San Juan, PR', lat: 18.466, lon: -66.106 },
  guam: { label: 'Guam', lat: 13.444, lon: 144.794 },
  pagopago: { label: 'Pago Pago (no coverage)', lat: -14.275, lon: -170.702 },
};

function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    delete root.dataset.theme;
    root.style.removeProperty('color-scheme');
  } else {
    root.dataset.theme = choice;
    root.style.colorScheme = choice;
  }
}

// --- failure simulation (?fail=caps,wmstiles,mesonet or all) ---------------------------------------------

function installFailures(spec: string): void {
  const kinds = new Set(spec.split(',').map((s) => s.trim()));
  const all = kinds.has('all');
  if (all || kinds.has('caps')) {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('GetCapabilities')) return Promise.reject(new TypeError('Failed to fetch (simulated)'));
      return realFetch(input, init);
    };
  }
  const failTiles = (url: string) =>
    ((all || kinds.has('wmstiles')) && url.includes('opengeo.ncep.noaa.gov') && url.includes('GetMap')) ||
    ((all || kinds.has('mesonet')) && url.includes('mesonet.agron.iastate.edu'));
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (desc?.set && (all || kinds.has('wmstiles') || kinds.has('mesonet'))) {
    const set = desc.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...desc,
      set(this: HTMLImageElement, value: string) {
        set.call(this, failTiles(String(value)) ? 'data:text/plain;base64,AAAA' : value); // not an image: onerror fires
      },
    });
  }
}

/** ?reduced=1 makes `(prefers-reduced-motion: reduce)` match, to exercise the paused-by-default path. */
function installReducedMotion(): void {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList =>
    query.includes('prefers-reduced-motion')
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList)
      : real(query);
}

// --- sample alerts ---------------------------------------------------------------------------------------

function ring(lat: number, lon: number, dLat: number, dLon: number): number[][] {
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

function makeAlerts(lat: number, lon: number): WeatherAlert[] {
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  const alert = (id: string, event: string, severity: AlertSeverity, expires: string, geometry: AlertGeometry | null): WeatherAlert => ({
    id,
    event,
    headline: event,
    severity,
    urgency: 'Immediate',
    certainty: 'Likely',
    effective: null,
    onset: null,
    expires,
    ends: null,
    areaDesc: 'Sample area',
    senderName: 'NWS (harness)',
    description: '',
    instruction: null,
    url: null,
    geometry,
  });
  return [
    alert('h-1', 'Tornado Warning', 'Extreme', inMinutes(40), { type: 'Polygon', coordinates: [ring(lat + 0.05, lon + 0.05, 0.22, 0.28)] }),
    alert('h-2', 'Severe Thunderstorm Warning', 'Severe', inMinutes(75), { type: 'Polygon', coordinates: [ring(lat - 0.05, lon - 0.3, 0.45, 0.4)] }),
    alert('h-3', 'Flood Watch', 'Moderate', inMinutes(60 * 6), {
      type: 'MultiPolygon',
      coordinates: [[ring(lat - 0.7, lon + 0.2, 0.25, 0.35)], [ring(lat - 0.7, lon - 0.7, 0.2, 0.25)]],
    }),
    alert('h-4', 'Frost Advisory', 'Minor', inMinutes(60 * 20), { type: 'Polygon', coordinates: [ring(lat + 0.8, lon - 0.2, 0.3, 0.6)] }),
    alert('h-5', 'Special Weather Statement (no polygon)', 'Minor', inMinutes(30), null),
    alert('h-6', 'Already ended (must not be drawn)', 'Severe', inMinutes(-30), { type: 'Polygon', coordinates: [ring(lat, lon, 0.1, 0.1)] }),
  ];
}

// --- the page --------------------------------------------------------------------------------------------

const num = (v: string | null, fallback: number) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

const query = new URLSearchParams(window.location.search);
installFailures(query.get('fail') ?? '');
if (query.get('reduced') === '1') installReducedMotion();

function Harness() {
  const [place, setPlace] = useState({ lat: num(query.get('lat'), PLACES.linn.lat), lon: num(query.get('lon'), PLACES.linn.lon) });
  const [theme, setTheme] = useState<ThemeChoice>((query.get('theme') as ThemeChoice | null) ?? 'light');
  const [alertsOn, setAlertsOn] = useState(query.get('alerts') !== '0');
  const [open, setOpen] = useState(query.get('open') !== '0');

  useEffect(() => applyTheme(theme), [theme]);

  // A new array on every parent render is what a naive caller would do; the view must cope.
  const alerts = useMemo(() => (alertsOn ? makeAlerts(place.lat, place.lon) : []), [alertsOn, place]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement)) toggleTheme();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTheme]);

  // Handles for driving the harness from the browser console or automation.
  useEffect(() => {
    Object.assign(window, { radarPreview: { setTheme, setPlace, setOpen, setAlertsOn } });
  }, []);

  return (
    <main style={{ padding: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>Radar preview (dev harness)</h1>
      <p style={{ color: 'var(--ink-2)' }}>
        Location {place.lat.toFixed(3)}, {place.lon.toFixed(3)} · theme {theme} · press <kbd>t</kbd> to toggle the theme.
      </p>
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={btn} onClick={() => setOpen(true)} id="open-radar">
          Open radar
        </button>
        {(['light', 'dark', 'system'] as const).map((t) => (
          <button key={t} type="button" style={{ ...btn, fontWeight: theme === t ? 700 : 400 }} onClick={() => setTheme(t)}>
            {t}
          </button>
        ))}
        <button type="button" style={btn} onClick={() => setAlertsOn((v) => !v)}>
          alerts: {alertsOn ? 'on' : 'off'}
        </button>
      </p>
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(PLACES).map(([key, p]) => (
          <button key={key} type="button" style={btn} onClick={() => setPlace({ lat: p.lat, lon: p.lon })}>
            {p.label}
          </button>
        ))}
      </p>
      {open && (
        <Suspense fallback={null}>
          <RadarView lat={place.lat} lon={place.lon} alerts={alerts} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}

const btn = {
  minHeight: 44,
  padding: '0 14px',
  border: '1px solid var(--line-strong)',
  borderRadius: 10,
  background: 'var(--surface)',
  color: 'var(--ink)',
} as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
