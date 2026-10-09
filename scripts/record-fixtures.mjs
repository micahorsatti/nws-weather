#!/usr/bin/env node
/**
 * Records real API responses into src/data/__fixtures__/ so the data-layer tests can replay them
 * offline (see src/data/testing/fixtures.ts for the replay router).
 *
 *   node scripts/record-fixtures.mjs            # all locations
 *   node scripts/record-fixtures.mjs linn-ks    # only the named slugs
 *
 * One JSON file per location: { slug, name, lat, lon, recordedAt, responses: { <key>: { status, body } } }.
 * Grid data is trimmed to the layers the app uses and numbers are rounded to 3 decimals so the whole
 * set stays well under ~1.5 MB. Nothing here needs a secret: AirNow is never recorded (it needs the
 * user's key) — its fixtures are hand-written in src/data/airnow.test.ts.
 *
 * The Open-Meteo URLs below must stay in step with src/data/openMeteo.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', '__fixtures__');

const LOCATIONS = [
  { slug: 'linn-ks', name: 'Linn, KS', lat: 39.7456, lon: -97.0892 },
  { slug: 'phoenix-az', name: 'Phoenix, AZ', lat: 33.4484, lon: -112.074 },
  { slug: 'utqiagvik-ak', name: 'Utqiagvik, AK', lat: 71.2906, lon: -156.7886 },
  { slug: 'san-juan-pr', name: 'San Juan, PR', lat: 18.4655, lon: -66.1057 },
  { slug: 'toronto-out-of-coverage', name: 'Toronto, ON', lat: 43.6532, lon: -79.3832 },
];

const GRID_LAYERS = [
  'temperature',
  'dewpoint',
  'relativeHumidity',
  'apparentTemperature',
  'heatIndex',
  'windChill',
  'skyCover',
  'windDirection',
  'windSpeed',
  'windGust',
  'probabilityOfPrecipitation',
  'quantitativePrecipitation',
  'snowfallAmount',
  'probabilityOfThunder',
  'maxTemperature',
  'minTemperature',
];

const NWS = 'https://api.weather.gov';
const GFS_DAILY =
  'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,' +
  'precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,' +
  'wind_direction_10m_dominant,uv_index_max';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with retries on 5xx/network errors. Returns { status, body } and never throws for 4xx. */
async function getJson(url, accept) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, accept ? { headers: { Accept: accept } } : undefined);
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (res.status >= 500) {
        last = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        return { status: res.status, body };
      }
    } catch (err) {
      last = err;
    }
    await sleep(600 * (attempt + 1));
  }
  throw last;
}

const nws = (url) => getJson(url, 'application/geo+json');

const round3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

function trimPoints(body) {
  if (!body || typeof body !== 'object' || !body.properties) return body;
  const { astronomicalData: _a, nwr: _n, ...rest } = body.properties;
  return { ...body, '@context': undefined, properties: rest };
}

function trimForecast(body) {
  const p = body.properties;
  return {
    properties: { units: p.units, generatedAt: p.generatedAt, updateTime: p.updateTime, periods: p.periods },
  };
}

function trimHourly(body) {
  const p = body.properties;
  const periods = p.periods.map(({ number: _n, name: _nm, temperatureTrend: _t, detailedForecast: _d, ...rest }) => rest);
  return { properties: { generatedAt: p.generatedAt, updateTime: p.updateTime, periods } };
}

function trimGrid(body) {
  const p = body.properties;
  const out = {
    updateTime: p.updateTime,
    validTimes: p.validTimes,
    elevation: p.elevation,
    gridId: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
  };
  for (const name of GRID_LAYERS) {
    const layer = p[name];
    if (!layer || !Array.isArray(layer.values)) continue;
    out[name] = {
      uom: layer.uom,
      values: layer.values.map((v) => ({ validTime: v.validTime, value: round3(v.value) })),
    };
  }
  return { properties: out };
}

function trimStations(body) {
  const features = (body.features ?? []).slice(0, 6).map((f) => ({
    id: f.id,
    type: f.type,
    properties: {
      '@id': f.properties?.['@id'],
      stationIdentifier: f.properties?.stationIdentifier,
      name: f.properties?.name,
      timeZone: f.properties?.timeZone,
    },
  }));
  return { type: 'FeatureCollection', features };
}

function trimObservation(body) {
  if (!body || typeof body !== 'object' || !body.properties) return body;
  const {
    '@context': _c,
    elevation: _e,
    maxTemperatureLast24Hours: _a,
    minTemperatureLast24Hours: _b,
    precipitationLastHour: _p1,
    precipitationLast3Hours: _p3,
    precipitationLast6Hours: _p6,
    cloudLayers: _cl,
    rawMessage: _r,
    ...rest
  } = body.properties;
  return { ...body, '@context': undefined, properties: rest };
}

function trimAlerts(body) {
  if (!body || !Array.isArray(body.features)) return body;
  const features = body.features.slice(0, 5).map((f) => {
    const { geocode: _g, affectedZones: _z, references: _r, parameters: _p, ...props } = f.properties ?? {};
    return { ...f, properties: props };
  });
  return { type: 'FeatureCollection', title: body.title, updated: body.updated, features };
}

async function record(loc) {
  const { slug, lat, lon } = loc;
  const tag = `[${slug}]`;
  const responses = {};
  const log = (msg) => console.log(`${tag} ${msg}`);

  const pointsRes = await nws(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  responses.points = { status: pointsRes.status, body: trimPoints(pointsRes.body) };
  log(`points -> ${pointsRes.status}`);
  if (pointsRes.status !== 200) return { ...loc, recordedAt: new Date().toISOString(), responses };

  const props = pointsRes.body.properties;
  const wfo = props.gridId;
  const tz = props.timeZone;
  const base = `${NWS}/gridpoints/${wfo}/${props.gridX},${props.gridY}`;

  const [forecast, hourly, grid, stations, alerts, afdList, gfs, aq] = await Promise.all([
    nws(props.forecast ?? `${base}/forecast`),
    nws(props.forecastHourly ?? `${base}/forecast/hourly`),
    nws(props.forecastGridData ?? base),
    nws(props.observationStations ?? `${base}/stations`),
    nws(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`),
    nws(`${NWS}/products/types/AFD/locations/${wfo}`),
    getJson(
      `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}&daily=${GFS_DAILY}` +
        `&hourly=uv_index&forecast_days=11&timezone=${encodeURIComponent(tz)}&timeformat=unixtime`,
    ),
    getJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&hourly=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone&current=us_aqi&timezone=${encodeURIComponent(tz)}` +
        `&timeformat=unixtime&forecast_days=5`,
    ),
  ]);

  responses.forecast = { status: forecast.status, body: forecast.status === 200 ? trimForecast(forecast.body) : forecast.body };
  responses.hourly = { status: hourly.status, body: hourly.status === 200 ? trimHourly(hourly.body) : hourly.body };
  responses.grid = { status: grid.status, body: grid.status === 200 ? trimGrid(grid.body) : grid.body };
  responses.stations = { status: stations.status, body: stations.status === 200 ? trimStations(stations.body) : stations.body };
  responses.alerts = { status: alerts.status, body: alerts.status === 200 ? trimAlerts(alerts.body) : alerts.body };
  responses.gfs = { status: gfs.status, body: gfs.body };
  responses.aq = { status: aq.status, body: aq.body };
  log(
    `forecast ${forecast.status}, hourly ${hourly.status}, grid ${grid.status}, stations ${stations.status}, ` +
      `alerts ${alerts.status}, gfs ${gfs.status}, aq ${aq.status}`,
  );

  // Latest observations from the nearest few stations (the app tries them in order).
  responses.observations = {};
  if (stations.status === 200) {
    for (const f of (stations.body.features ?? []).slice(0, 3)) {
      const id = f.properties?.stationIdentifier;
      if (!id) continue;
      const obs = await nws(`${NWS}/stations/${id}/observations/latest`);
      responses.observations[id] = { status: obs.status, body: obs.status === 200 ? trimObservation(obs.body) : obs.body };
      log(`observation ${id} -> ${obs.status}`);
    }
  }

  // Area Forecast Discussion: list, then the newest product.
  const graph = afdList.status === 200 ? (afdList.body['@graph'] ?? []) : [];
  responses.afdList = {
    status: afdList.status,
    body: afdList.status === 200 ? { '@graph': graph.slice(0, 3) } : afdList.body,
  };
  if (graph[0]?.id) {
    const afd = await nws(`${NWS}/products/${graph[0].id}`);
    responses.afd = {
      status: afd.status,
      body:
        afd.status === 200
          ? { id: afd.body.id, issuingOffice: afd.body.issuingOffice, issuanceTime: afd.body.issuanceTime, productText: afd.body.productText }
          : afd.body,
    };
    log(`afd ${wfo} -> ${afd.status}`);
  }

  return { ...loc, recordedAt: new Date().toISOString(), responses };
}

async function main() {
  const only = new Set(process.argv.slice(2));
  await mkdir(OUT_DIR, { recursive: true });
  let total = 0;
  for (const loc of LOCATIONS) {
    if (only.size && !only.has(loc.slug)) continue;
    const result = await record(loc);
    const json = JSON.stringify(result);
    total += json.length;
    await writeFile(join(OUT_DIR, `${loc.slug}.json`), json + '\n', 'utf8');
    console.log(`[${loc.slug}] wrote ${(json.length / 1024).toFixed(0)} KB`);
  }
  console.log(`Total ${(total / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
