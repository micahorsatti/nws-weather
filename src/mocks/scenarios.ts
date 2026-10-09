/** The two mock scenarios: a hot, humid, stormy day in Kansas and a windy, snowy day in Montana. */
import type { AirQualityDay, ForecastDiscussion, WeatherAlert } from '../data/types';
import { placeIdFor } from '../data/types';
import { aqiCategory } from '../lib/scales';
import { addDaysToKey, HOUR_MS, isoInZone, localHour, zonedToMs } from '../ui/lib/time';
import { bump, hardWrap } from './model';
import type { Scenario, ScenarioCtx, Storm } from './generate';

const MIN = 60_000;

function zoneAbbr(ms: number, tz: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

/** "October 8 at 8:31PM CDT" — the NWS headline style. */
function nwsStamp(ms: number, tz: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o });
  const month = f({ month: 'long' }).format(ms);
  const day = f({ day: 'numeric' }).format(ms);
  const time = f({ hour: 'numeric', minute: '2-digit' }).format(ms).replace(/\s/g, '');
  return `${month} ${day} at ${time} ${zoneAbbr(ms, tz)}`;
}

/** "831 PM CDT" — the style used inside warning text and discussions. */
function bareTime(ms: number, tz: string): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).formatToParts(ms);
  const h = f.find((p) => p.type === 'hour')?.value ?? '';
  const m = f.find((p) => p.type === 'minute')?.value ?? '';
  const ap = f.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return `${h}${m} ${ap} ${zoneAbbr(ms, tz)}`;
}

function afdHeader(ctx: ScenarioCtx, office: string, officeName: string, cwa: string): string {
  const d = new Date(ctx.now - 25 * MIN);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: ctx.tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(/\D/g, '');
  return [
    '000',
    `FXUS6${office === 'TOP' ? '3' : '5'} K${office} ${stamp}`,
    `AFD${office}`,
    '',
    'Area Forecast Discussion',
    `National Weather Service ${officeName} ${cwa}`,
    `${bareTime(d.getTime(), ctx.tz)} ${date}`,
    '',
  ].join('\n');
}

function aqiCategoryNumber(aqi: number): number {
  return ['good', 'moderate', 'usg', 'unhealthy', 'very-unhealthy', 'hazardous'].indexOf(aqiCategory(aqi)) + 1;
}

// ------------------------------------------------------------------------------------------ summer

function summerStorms(ctx: ScenarioCtx): Storm[] {
  const at = (day: number, hour: number) => zonedToMs(ctx.dayKeys[day], hour, 0, ctx.tz);
  return [
    { center: ctx.now + 90 * MIN, widthH: 1.6, intensity: 1, type: 'thunder', severe: true },
    { center: at(1, 18), widthH: 2.4, intensity: 0.7, type: 'thunder' },
    { center: at(2, 17), widthH: 2.2, intensity: 0.55, type: 'thunder' },
    { center: at(3, 14), widthH: 3.5, intensity: 0.85, type: 'thunder' },
    { center: at(3, 22), widthH: 5, intensity: 0.8, type: 'rain' },
    { center: at(6, 15), widthH: 2, intensity: 0.4, type: 'thunder' },
    { center: at(8, 18), widthH: 3, intensity: 0.5, type: 'thunder' },
    { center: at(9, 16), widthH: 3, intensity: 0.5, type: 'thunder' },
  ];
}

function summerAlerts(ctx: ScenarioCtx): WeatherAlert[] {
  const { now, tz } = ctx;
  const svrIssued = now - 12 * MIN;
  const svrExpires = now + 48 * MIN;
  const floodExpires = now + 14 * 60 * MIN;
  const heatExpires = now + 9 * 60 * MIN;
  const svrDescription = hardWrap(
    [
      `At ${bareTime(svrIssued, tz)}, a severe thunderstorm was located 6 miles south of Linn, moving northeast at 35 mph.`,
      '',
      'HAZARD...70 mph wind gusts and quarter size hail.',
      '',
      'SOURCE...Radar indicated.',
      '',
      'IMPACT...Hail damage to vehicles is expected. Expect considerable tree damage. Wind damage is also likely to mobile homes, roofs, and outbuildings.',
      '',
      'Locations impacted include...',
      'Linn, Greenleaf, Hanover, Barnes, Haddam, Palmer, Morrowville and Washington.',
    ].join('\n'),
  );
  const svrInstruction = hardWrap(
    [
      'For your protection move to an interior room on the lowest floor of a building.',
      '',
      'Large hail and damaging winds and continuous cloud to ground lightning is occurring with this storm. Move indoors immediately. Lightning is one of the leading causes of weather related deaths in the United States. If you hear thunder, you are likely within striking distance of the storm.',
      '',
      'To report severe weather, contact your nearest law enforcement agency. They will relay your report to the National Weather Service Topeka.',
    ].join('\n'),
  );
  return [
    {
      id: 'urn:oid:2.49.0.1.840.0.mock.001',
      event: 'Severe Thunderstorm Warning',
      headline: `Severe Thunderstorm Warning issued ${nwsStamp(svrIssued, tz)} until ${nwsStamp(svrExpires, tz)} by NWS Topeka KS`,
      severity: 'Severe',
      urgency: 'Immediate',
      certainty: 'Observed',
      effective: isoInZone(svrIssued, tz),
      onset: isoInZone(svrIssued, tz),
      expires: isoInZone(svrExpires, tz),
      ends: null,
      areaDesc: 'Washington, KS; Republic, KS; Marshall, KS',
      senderName: 'NWS Topeka KS',
      description: svrDescription,
      instruction: svrInstruction,
      url: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.mock.001',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-97.12, 39.52],
            [-96.74, 39.46],
            [-96.55, 39.78],
            [-96.7, 40.02],
            [-97.08, 39.96],
            [-97.12, 39.52],
          ],
        ],
      },
    },
    {
      id: 'urn:oid:2.49.0.1.840.0.mock.002',
      event: 'Flood Watch',
      headline: `Flood Watch in effect until ${nwsStamp(floodExpires, tz)}`,
      severity: 'Moderate',
      urgency: 'Future',
      certainty: 'Possible',
      effective: isoInZone(now - 3 * 60 * MIN, tz),
      onset: isoInZone(now + 5 * 60 * MIN, tz),
      expires: isoInZone(floodExpires, tz),
      ends: isoInZone(floodExpires, tz),
      areaDesc: 'Washington, KS; Republic, KS; Marshall, KS; Riley, KS',
      senderName: 'NWS Topeka KS',
      description: hardWrap(
        [
          '* WHAT...Flash flooding caused by excessive rainfall is possible.',
          '',
          '* WHERE...Portions of north central and northeast Kansas, including the following counties, in north central Kansas, Republic and Washington. In northeast Kansas, Marshall and Riley.',
          '',
          '* WHEN...From late tonight through Friday morning.',
          '',
          '* IMPACTS...Excessive runoff may result in flooding of rivers, creeks, streams, and other low-lying and flood-prone locations. Extensive street flooding and flooding of creeks and ditches may begin quickly.',
          '',
          '* ADDITIONAL DETAILS...',
          '- Widespread rainfall amounts of 2 to 3 inches are expected, with locally higher amounts possible in slow-moving thunderstorms.',
        ].join('\n'),
      ),
      instruction: hardWrap(
        'You should monitor later forecasts and be alert for possible Flood Warnings. Those living in areas prone to flooding should be prepared to take action should flooding develop.',
      ),
      url: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.mock.002',
      geometry: null,
    },
    {
      id: 'urn:oid:2.49.0.1.840.0.mock.003',
      event: 'Heat Advisory',
      headline: `Heat Advisory in effect until ${nwsStamp(heatExpires, tz)}`,
      severity: 'Minor',
      urgency: 'Expected',
      certainty: 'Likely',
      effective: isoInZone(now - 20 * 60 * MIN, tz),
      onset: isoInZone(now - 20 * 60 * MIN, tz),
      expires: isoInZone(heatExpires, tz),
      ends: isoInZone(heatExpires, tz),
      areaDesc: 'Washington, KS; Republic, KS; Riley, KS; Pottawatomie, KS',
      senderName: 'NWS Topeka KS',
      description: hardWrap(
        [
          '* WHAT...Heat index values up to 105 expected.',
          '',
          '* WHERE...Portions of north central and northeast Kansas.',
          '',
          '* WHEN...Until 8 PM CDT this evening.',
          '',
          '* IMPACTS...Hot temperatures and high humidity may cause heat illnesses.',
        ].join('\n'),
      ),
      instruction: hardWrap(
        'Drink plenty of fluids, stay in an air-conditioned room, stay out of the sun, and check up on relatives and neighbors.\n\nTake extra precautions when outside. Wear lightweight and loose fitting clothing. Take action when you see the symptoms of heat exhaustion and heat stroke.',
      ),
      url: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.mock.003',
      geometry: null,
    },
  ];
}

export const SUMMER: Scenario = {
  name: 'summer',
  place: { id: placeIdFor(39.6797, -96.9064), name: 'Linn, KS', lat: 39.6797, lon: -96.9064, kind: 'saved' },
  point: {
    wfo: 'TOP',
    gridX: 52,
    gridY: 87,
    timeZone: 'America/Chicago',
    city: 'Linn',
    state: 'KS',
    radarStation: 'KTWX',
    forecastZone: 'KSZ009',
    county: 'KSC201',
  },
  sunrise: [6, 12],
  sunset: [20, 42],
  noonAltDeg: 71,
  uvClear: 11.5,
  slr: 10,
  days: [
    { hiF: 94, loF: 76, dewF: 73, cloud: 40, precip: 20, windKph: 22, dir: 195 },
    { hiF: 92, loF: 75, dewF: 73, cloud: 45, precip: 30, windKph: 20, dir: 190 },
    { hiF: 90, loF: 73, dewF: 72, cloud: 55, precip: 35, windKph: 18, dir: 180 },
    { hiF: 86, loF: 68, dewF: 70, cloud: 70, precip: 45, windKph: 24, dir: 150 },
    { hiF: 81, loF: 62, dewF: 58, cloud: 30, precip: 10, windKph: 20, dir: 340 },
    { hiF: 84, loF: 61, dewF: 56, cloud: 20, precip: 5, windKph: 14, dir: 10 },
    { hiF: 88, loF: 66, dewF: 62, cloud: 30, precip: 10, windKph: 14, dir: 120 },
    { hiF: 91, loF: 70, dewF: 66, cloud: 35, precip: 15, windKph: 18, dir: 190 },
    { hiF: 93, loF: 73, dewF: 70, cloud: 45, precip: 25, windKph: 20, dir: 195 },
    { hiF: 90, loF: 72, dewF: 70, cloud: 50, precip: 35, windKph: 18, dir: 200 },
  ],
  storms: summerStorms,
  station: { id: 'KMHK', name: 'Manhattan Regional Airport' },
  pressurePa: 100_950,
  visibilityM: 16_093,
  aqiAt(ctx, t) {
    const hour = localHour(t, ctx.tz);
    const hour0 = localHour(ctx.hourStart, ctx.tz);
    const shape = (h: number) => bump(h, 16, 3.6) + 0.25 * bump(h, 10, 2.5);
    const dayIdx = (t - ctx.hourStart) / (24 * HOUR_MS);
    const base = dayIdx < 3 ? 112 - 6 * Math.max(0, dayIdx) : 64;
    return base + 24 * (shape(hour) - shape(hour0));
  },
  airNow(ctx) {
    return { source: 'airnow', aqi: 112, primaryPollutant: 'O3', observedAt: isoInZone(ctx.hourStart, ctx.tz), reportingArea: 'Topeka' };
  },
  airForecast(ctx): AirQualityDay[] {
    return [
      {
        date: ctx.dayKeys[0],
        aqi: 118,
        categoryNumber: 3,
        primaryPollutant: 'O3',
        discussion:
          'Ozone concentrations are expected to reach the Unhealthy for Sensitive Groups range this afternoon and evening. Hot temperatures, abundant sunshine and light winds will promote ozone formation across northeast Kansas before thunderstorms develop.',
        source: 'airnow',
      },
      {
        date: ctx.dayKeys[1],
        aqi: 104,
        categoryNumber: 3,
        primaryPollutant: 'O3',
        discussion: 'Ozone remains elevated on Friday with the continued hot and humid pattern. Scattered storms may limit ozone late in the day.',
        source: 'airnow',
      },
      { date: ctx.dayKeys[2], aqi: 88, categoryNumber: 2, primaryPollutant: 'O3', discussion: null, source: 'airnow' },
      { date: ctx.dayKeys[3], aqi: null, categoryNumber: 2, primaryPollutant: 'PM2.5', discussion: null, source: 'airnow' },
    ];
  },
  alerts: summerAlerts,
  discussion(ctx): ForecastDiscussion {
    const text = [
      afdHeader(ctx, 'TOP', 'Topeka', 'KS'),
      '.SHORT TERM...(This evening through Friday night)',
      `Issued at ${bareTime(ctx.now - 25 * MIN, ctx.tz)}`,
      '',
      'Thunderstorms have fired along a southwest to northeast oriented boundary draped across north central Kansas, where MLCAPE has climbed above 3500 J/kg in a very moist and uncapped airmass. Deep layer shear is modest at 25 to 30 kt, which favors multicell clusters with damaging wind gusts and large hail as the primary hazards. Heat index values near 105 this afternoon have been the other story, and the Heat Advisory continues until 8 PM.',
      '',
      'Storms should consolidate into a line and drift east and southeast through the evening, with a threat for torrential rainfall given precipitable water values near 2 inches. A Flood Watch is in effect for the counties along and north of Interstate 70 where training cells are most likely overnight. Lows will stay in the mid 70s, with muggy conditions persisting.',
      '',
      'Friday looks similar with a remnant outflow boundary near the area. Highs again reach the low 90s, and heat index values around 100 to 105 are possible before afternoon convection redevelops.',
      '',
      '.LONG TERM...(Saturday through Wednesday)',
      'Issued at ' + bareTime(ctx.now - 25 * MIN, ctx.tz),
      '',
      'A cold front sweeps through the area Saturday night into Sunday with a final round of showers and thunderstorms. Behind the front, a drier and noticeably cooler airmass settles in with highs in the 80s and dew points falling into the 50s, which should feel refreshing after this stretch of heat.',
      '',
      'Confidence decreases by midweek as the ridge rebuilds to our south. Ensembles favor a gradual return of heat and humidity with periodic chances for storms riding the northern periphery of the ridge.',
      '',
      '.AVIATION...(For the 00Z TAFs through 00Z Friday)',
      'Thunderstorms near the terminals the next few hours may bring brief MVFR to IFR visibility, gusty and erratic winds up to 40 kt, and small hail. Storms should move east of the terminals by 03Z with VFR conditions returning. Southerly winds around 10 kt are expected overnight.',
      '',
      '&&',
      '',
      '.TOP WATCHES/WARNINGS/ADVISORIES...',
      'KS...Flood Watch through Friday morning for KSZ008>010-020>022.',
      '     Heat Advisory until 8 PM CDT this evening for KSZ008>010-020>022.',
      '',
      '&&',
      '',
      '$$',
      '',
      'DISCUSSION...Wolters',
      'AVIATION...Wolters',
    ].join('\n');
    return {
      wfo: 'TOP',
      issuedAt: isoInZone(ctx.now - 25 * MIN, ctx.tz),
      text: hardWrap(text, 70),
      url: 'https://forecast.weather.gov/product.php?site=TOP&issuedby=TOP&product=AFD&format=CI&version=1&glossary=1',
    };
  },
};

// ------------------------------------------------------------------------------------------ winter

function winterStorms(ctx: ScenarioCtx): Storm[] {
  const at = (day: number, hour: number) => zonedToMs(ctx.dayKeys[day], hour, 0, ctx.tz);
  return [
    { center: ctx.now + 3 * HOUR_MS, widthH: 3.5, intensity: 0.9, type: 'snow' },
    { center: at(1, 8), widthH: 3, intensity: 0.5, type: 'snow' },
    { center: at(5, 14), widthH: 5, intensity: 0.8, type: 'snow' },
    { center: at(6, 20), widthH: 3, intensity: 0.5, type: 'snow' },
    { center: at(8, 12), widthH: 4, intensity: 0.5, type: 'snow' },
  ];
}

export const WINTER: Scenario = {
  name: 'winter',
  place: { id: placeIdFor(45.677, -111.0429), name: 'Bozeman, MT', lat: 45.677, lon: -111.0429, kind: 'saved' },
  point: {
    wfo: 'TFX',
    gridX: 96,
    gridY: 69,
    timeZone: 'America/Denver',
    city: 'Bozeman',
    state: 'MT',
    radarStation: 'KTFX',
    forecastZone: 'MTZ058',
    county: 'MTC031',
  },
  sunrise: [7, 54],
  sunset: [16, 49],
  noonAltDeg: 21.5,
  uvClear: 1.4,
  slr: 14,
  days: [
    { hiF: 17, loF: 5, dewF: 4, cloud: 75, precip: 30, windKph: 34, dir: 310 },
    { hiF: 12, loF: -3, dewF: 2, cloud: 60, precip: 35, windKph: 30, dir: 320 },
    { hiF: 9, loF: -8, dewF: -4, cloud: 35, precip: 10, windKph: 22, dir: 330 },
    { hiF: 15, loF: -4, dewF: -2, cloud: 25, precip: 5, windKph: 16, dir: 250 },
    { hiF: 27, loF: 10, dewF: 12, cloud: 55, precip: 25, windKph: 28, dir: 230 },
    { hiF: 31, loF: 18, dewF: 20, cloud: 80, precip: 55, windKph: 24, dir: 210 },
    { hiF: 24, loF: 8, dewF: 10, cloud: 70, precip: 40, windKph: 26, dir: 300 },
    { hiF: 20, loF: 4, dewF: 6, cloud: 50, precip: 20, windKph: 22, dir: 310 },
    { hiF: 16, loF: 2, dewF: 3, cloud: 60, precip: 35, windKph: 20, dir: 320 },
    { hiF: 22, loF: 8, dewF: 8, cloud: 40, precip: 15, windKph: 18, dir: 270 },
  ],
  storms: winterStorms,
  station: { id: 'KBZN', name: 'Bozeman Yellowstone International Airport' },
  pressurePa: 101_620,
  visibilityM: 11_265,
  aqiAt(ctx, t) {
    const hour = localHour(t, ctx.tz);
    const hour0 = localHour(ctx.hourStart, ctx.tz);
    const shape = (h: number) => bump(h, 7, 2.5) + 0.8 * bump(h, 19, 2);
    const dayIdx = (t - ctx.hourStart) / (24 * HOUR_MS);
    const inversion = dayIdx > 1.6 && dayIdx < 3.6 ? 22 : 0;
    return 38 + inversion + 14 * (shape(hour) - shape(hour0));
  },
  airNow(ctx) {
    return { source: 'open-meteo', aqi: 38, primaryPollutant: 'PM2.5', observedAt: isoInZone(ctx.hourStart, ctx.tz), reportingArea: null };
  },
  airForecast(ctx, dailyAqiMax): AirQualityDay[] {
    const out: AirQualityDay[] = [];
    dailyAqiMax.slice(0, 5).forEach((aqi, i) => {
      if (aqi === null) return;
      out.push({
        date: ctx.dayKeys[i] ?? addDaysToKey(ctx.dayKeys[0], i),
        aqi,
        categoryNumber: aqiCategoryNumber(aqi),
        primaryPollutant: 'PM2.5',
        discussion: null,
        source: 'open-meteo',
      });
    });
    return out;
  },
  alerts: () => [],
  omitUv: true,
  problems: [{ source: 'open-meteo-uv', message: 'Open-Meteo UV request timed out' }],
  discussion(ctx): ForecastDiscussion {
    const text = [
      afdHeader(ctx, 'TFX', 'Great Falls', 'MT'),
      '.DISCUSSION...',
      '',
      'Northwest flow aloft persists across the region as a series of shortwaves rotate around a deep trough over the northern Rockies. Arctic air continues to spill south and east of the Divide, and combined with breezy to windy conditions it will keep wind chills well below zero through Saturday morning.',
      '',
      'Snow showers will become more widespread this evening as the next disturbance moves through. Snow-to-liquid ratios are running high, 14:1 or better, so even modest liquid amounts will add up to 2 to 4 inches in the valleys and 5 to 9 inches in the mountains and passes. Gusty northwest winds will cause blowing snow and reduce visibility on exposed stretches of I-90 and Bozeman Pass.',
      '',
      'A brief break arrives Saturday as a ridge builds in, though cold temperatures remain. The next system approaches early next week on a more southwesterly flow, bringing milder air and another round of mountain snow with valley accumulations possible Monday into Tuesday.',
      '',
      '&&',
      '',
      '.PREV DISCUSSION...',
      'Previous forecast thinking remains on track with minor adjustments to wind gusts and snow totals.',
      '',
      '.AVIATION...',
      'Snow showers and gusty northwest winds will bring periods of MVFR to IFR conditions to KBZN and KLWT through tonight. Mountain obscuration is expected along the ranges.',
      '',
      '&&',
      '',
      '.TFX WATCHES/WARNINGS/ADVISORIES...',
      'None.',
      '',
      '&&',
      '',
      '$$',
      '',
      'DISCUSSION...Coulston',
      'AVIATION...Coulston',
    ].join('\n');
    return {
      wfo: 'TFX',
      issuedAt: isoInZone(ctx.now - 25 * MIN, ctx.tz),
      text: hardWrap(text, 70),
      url: 'https://forecast.weather.gov/product.php?site=TFX&issuedby=TFX&product=AFD&format=CI&version=1&glossary=1',
    };
  },
};
