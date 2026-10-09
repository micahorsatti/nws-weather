/**
 * Why "Feels like" differs from the air temperature, in plain words. The label itself is always
 * "Feels like"; the technical names (heat index, wind chill) never appear in the UI.
 *
 * The explanation must follow the *direction* of the difference, not just the kind of adjustment:
 * in dry heat the NWS heat index can come out below the air temperature (Phoenix: 84°F air, 82°F
 * "feels like"), and "humidity makes it feel warmer" would be plainly wrong there.
 */
import type { FeelsLikeKind } from '../../data/types';
import { temp } from '../../lib/units';
import type { UnitSystem } from '../../lib/units';

/** Smallest difference (in the displayed unit, after rounding) worth explaining. */
export const FEELS_THRESHOLD = 2;

/** "Feels like" minus air temperature as the user sees it (both rounded to whole display degrees), or null. */
export function feelsDelta(tempC: number | null | undefined, feelsC: number | null | undefined, units: UnitSystem): number | null {
  const t = temp(tempC, units);
  const f = temp(feelsC, units);
  return t === null || f === null ? null : f - t;
}

/**
 * One short sentence for the hero, or null when there is nothing worth saying:
 *   heat-index  and feels >= air + 2  ->  "Humidity makes it feel warmer"
 *   heat-index  and feels <= air - 2  ->  "Dry air makes it feel a little cooler"
 *   wind-chill  and feels <= air - 2  ->  "Wind makes it feel colder"
 */
export function feelsLikeNote(kind: FeelsLikeKind, tempC: number | null | undefined, feelsC: number | null | undefined, units: UnitSystem): string | null {
  const d = feelsDelta(tempC, feelsC, units);
  if (d === null) return null;
  if (kind === 'heat-index') {
    if (d >= FEELS_THRESHOLD) return 'Humidity makes it feel warmer';
    if (d <= -FEELS_THRESHOLD) return 'Dry air makes it feel a little cooler';
    return null;
  }
  if (kind === 'wind-chill') return d <= -FEELS_THRESHOLD ? 'Wind makes it feel colder' : null;
  return null;
}

/** Compact comparison for tight spaces ("9° warmer", "2° cooler", "18° colder"), under the same 2-degree rule. */
export function feelsComparison(kind: FeelsLikeKind, tempC: number | null | undefined, feelsC: number | null | undefined, units: UnitSystem): string | null {
  const d = feelsDelta(tempC, feelsC, units);
  if (d === null || Math.abs(d) < FEELS_THRESHOLD) return null;
  if (d > 0) return `${d}° warmer`;
  return `${-d}° ${kind === 'wind-chill' ? 'colder' : 'cooler'}`;
}
