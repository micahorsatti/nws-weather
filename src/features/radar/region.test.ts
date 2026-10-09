import { describe, expect, it } from 'vitest';
import { EDGE_TOLERANCE_DEG, RADAR_REGIONS, WMS_BASE, capabilitiesUrl, hasBackupSource, pickRegion, wmsEndpoint } from './region';

const idAt = (lat: number, lon: number) => pickRegion(lat, lon)?.id ?? null;

describe('RADAR_REGIONS', () => {
  it('lists the five MRMS regions with {region}_bref_qcd layer names', () => {
    expect(RADAR_REGIONS.map((r) => r.id)).toEqual(['conus', 'alaska', 'hawaii', 'carib', 'guam']);
    for (const r of RADAR_REGIONS) expect(r.layer).toBe(`${r.id}_bref_qcd`);
  });

  it('has well-formed bounds [south, west, north, east]', () => {
    for (const { bounds } of RADAR_REGIONS) {
      const [south, west, north, east] = bounds;
      expect(south).toBeLessThan(north);
      expect(west).toBeLessThan(east);
    }
  });
});

describe('pickRegion', () => {
  it.each([
    ['Linn, KS', 39.678, -96.952, 'conus'],
    ['Seattle', 47.606, -122.332, 'conus'],
    ['Miami', 25.762, -80.192, 'conus'],
    ['Key West (inside both the CONUS and Caribbean bounds: CONUS wins)', 24.555, -81.78, 'conus'],
    ['Caribou, ME', 46.86, -68.01, 'conus'],
    ['San Diego', 32.715, -117.161, 'conus'],
    ['Anchorage', 61.218, -149.9, 'alaska'],
    ['Juneau', 58.301, -134.42, 'alaska'],
    ['Ketchikan', 55.342, -131.646, 'alaska'],
    ['Utqiagvik', 71.29, -156.79, 'alaska'],
    ['Honolulu', 21.307, -157.858, 'hawaii'],
    ['Hilo', 19.72, -155.09, 'hawaii'],
    ['San Juan, PR', 18.466, -66.106, 'carib'],
    ['Charlotte Amalie, USVI', 18.342, -64.931, 'carib'],
    ['Hagatna, Guam', 13.475, 144.75, 'guam'],
    ['Saipan', 15.19, 145.75, 'guam'],
  ])('%s', (_name, lat, lon, expected) => {
    expect(idAt(lat, lon)).toBe(expected);
  });

  it('keeps Puerto Rico out of the CONUS layer (which starts at 20N)', () => {
    expect(idAt(18.2, -66.5)).toBe('carib');
    expect(idAt(19.99, -66.5)).toBe('carib'); // just below CONUS: nearest wins
    expect(idAt(20.5, -66.5)).toBe('conus');
  });

  it('uses a nearby region for points just outside its bounds (island and coast edges)', () => {
    expect(idAt(18.12, 145.76)).toBe('guam'); // Pagan Island, a little north of the Guam layer
    expect(idAt(21, -164.5)).toBe('hawaii'); // 0.5 degrees west of the Hawaii layer
    expect(idAt(21, -165)).toBe('hawaii'); // exactly at the tolerance
  });

  it('returns null beyond the tolerance and for places with no MRMS layer', () => {
    expect(idAt(21, -165 - EDGE_TOLERANCE_DEG)).toBeNull();
    expect(idAt(-14.275, -170.702)).toBeNull(); // Pago Pago, American Samoa
    expect(idAt(52.9, 172.9)).toBeNull(); // Attu, past the western edge of the Alaska layer
    expect(idAt(51.507, -0.128)).toBeNull(); // London
    expect(idAt(0, 0)).toBeNull();
  });

  it('rejects coordinates that are not real', () => {
    expect(pickRegion(Number.NaN, -96)).toBeNull();
    expect(pickRegion(39, Number.POSITIVE_INFINITY)).toBeNull();
    expect(pickRegion(91, -96)).toBeNull();
    expect(pickRegion(39, 181)).toBeNull();
  });

  it('treats the bounds as inclusive', () => {
    expect(idAt(20, -130)).toBe('conus');
    expect(idAt(55, -60)).toBe('conus');
  });
});

describe('WMS addresses', () => {
  it('builds the per-region GeoServer endpoint', () => {
    const conus = RADAR_REGIONS[0]!;
    expect(wmsEndpoint(conus)).toBe('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows');
    expect(WMS_BASE).toBe('https://opengeo.ncep.noaa.gov/geoserver');
    for (const r of RADAR_REGIONS) expect(wmsEndpoint(r)).toBe(`${WMS_BASE}/${r.id}/${r.id}_bref_qcd/ows`);
  });

  it('asks for WMS 1.3.0 capabilities', () => {
    const alaska = RADAR_REGIONS.find((r) => r.id === 'alaska')!;
    expect(capabilitiesUrl(alaska)).toBe(
      'https://opengeo.ncep.noaa.gov/geoserver/alaska/alaska_bref_qcd/ows?service=WMS&version=1.3.0&request=GetCapabilities',
    );
  });
});

describe('hasBackupSource', () => {
  it('is true only for the continental US (the Mesonet mosaic does not cover the rest)', () => {
    expect(hasBackupSource(pickRegion(39.7, -97))).toBe(true);
    for (const [lat, lon] of [
      [61.2, -149.9],
      [21.3, -157.9],
      [18.5, -66.1],
      [13.4, 144.8],
    ] as const) {
      expect(hasBackupSource(pickRegion(lat, lon))).toBe(false);
    }
    expect(hasBackupSource(null)).toBe(false);
  });
});
