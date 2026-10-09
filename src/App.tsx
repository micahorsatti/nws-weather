import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { GPS_PLACE_ID, getCurrentPosition, loadForecastDiscussion, useWeather } from './data';
import type { Place, WeatherBundle, WeatherState } from './data';
import { clearCachedData } from './state/cache';
import { selectGps, setGpsName, usePlaces } from './state/places';
import { updateSettings, useSettings } from './state/settings';
import { useTheme } from './state/theme';
import { PlaceSheet } from './ui/components/PlaceSheet';
import { SettingsSheet } from './ui/components/SettingsSheet';
import { LoadingSkeleton, ErrorState } from './ui/components/StateScreens';
import { StatusBanner, TopBar } from './ui/components/TopBar';
import { Welcome } from './ui/components/Welcome';
import type { DiscussionLoader } from './ui/components/DiscussionSheet';
import { useNow, useOnline } from './ui/hooks';
import { formatAgo, formatClockMaybeDay, formatFull, parseTime, resolveZone } from './ui/lib/time';
import { WeatherScreen } from './ui/WeatherScreen';

// Development-only helpers. `import.meta.env.DEV` is replaced by `false` in production builds, so the
// dynamic imports below (and the mock fixtures / icon gallery behind them) never ship.
const IconGallery = import.meta.env.DEV ? lazy(() => import('./ui/dev/IconGallery')) : null;

interface DevMock {
  state: WeatherState;
  loadDiscussion: DiscussionLoader;
}

const MOCK_LOADING: WeatherState = { bundle: null, status: 'loading', refreshing: false, error: null, fromCache: false, refresh: () => {} };

/** `?mock=summer` or `?mock=winter` (dev only): render a generated bundle instead of calling the data layer. */
function useDevMock(): DevMock | null {
  const name = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock') : null;
  const [loaded, setLoaded] = useState<{ bundle: WeatherBundle; regenerate: () => WeatherBundle; discussion: DiscussionLoader } | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV || !name) return;
    let cancelled = false;
    void import('./mocks').then((m) => {
      if (cancelled || !m.isMockName(name)) return;
      const regenerate = () => m.getMockBundle(name);
      setLoaded({ bundle: regenerate(), regenerate, discussion: () => m.getMockDiscussion(name) });
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const refresh = useCallback(() => {
    setLoaded((cur) => (cur ? { ...cur, bundle: cur.regenerate() } : cur));
  }, []);

  if (!name) return null;
  return {
    state: loaded ? { bundle: loaded.bundle, status: 'ready', refreshing: false, error: null, fromCache: false, refresh } : MOCK_LOADING,
    loadDiscussion: loaded?.discussion ?? loadForecastDiscussion,
  };
}

/** Quietly refresh the saved GPS position at launch, but only if location permission was already granted. */
function useGpsRefreshOnLaunch(isGps: boolean): void {
  useEffect(() => {
    if (!isGps) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await navigator.permissions?.query({ name: 'geolocation' });
        if (status?.state !== 'granted') return;
        const pos = await getCurrentPosition();
        if (!cancelled) selectGps(pos.lat, pos.lon);
      } catch {
        /* keep the last known position */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Launch-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type SheetName = 'places' | 'settings' | null;

export default function App() {
  const settings = useSettings();
  useTheme(settings.theme);
  const places = usePlaces();
  const now = useNow(30_000);
  const online = useOnline();
  const dev = useDevMock();
  const [sheet, setSheet] = useState<SheetName>(null);

  const gallery = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gallery');

  const place: Place | null = dev ? null : places.selected;
  // The data layer refetches when the place object changes; a rename (GPS -> "Linn, KS") must not.
  const weatherPlace = useMemo(() => place, [place?.id, place?.lat, place?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useWeather(weatherPlace, { airNowKey: settings.airNowKey || undefined });
  const state = dev ? dev.state : live;
  useGpsRefreshOnLaunch(places.selected?.kind === 'gps');

  // Never show a previous place's forecast while the new one loads.
  const bundle = state.bundle && (dev || (place !== null && state.bundle.place.id === place.id)) ? state.bundle : null;
  const tz = bundle ? resolveZone(bundle.point.timeZone) : null;

  // Name the GPS place after the nearest city once the forecast tells us.
  const nearest = bundle && bundle.point.city ? `${bundle.point.city}${bundle.point.state ? `, ${bundle.point.state}` : ''}` : null;
  useEffect(() => {
    if (nearest && place?.kind === 'gps' && bundle?.place.id === GPS_PLACE_ID) setGpsName(nearest);
  }, [nearest, place?.kind, bundle?.place.id]);

  const placeName = dev ? (bundle?.place.name ?? 'Demo') : place ? (place.kind === 'gps' && nearest ? nearest : place.name) : null;
  useEffect(() => {
    document.title = placeName ? `${placeName} · NWS Weather` : 'NWS Weather';
  }, [placeName]);

  const fetchedAt = bundle ? parseTime(bundle.fetchedAt) : null;
  const updatedLabel = fetchedAt !== null ? `Updated ${formatAgo(fetchedAt, now)}` : state.status === 'loading' ? 'Updating…' : null;
  const updatedTitle = fetchedAt !== null && tz ? formatFull(fetchedAt, tz) : undefined;
  const sinceText = fetchedAt !== null && tz ? formatClockMaybeDay(fetchedAt, now, tz) : null;

  const loadDiscussion: DiscussionLoader = dev ? dev.loadDiscussion : loadForecastDiscussion;
  const hasPlace = dev !== null || place !== null;

  let body;
  if (gallery && IconGallery) {
    body = (
      <Suspense fallback={null}>
        <IconGallery />
      </Suspense>
    );
  } else if (!hasPlace) {
    body = <Welcome />;
  } else if (bundle) {
    body = <WeatherScreen bundle={bundle} now={now} units={settings.units} loadDiscussion={loadDiscussion} />;
  } else if (state.status === 'error' && state.error) {
    body = <ErrorState kind={state.error.kind} detail={state.error.message} onRetry={state.refresh} onChangePlace={() => setSheet('places')} />;
  } else {
    body = <LoadingSkeleton />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the forecast
      </a>
      <TopBar
        title={hasPlace ? placeName : null}
        updatedLabel={updatedLabel}
        updatedTitle={updatedTitle}
        refreshing={state.refreshing}
        onOpenPlaces={() => setSheet('places')}
        onRefresh={hasPlace ? state.refresh : null}
        onOpenSettings={() => setSheet('settings')}
      />

      {bundle && !online ? (
        <StatusBanner tone="offline">{`You’re offline — showing data from ${sinceText ?? 'earlier'}`}</StatusBanner>
      ) : bundle && state.error ? (
        <StatusBanner tone="error" onRetry={state.refresh}>{`Couldn’t refresh — showing data from ${sinceText ?? 'earlier'}`}</StatusBanner>
      ) : null}

      <main id="main" className="page" tabIndex={-1}>
        {body}
      </main>

      {sheet === 'places' ? <PlaceSheet places={places} currentName={placeName} onClose={() => setSheet(null)} /> : null}
      {sheet === 'settings' ? (
        <SettingsSheet
          settings={settings}
          onChange={updateSettings}
          onClearCache={async () => {
            await clearCachedData();
            state.refresh();
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
