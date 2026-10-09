/** "Right now": a station observation when a recent one exists, otherwise the current forecast hour. */
import { feelsLike, humidityFromDewpoint } from './feelsLike';
import { describeIcon, resolveIcon } from './icons';
import type { ParsedObservation } from './nws/observations';
import { isDaytimeAt } from './sun';
import { isoZ } from './time';
import type { CurrentConditions, HourlyPoint } from './types';
import { round } from './util';

/**
 * Current conditions from a station report. The reported heat index / wind chill are used only when the
 * "feels like" rule applies (NWS stations report heatIndex even at 72°F); otherwise it is computed
 * from temperature, humidity and wind, or equals the air temperature.
 * `hourNow` (the current forecast hour) only fills in a missing sky condition.
 */
export function currentFromObservation(
  obs: ParsedObservation,
  place: { lat: number; lon: number },
  hourNow: HourlyPoint | null,
): CurrentConditions {
  const humidity =
    obs.humidityPct ??
    (obs.tempC !== null && obs.dewpointC !== null ? humidityFromDewpoint(obs.tempC, obs.dewpointC) : null);
  const feels = feelsLike({
    tempC: obs.tempC,
    humidityPct: humidity,
    windKph: obs.windKph,
    reportedHeatIndexC: obs.heatIndexC,
    reportedWindChillC: obs.windChillC,
  });

  const resolved = resolveIcon({ url: obs.iconUrl, text: obs.description });
  const isDaytime = resolved.isDaytime ?? isDaytimeAt(obs.observedAtMs, place.lat, place.lon);
  const skyKnown = resolved.icon !== 'unknown';
  const icon = skyKnown ? resolved.icon : (hourNow?.icon ?? 'unknown');
  const description =
    obs.description ?? (skyKnown ? describeIcon(resolved.icon, isDaytime) : (hourNow?.shortForecast ?? ''));

  return {
    source: 'observation',
    observedAt: isoZ(obs.observedAtMs),
    stationId: obs.stationId,
    stationName: obs.stationName,
    description,
    icon,
    isDaytime,
    tempC: round(obs.tempC),
    feelsLikeC: round(feels.feelsLikeC),
    feelsLikeKind: feels.kind,
    dewpointC: round(obs.dewpointC),
    humidityPct: round(humidity, 1),
    windKph: round(obs.windKph, 1),
    windGustKph: round(obs.windGustKph, 1),
    windDirDeg: round(obs.windDirDeg, 0),
    pressurePa: round(obs.pressurePa, 0),
    visibilityM: round(obs.visibilityM, 0),
  };
}

/** Current conditions taken from the current forecast hour (no recent station report). */
export function currentFromHour(hour: HourlyPoint): CurrentConditions {
  return {
    source: 'forecast',
    observedAt: hour.time,
    stationId: null,
    stationName: null,
    description: hour.shortForecast,
    icon: hour.icon,
    isDaytime: hour.isDaytime,
    tempC: hour.tempC,
    feelsLikeC: hour.feelsLikeC,
    feelsLikeKind: hour.feelsLikeKind,
    dewpointC: hour.dewpointC,
    humidityPct: hour.humidityPct,
    windKph: hour.windKph,
    windGustKph: hour.windGustKph,
    windDirDeg: hour.windDirDeg,
    pressurePa: null,
    visibilityM: null,
  };
}
