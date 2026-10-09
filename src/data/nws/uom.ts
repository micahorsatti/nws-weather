/**
 * Unit-of-measure conversion for NWS values ("wmoUnit:degC", "wmoUnit:km_h-1", ...). Each quantity has
 * one canonical unit (the contract's units); the layer's own `uom` decides how to get there, so a
 * change of units on the NWS side (e.g. a layer switching from km/h to m/s) can't corrupt the data.
 */
import { finite } from '../util';

/** What a value measures; the canonical unit is in the comment. */
export type Quantity =
  | 'temperature' // °C
  | 'speed' // km/h
  | 'precip' // mm (liquid-equivalent or snow depth as the layer defines it)
  | 'distance' // m
  | 'pressure' // Pa
  | 'percent' // 0-100
  | 'angle'; // degrees

type Converter = (v: number) => number;

const identity: Converter = (v) => v;

const TABLE: Record<Quantity, Record<string, Converter>> = {
  temperature: {
    degC: identity,
    degF: (v) => ((v - 32) * 5) / 9,
    K: (v) => v - 273.15,
  },
  speed: {
    'km_h-1': identity,
    'm_s-1': (v) => v * 3.6,
    'mi_h-1': (v) => v * 1.609344,
    '[mi_i]/h': (v) => v * 1.609344,
    kt: (v) => v * 1.852,
    kn: (v) => v * 1.852,
    '[kn_i]': (v) => v * 1.852,
  },
  precip: {
    mm: identity,
    cm: (v) => v * 10,
    m: (v) => v * 1000,
    in: (v) => v * 25.4,
    '[in_i]': (v) => v * 25.4,
    'kg_m-2': identity, // 1 kg of water per m² is 1 mm deep
  },
  distance: {
    m: identity,
    km: (v) => v * 1000,
    mi: (v) => v * 1609.344,
    '[mi_i]': (v) => v * 1609.344,
    ft: (v) => v * 0.3048,
    '[ft_i]': (v) => v * 0.3048,
  },
  pressure: {
    Pa: identity,
    hPa: (v) => v * 100,
    mbar: (v) => v * 100,
    kPa: (v) => v * 1000,
    inHg: (v) => v * 3386.389,
    "[in_i'Hg]": (v) => v * 3386.389,
  },
  percent: {
    percent: identity,
    '%': identity,
  },
  angle: {
    'degree_(angle)': identity,
    deg: identity,
  },
};

/** The `uom` without its namespace: "wmoUnit:degC" -> "degC". */
export function stripUnitNamespace(uom: string): string {
  return uom.trim().replace(/^(wmoUnit|nwsUnit|unit):/i, '');
}

/**
 * Convert `value` (measured in `uom`) to the canonical unit for `quantity`.
 * A missing `uom` means the layer didn't say; the canonical unit is assumed (NWS omits it on some
 * probability layers). An unrecognised `uom` yields null so wrong units never leak into the data.
 */
export function convertUom(value: unknown, uom: unknown, quantity: Quantity): number | null {
  const v = finite(value);
  if (v === null) return null;
  if (typeof uom !== 'string' || uom.trim() === '') return v;
  const unit = stripUnitNamespace(uom);
  const table = TABLE[quantity];
  const direct = table[unit];
  if (direct) return direct(v);
  const lower = unit.toLowerCase();
  for (const [name, fn] of Object.entries(table)) if (name.toLowerCase() === lower) return fn(v);
  return null;
}
