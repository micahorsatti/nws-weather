# NWS Weather — project guide

Installable PWA (React 19 + Vite 8 + TypeScript 7 + vite-plugin-pwa 2) showing National Weather
Service data: current conditions, hourly, 10-day, "Feels like", precipitation, wind, UV, AQI,
severe-weather alerts, radar, sunrise/sunset and the forecasters' written text.
Static site only — no server. Hosted on GitHub Pages at `https://micahorsatti.github.io/nws-weather/`
(Vite `base: '/nws-weather/'`). Public repo `micahorsatti/nws-weather` — never commit secrets.

## Commands
- `npm run dev` — dev server at http://localhost:5173/nws-weather/
- `npm run typecheck` — tsc on tsconfig.json (app) and tsconfig.node.json (vite.config.ts)
- `npm test` — Vitest (node environment by default; UI tests opt into jsdom with a
  `// @vitest-environment jsdom` docblock). Run a subset with `npx vitest run src/data`.
- `npm run build` — typecheck + production build into `dist/`
- `npm run icons` — regenerate PWA icons from `public/favicon.svg` (pwa-assets.config.ts)

## Architecture
- `src/data/types.ts` — **the data contract**. Canonical units: °C, km/h, mm, Pa, m. Times are ISO
  strings with offsets; dates are `YYYY-MM-DD` in the *location's* time zone (`PointInfo.timeZone`),
  never the device's. Missing values are `null`.
- `src/data/index.ts` — the only module the UI imports from the data layer
  (`useWeather`, `loadWeather`, `searchPlaces`, `getCurrentPosition`, `loadForecastDiscussion`).
- `src/lib/units.ts`, `src/lib/scales.ts` — display conversion/formatting and AQI/UV categories.
- `src/ui/**` — screens and components; `src/state/**` — settings and saved places (localStorage).
- `src/features/radar/**` — radar map (Leaflet), lazy-loaded by the UI.

## Data sources (all verified to allow browser CORS, no key unless noted)
| Data | Source |
|---|---|
| Point metadata, 7-day day/night periods + forecaster text, hourly, raw grid layers, observations, alerts, AFD | `api.weather.gov` |
| Days 8–10 (extended outlook), hourly UV | Open-Meteo GFS `api.open-meteo.com/v1/gfs` (NOAA GFS model) |
| Hourly US AQI forecast; AQI fallback | Open-Meteo `air-quality-api.open-meteo.com/v1/air-quality` |
| Current AQI + daily AQI forecast (official) | EPA AirNow `www.airnowapi.org` — needs the user's free key, entered in Settings, stored only in localStorage |
| Place search (city or ZIP) | Open-Meteo geocoding `geocoding-api.open-meteo.com/v1/search?countryCode=US` |
| Radar | NWS MRMS WMS `opengeo.ncep.noaa.gov/geoserver/{conus,alaska,hawaii,carib,guam}/..._bref_qcd/ows` (TIME dimension) |
| Basemap | CARTO `{a-d}.basemaps.cartocdn.com/{light_all,dark_all}` (attribution: © OpenStreetMap contributors © CARTO) |
| Sunrise/sunset | computed on device with `suncalc` |

## Product rules
- Heat index and wind chill are always labeled **"Feels like"** in the UI.
- Days 8–10 come from the GFS model and must be visibly marked as an extended outlook (lower confidence).
- The AirNow key is never committed, bundled, or logged.
- Robustness first: NWS returns intermittent 5xx and null observation fields. Retry, fall back, and
  show partial data rather than an error screen.

## Conventions
- Strict TypeScript, `verbatimModuleSyntax` (use `import type` for types), no `any` without a reason.
- No new runtime dependencies without a strong reason (bundle size matters for a PWA).
- The repo lives in OneDrive: if a file operation fails with EBUSY/EPERM, wait a moment and retry.
- AI daily synopsis (Claude Haiku 5.5) is deferred to a later phase; it will need a server-side key proxy.
