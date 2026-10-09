/**
 * Place search via the Open-Meteo geocoding API (no key): US city names, "City, ST", and 5-digit ZIPs.
 * The API treats Puerto Rico, Guam, the U.S. Virgin Islands, American Samoa and the Northern Marianas
 * as separate countries, so those are searched too (PR with every query; the rest when nothing else matches
 * or when the query names them).
 */
import { HttpError, abortError, classifyError, fetchJson, isAbortError, throwIfAborted } from './http';
import { placeIdFor, type Place } from './types';
import { arr, finite, obj, str } from './util';

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const MAX_RESULTS = 10;

const US_STATES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const TERRITORIES: Record<string, string> = {
  'puerto rico': 'PR',
  guam: 'GU',
  'u.s. virgin islands': 'VI',
  'united states virgin islands': 'VI',
  'us virgin islands': 'VI',
  'virgin islands': 'VI',
  'american samoa': 'AS',
  'northern mariana islands': 'MP',
  'commonwealth of the northern mariana islands': 'MP',
};

/** Territories that Open-Meteo files under their own ISO country code (which equals the USPS code). */
const TERRITORY_CODES = ['PR', 'GU', 'VI', 'AS', 'MP'] as const;

const STATE_CODES = new Set<string>([...Object.values(US_STATES), ...Object.values(TERRITORIES)]);

/** "kansas" / "KS" / "Puerto Rico" -> "KS" | "PR"; null if it isn't a US state or territory. */
export function stateCodeOf(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t.length === 2) {
    const upper = t.toUpperCase();
    return STATE_CODES.has(upper) ? upper : null;
  }
  return US_STATES[t] ?? TERRITORIES[t] ?? null;
}

export interface ParsedQuery {
  /** The text to search for (a city name or a 5-digit ZIP). */
  name: string;
  /** USPS code from "City, ST" / "City ST" / "City, State", when recognised. */
  state: string | null;
  isZip: boolean;
}

export function parseQuery(query: string): ParsedQuery | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length === 0) return null;
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(q);
  if (zip) return { name: zip[1], state: null, isZip: true };

  const comma = q.indexOf(',');
  if (comma > 0) {
    const city = q.slice(0, comma).trim();
    const rest = q.slice(comma + 1).trim();
    const state = stateCodeOf(rest);
    // "Springfield, " (still typing) searches the city; "City, Nowhere" ignores the unknown tail.
    if (city.length >= 1) return { name: city, state, isZip: false };
  }
  // "Linn KS": a trailing two-letter state code after a space.
  const trailing = /^(.{2,}?)\s+([A-Za-z]{2})$/.exec(q);
  if (trailing) {
    const state = stateCodeOf(trailing[2]);
    if (state) return { name: trailing[1], state, isZip: false };
  }
  return { name: q, state: null, isZip: false };
}

interface GeoResult {
  name: string;
  state: string | null;
  fullAdmin: string | null;
  lat: number;
  lon: number;
  population: number;
  featureCode: string;
}

/** Normalise raw Open-Meteo results; drops entries outside the US and its territories. */
export function parseGeocodingResults(json: unknown): GeoResult[] {
  const out: GeoResult[] = [];
  for (const raw of arr(obj(json)?.results)) {
    const r = obj(raw);
    const name = str(r?.name);
    const lat = finite(r?.latitude);
    const lon = finite(r?.longitude);
    if (!r || !name || lat === null || lon === null) continue;
    const country = str(r.country_code)?.toUpperCase() ?? '';
    const admin1 = str(r.admin1);
    let state: string | null = null;
    if (country === 'US') state = admin1 ? stateCodeOf(admin1) : null;
    else if ((TERRITORY_CODES as readonly string[]).includes(country)) state = country;
    else continue;
    out.push({
      name,
      state,
      fullAdmin: admin1,
      lat,
      lon,
      population: finite(r.population) ?? 0,
      featureCode: str(r.feature_code) ?? '',
    });
  }
  return out;
}

const isSettlement = (r: GeoResult): boolean =>
  r.featureCode.startsWith('PPL') || (r.featureCode === 'ISL' && r.population > 0);

/** "Washington D.C." in DC reads better as "Washington, DC". */
function displayName(r: GeoResult): string {
  if (r.state === 'DC' && /^washington/i.test(r.name)) return 'Washington, DC';
  const suffix = r.state ?? r.fullAdmin;
  return suffix ? `${r.name}, ${suffix}` : r.name;
}

/** Exact name matches first, then prefix matches, then by population. */
function rank(r: GeoResult, needle: string): number {
  const n = r.name.toLowerCase().replace(/[.']/g, '');
  const target = needle.toLowerCase().replace(/[.']/g, '');
  const match = n === target ? 2 : n.startsWith(target) ? 1 : 0;
  return match * 1e9 + r.population;
}

export function toPlaces(results: GeoResult[], parsed: ParsedQuery): Place[] {
  let list = results.filter(isSettlement);
  if (list.length === 0) list = results;
  if (parsed.state) {
    const matching = list.filter((r) => r.state === parsed.state);
    if (matching.length > 0) list = matching;
  }
  list = [...list].sort((a, b) => rank(b, parsed.name) - rank(a, parsed.name));

  const seen = new Set<string>();
  const places: Place[] = [];
  for (const r of list) {
    const lat = Number(r.lat.toFixed(4));
    const lon = Number(r.lon.toFixed(4));
    const name = displayName(r);
    const key = `${name}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ id: placeIdFor(lat, lon), name, lat, lon, kind: 'search' });
    if (places.length >= MAX_RESULTS) break;
  }
  return places;
}

function searchUrl(name: string, countryCode: string, count: number): string {
  return `${ENDPOINT}?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json&countryCode=${countryCode}`;
}

/** Search US places (and territories) by city name, "City, ST" or ZIP code. Resolves [] when nothing matches. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const parsed = parseQuery(query);
  if (!parsed || (!parsed.isZip && parsed.name.length < 2)) return [];

  const opts = { signal, attempts: 2, timeoutMs: 8_000 };
  const territoryOnly = parsed.state !== null && (TERRITORY_CODES as readonly string[]).includes(parsed.state);
  const count = parsed.state ? 30 : MAX_RESULTS;

  const countries: string[] = [];
  if (!territoryOnly) countries.push('US');
  if (!parsed.isZip && (territoryOnly || parsed.state === null)) countries.push(territoryOnly ? parsed.state! : 'PR');

  const fetchCountry = (cc: string): Promise<GeoResult[]> =>
    fetchJson<unknown>(searchUrl(parsed.name, cc, cc === 'US' ? count : 5), opts).then(parseGeocodingResults);

  const settled = await Promise.allSettled(countries.map(fetchCountry));
  throwIfAborted(signal);
  let results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failures.length === settled.length) throw searchError(failures[0].reason);

  // Nothing found: the remaining territories may know the name ("Charlotte Amalie", "Hagatna").
  if (results.length === 0 && !parsed.isZip && parsed.state === null) {
    const rest = TERRITORY_CODES.filter((c) => c !== 'PR');
    const more = await Promise.allSettled(rest.map(fetchCountry));
    throwIfAborted(signal);
    results = more.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  }
  return toPlaces(results, parsed);
}

function searchError(reason: unknown): Error {
  if (isAbortError(reason)) return abortError();
  const kind = classifyError(reason);
  if (reason instanceof HttpError || kind === 'server') {
    return new Error('The place search service is having trouble right now. Try again in a moment.');
  }
  return new Error("Can't reach the place search service. Check your connection and try again.");
}
