import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGeocodingResults, parseQuery, searchPlaces, stateCodeOf, toPlaces } from './geocode';
import { httpConfig } from './http';
import { mockFetch, serverError } from './testing/fixtures';
import { placeIdFor } from './types';

beforeAll(() => {
  httpConfig.backoffMs = [0, 0];
  httpConfig.jitterMs = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Raw {
  name: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  country_code: string;
  population?: number;
  feature_code?: string;
}

const us = (name: string, admin1: string, latitude: number, longitude: number, population?: number, feature_code = 'PPL'): Raw => ({
  name,
  admin1,
  latitude,
  longitude,
  country_code: 'US',
  population,
  feature_code,
});

/** Results by countryCode, in the shape the Open-Meteo geocoder returns. */
const geocoder =
  (table: Record<string, Raw[]>) =>
  (url: string) => {
    const code = new URL(url).searchParams.get('countryCode') ?? '';
    const results = table[code];
    return { status: 200, body: results && results.length > 0 ? { results, generationtime_ms: 0.4 } : { generationtime_ms: 0.4 } };
  };

const sanJuanPR: Raw = { name: 'San Juan', admin1: 'San Juan', latitude: 18.46633, longitude: -66.10572, country_code: 'PR', population: 418140, feature_code: 'PPLC' };

describe('state names and codes', () => {
  it('maps names, codes and territories to USPS codes', () => {
    expect(stateCodeOf('Kansas')).toBe('KS');
    expect(stateCodeOf('kansas')).toBe('KS');
    expect(stateCodeOf('ks')).toBe('KS');
    expect(stateCodeOf('New  York')).toBe('NY');
    expect(stateCodeOf('District of Columbia')).toBe('DC');
    expect(stateCodeOf('DC')).toBe('DC');
    expect(stateCodeOf('Puerto Rico')).toBe('PR');
    expect(stateCodeOf('PR')).toBe('PR');
    expect(stateCodeOf('Guam')).toBe('GU');
    expect(stateCodeOf('U.S. Virgin Islands')).toBe('VI');
    expect(stateCodeOf('American Samoa')).toBe('AS');
    expect(stateCodeOf('Northern Mariana Islands')).toBe('MP');
    expect(stateCodeOf('Ontario')).toBeNull();
    expect(stateCodeOf('ZZ')).toBeNull();
    expect(stateCodeOf('')).toBeNull();
  });

  it('covers all 50 states plus DC and the five territories', () => {
    const names = [
      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
      'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
      'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
      'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island',
      'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
      'wisconsin', 'wyoming',
    ];
    expect(names).toHaveLength(50);
    const codes = new Set(names.map((n) => stateCodeOf(n)));
    expect(codes.size).toBe(50);
    expect(codes.has(null)).toBe(false);
  });
});

describe('parsing what the user typed', () => {
  it('recognises ZIP codes', () => {
    expect(parseQuery('66952')).toEqual({ name: '66952', state: null, isZip: true });
    expect(parseQuery(' 66952-1234 ')).toEqual({ name: '66952', state: null, isZip: true });
    expect(parseQuery('6695')?.isZip).toBe(false);
  });

  it('splits "City, ST" in its several spellings', () => {
    expect(parseQuery('Springfield, MO')).toEqual({ name: 'Springfield', state: 'MO', isZip: false });
    expect(parseQuery('Springfield,Missouri')).toEqual({ name: 'Springfield', state: 'MO', isZip: false });
    expect(parseQuery('San Juan, PR')).toEqual({ name: 'San Juan', state: 'PR', isZip: false });
    expect(parseQuery('Linn KS')).toEqual({ name: 'Linn', state: 'KS', isZip: false });
    expect(parseQuery('Salt Lake City utah')).toEqual({ name: 'Salt Lake City utah', state: null, isZip: false });
    expect(parseQuery('Salt Lake City UT')).toEqual({ name: 'Salt Lake City', state: 'UT', isZip: false });
  });

  it('searches the city while the state is still being typed or is unknown', () => {
    expect(parseQuery('Springfield,')).toEqual({ name: 'Springfield', state: null, isZip: false });
    expect(parseQuery('Springfield, Narnia')).toEqual({ name: 'Springfield', state: null, isZip: false });
    expect(parseQuery('Springfield')).toEqual({ name: 'Springfield', state: null, isZip: false });
    expect(parseQuery('St. Louis')).toEqual({ name: 'St. Louis', state: null, isZip: false });
  });

  it('is null for blank input', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery('   ')).toBeNull();
  });
});

describe('turning geocoder results into places', () => {
  it('names places "City, ST" using USPS codes and drops non-US results', () => {
    const results = parseGeocodingResults({
      results: [
        us('Springfield', 'Missouri', 37.21533, -93.29824, 170188, 'PPLA2'),
        sanJuanPR,
        { name: 'San Juan City', admin1: 'National Capital Region', latitude: 14.6, longitude: 121.03, country_code: 'PH' },
        { name: 'Nameless', latitude: 1, longitude: 2, country_code: 'US' },
        { latitude: 1, longitude: 2, country_code: 'US' },
        'junk',
      ],
    });
    const places = toPlaces(results, { name: 'x', state: null, isZip: false });
    expect(places.map((p) => p.name).sort()).toEqual(['San Juan, PR', 'Springfield, MO']); // no feature code: not a settlement
  });

  it('rounds coordinates to 4 decimals and builds stable ids', () => {
    const [place] = toPlaces(parseGeocodingResults({ results: [us('Linn', 'Kansas', 39.679999, -97.084199, 400)] }), {
      name: 'Linn',
      state: null,
      isZip: false,
    });
    expect(place).toEqual({ id: placeIdFor(39.68, -97.0842), name: 'Linn, KS', lat: 39.68, lon: -97.0842, kind: 'search' });
    expect(place.id).toBe('39.6800,-97.0842');
  });

  it('puts exact name matches first, then bigger places', () => {
    const results = parseGeocodingResults({
      results: [
        us('San Juan Bautista', 'California', 36.8, -121.5, 1961),
        us('San Juan', 'New Mexico', 36.05, -106.07, 592),
        us('San Juan', 'Texas', 26.19, -98.16, 36556),
        sanJuanPR,
      ],
    });
    const names = toPlaces(results, { name: 'San Juan', state: null, isZip: false }).map((p) => p.name);
    expect(names).toEqual(['San Juan, PR', 'San Juan, TX', 'San Juan, NM', 'San Juan Bautista, CA']);
  });

  it('keeps only the requested state when it has matches, otherwise shows everything', () => {
    const results = parseGeocodingResults({
      results: [us('Springfield', 'Missouri', 37.2, -93.3, 170188), us('Springfield', 'Illinois', 39.8, -89.6, 114394), us('Springfield', 'Ohio', 39.9, -83.8, 59680)],
    });
    expect(toPlaces(results, { name: 'Springfield', state: 'IL', isZip: false }).map((p) => p.name)).toEqual(['Springfield, IL']);
    expect(toPlaces(results, { name: 'Springfield', state: 'TX', isZip: false })).toHaveLength(3);
  });

  it('prefers settlements to airports, parks and dams (unless nothing else matches)', () => {
    const mixed = parseGeocodingResults({
      results: [us('Barrow Dam', 'Alaska', 71.3, -156.8, undefined, 'DAM'), us('Barrow', 'Illinois', 39.5, -90.4, undefined, 'PPL')],
    });
    expect(toPlaces(mixed, { name: 'Barrow', state: null, isZip: false }).map((p) => p.name)).toEqual(['Barrow, IL']);
    const onlyDam = parseGeocodingResults({ results: [us('Barrow Dam', 'Alaska', 71.3, -156.8, undefined, 'DAM')] });
    expect(toPlaces(onlyDam, { name: 'Barrow', state: null, isZip: false }).map((p) => p.name)).toEqual(['Barrow Dam, AK']);
  });

  it('writes the capital as "Washington, DC"', () => {
    const results = parseGeocodingResults({ results: [us('Washington D.C.', 'District of Columbia', 38.895, -77.036, 689545, 'PPLC')] });
    expect(toPlaces(results, { name: 'Washington', state: null, isZip: false })[0].name).toBe('Washington, DC');
  });

  it('removes duplicates and returns at most ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => us('Dupeville', 'Ohio', 40 + i * 0.5, -83, 100 - i));
    const places = toPlaces(parseGeocodingResults({ results: [...many, many[0]] }), { name: 'Dupeville', state: null, isZip: false });
    expect(places).toHaveLength(10);
    expect(new Set(places.map((p) => p.id)).size).toBe(10);
  });
});

describe('searchPlaces', () => {
  it('searches the US and Puerto Rico for a city name', async () => {
    const mock = mockFetch(null, {
      geocode: geocoder({
        US: [us('San Juan', 'Texas', 26.18924, -98.15529, 36556), us('San Juan', 'New Mexico', 36.05, -106.07, 592)],
        PR: [sanJuanPR],
      }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const places = await searchPlaces('San Juan');
    expect(places.map((p) => p.name)).toEqual(['San Juan, PR', 'San Juan, TX', 'San Juan, NM']);
    expect(mock.count('geocode')).toBe(2);
    const urls = mock.calls.map((u) => new URL(u));
    expect(urls.map((u) => u.searchParams.get('countryCode')).sort()).toEqual(['PR', 'US']);
    expect(urls.every((u) => u.searchParams.get('name') === 'San Juan' && u.origin === 'https://geocoding-api.open-meteo.com')).toBe(true);
  });

  it('looks a ZIP code up in the US only', async () => {
    const mock = mockFetch(null, { geocode: geocoder({ US: [us('Lebanon', 'Kansas', 39.80973, -98.55562, 208)] }) });
    vi.stubGlobal('fetch', mock.fetch);
    const places = await searchPlaces('66952');
    expect(places.map((p) => p.name)).toEqual(['Lebanon, KS']);
    expect(mock.count('geocode')).toBe(1);
    expect(new URL(mock.calls[0]).searchParams.get('name')).toBe('66952');
  });

  it('searches the city part of "City, ST" and keeps that state', async () => {
    const mock = mockFetch(null, {
      geocode: geocoder({
        US: [us('Linn Valley', 'Kansas', 38.3775, -94.7094, 900), us('Linn', 'Missouri', 38.48, -91.85, 1300), us('Linn', 'Kansas', 39.68, -97.0842, 400)],
      }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const places = await searchPlaces('Linn, KS');
    expect(places.map((p) => p.name)).toEqual(['Linn, KS', 'Linn Valley, KS']);
    expect(mock.count('geocode')).toBe(1); // a mainland state: no territory request
    const url = new URL(mock.calls[0]);
    expect(url.searchParams.get('name')).toBe('Linn');
    expect(url.searchParams.get('count')).toBe('30');
  });

  it('searches only the territory when the query names one', async () => {
    const mock = mockFetch(null, { geocode: geocoder({ PR: [sanJuanPR], US: [us('San Juan', 'Texas', 26.19, -98.16, 36556)] }) });
    vi.stubGlobal('fetch', mock.fetch);
    const places = await searchPlaces('San Juan, PR');
    expect(places.map((p) => p.name)).toEqual(['San Juan, PR']);
    expect(mock.count('geocode')).toBe(1);
    expect(new URL(mock.calls[0]).searchParams.get('countryCode')).toBe('PR');
  });

  it('tries the other territories when nothing else matches', async () => {
    const mock = mockFetch(null, {
      geocode: geocoder({ GU: [{ name: 'Hagåtña', admin1: 'Hagatna', latitude: 13.47567, longitude: 144.74886, country_code: 'GU', population: 1051, feature_code: 'PPLC' }] }),
    });
    vi.stubGlobal('fetch', mock.fetch);
    const places = await searchPlaces('Hagatna');
    expect(places.map((p) => p.name)).toEqual(['Hagåtña, GU']);
    const codes = mock.calls.map((u) => new URL(u).searchParams.get('countryCode'));
    expect(codes.slice(0, 2).sort()).toEqual(['PR', 'US']);
    expect(codes.slice(2).sort()).toEqual(['AS', 'GU', 'MP', 'VI']);
  });

  it('answers [] for no match, blank or too-short input without bothering the network', async () => {
    const mock = mockFetch(null, { geocode: geocoder({}) });
    vi.stubGlobal('fetch', mock.fetch);
    await expect(searchPlaces('Nowhereville')).resolves.toEqual([]);
    const before = mock.calls.length;
    await expect(searchPlaces('')).resolves.toEqual([]);
    await expect(searchPlaces('   ')).resolves.toEqual([]);
    await expect(searchPlaces('a')).resolves.toEqual([]);
    expect(mock.calls.length).toBe(before);
  });

  it('still answers when one of the two searches fails', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(null, {
        geocode: (url) =>
          new URL(url).searchParams.get('countryCode') === 'PR'
            ? serverError(500)
            : { status: 200, body: { results: [us('Springfield', 'Missouri', 37.2, -93.3, 170188)] } },
      }).fetch,
    );
    await expect(searchPlaces('Springfield')).resolves.toHaveLength(1);
  });

  it('rejects with a readable message when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', mockFetch(null, { geocode: 'network-error' }).fetch);
    await expect(searchPlaces('Springfield')).rejects.toThrow(/can't reach the place search/i);
    vi.stubGlobal('fetch', mockFetch(null, { geocode: serverError(503) }).fetch);
    await expect(searchPlaces('Springfield')).rejects.toThrow(/having trouble/i);
  });

  it('passes an abort through as an AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', mockFetch(null, { geocode: geocoder({}) }).fetch);
    await expect(searchPlaces('Springfield', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
