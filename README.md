# NWS Weather

An installable web app (PWA) for National Weather Service forecasts.

**Live app:** https://micahorsatti.github.io/nws-weather/

## What it shows

- Current conditions and an hourly chart
- 10-day forecast. Days 1–7 come from the National Weather Service; days 8–10 come from NOAA's GFS model and are labeled as an extended outlook
- "Feels like" temperature (heat index or wind chill)
- Precipitation, wind and UV index
- Air quality (US AQI)
- Severe weather alerts
- Animated radar
- Sunrise and sunset
- The forecasters' written discussion

## Install

Installing puts the app on your home screen or dock. It opens in its own window, without the browser's address bar.

- **Android (Chrome):** open the app, tap the three-dot menu (⋮), then **Install app** or **Add to Home screen**.
- **iPhone or iPad (Safari):** open the app in Safari, tap **Share**, then **Add to Home Screen**.
- **Desktop (Chrome or Edge):** click the install icon at the right end of the address bar.

## Optional: an AirNow key for official air quality

Without a key, air quality comes from model estimates. With a free AirNow key, the app also shows official EPA monitor readings and daily AQI forecasts.

1. Sign up for a free key at https://docs.airnowapi.org/account/request/
2. Open **Settings** in the app and paste the key.

The key is stored only on your device, and the app uses it only to request data from AirNow.

## Data sources and attribution

| Data | Source |
|---|---|
| Forecasts, hourly data, observations, alerts, forecast discussions | National Weather Service, `api.weather.gov` |
| Days 8–10 extended outlook (NOAA GFS model), UV index, place search | Open-Meteo, [open-meteo.com](https://open-meteo.com), licensed CC BY 4.0 |
| Air-quality model estimates | Open-Meteo, using the Copernicus CAMS model |
| Radar | NOAA MRMS, via `opengeo.ncep.noaa.gov` |
| Official air quality (optional key) | EPA AirNow |
| Map basemap | Esri Light/Dark Gray Canvas — Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community |

This is an independent app and is not an official National Weather Service product. For life-safety decisions, rely on official NWS warnings and your local authorities.

## Development

Requires Node.js 24.

```sh
npm install
npm run dev        # http://localhost:5173/nws-weather/
npm test           # Vitest
npm run typecheck
npm run build      # typecheck and production build into dist/
npm run icons      # regenerate PWA icons from public/favicon.svg
```

In dev, add `?mock=summer` or `?mock=winter` to the URL to use built-in sample data instead of live feeds.

### Architecture

- `src/data`: the data layer. `types.ts` is the contract: units are °C, km/h, mm, Pa and m; times are ISO strings with offsets; dates are `YYYY-MM-DD` in the location's time zone; missing values are `null`. The UI imports only from `src/data/index.ts`.
- `src/ui`: screens and components.
- `src/features/radar`: the radar map, built on Leaflet and loaded only when it is opened.
- `src/state`: settings and saved places, stored in the browser's localStorage.
- `src/lib`: unit conversion, formatting, and AQI and UV categories.

### Deployment

The app is a static site with no server. Pushing to `main` builds it and deploys it to GitHub Pages through `.github/workflows/deploy.yml`. Every push and pull request also runs typechecks, tests, a build, and a scan of tracked files for accidental secrets (`.github/workflows/ci.yml`).

## Roadmap

- **AI daily synopsis** written with Claude Haiku 5.5. The API key must stay secret, so the feature will go through a small server-side proxy.
- **Home-screen widget** through a native wrapper.
