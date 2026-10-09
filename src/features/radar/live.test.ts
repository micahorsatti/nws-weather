/**
 * Live checks against the real radar services. Skipped unless RADAR_LIVE=1, so the normal suite stays
 * offline and deterministic:
 *
 *   RADAR_LIVE=1 npx vitest run src/features/radar/live
 *
 * Run it when region.ts changes or when radar looks wrong, to confirm each region's layer name, time
 * dimension and bounds still match what NOAA serves.
 */
import { describe, expect, it } from 'vitest';
import { parseCapabilities } from './capabilities';
import { buildMesonetFrames } from './frames';
import { MINUTE_MS } from './radarTime';
import { RADAR_REGIONS, capabilitiesUrl, wmsEndpoint } from './region';

// The app tsconfig has no Node types; Vitest runs this file in Node, where `process` exists.
declare const process: { env: Record<string, string | undefined> };

const LIVE = process.env.RADAR_LIVE === '1';
const suite = LIVE ? describe : describe.skip;

/** EX_GeographicBoundingBox of the first layer that has a Name, as [south, west, north, east]. */
function advertisedBounds(xml: string, layer: string): [number, number, number, number] {
  const from = xml.indexOf(`<Name>${layer}</Name>`);
  const m = /<EX_GeographicBoundingBox>\s*<westBoundLongitude>([^<]+)<\/westBoundLongitude>\s*<eastBoundLongitude>([^<]+)<\/eastBoundLongitude>\s*<southBoundLatitude>([^<]+)<\/southBoundLatitude>\s*<northBoundLatitude>([^<]+)<\/northBoundLatitude>/.exec(
    xml.slice(from),
  );
  if (!m) throw new Error(`no bounding box for ${layer}`);
  const [west, east, south, north] = m.slice(1, 5).map(Number) as [number, number, number, number];
  return [south, west, north, east];
}

suite('live MRMS WMS (opengeo.ncep.noaa.gov)', () => {
  for (const region of RADAR_REGIONS) {
    describe(region.id, () => {
      it('advertises the expected layer, a recent time dimension and matching bounds', async () => {
        const res = await fetch(capabilitiesUrl(region));
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        const xml = await res.text();

        expect(xml).toContain(`<Name>${region.layer}</Name>`);

        const caps = parseCapabilities(xml, region.layer);
        expect(caps).not.toBeNull();
        const times = caps!.times;
        expect(times.length).toBeGreaterThan(30); // about two hours of 2-minute scans
        const newest = times[times.length - 1] as number;
        expect(caps!.defaultTime).toBe(newest);
        expect(Date.now() - newest).toBeLessThan(30 * MINUTE_MS); // fresh data

        const [south, west, north, east] = advertisedBounds(xml, region.layer);
        const [rs, rw, rn, re] = region.bounds;
        for (const [advertised, ours] of [
          [south, rs],
          [west, rw],
          [north, rn],
          [east, re],
        ] as const) {
          expect(Math.abs(advertised - ours)).toBeLessThan(0.01);
        }
      });

      it('serves a transparent PNG GetMap tile for the newest scan, with CORS', async () => {
        const caps = parseCapabilities(await (await fetch(capabilitiesUrl(region))).text(), region.layer)!;
        const time = new Date(caps.times[caps.times.length - 1] as number).toISOString();
        const [south, west, north, east] = region.bounds;
        // A 512 px EPSG:4326 image over the region's middle, as 1.3.0 wants it (lat, lon axis order).
        const midLat = (south + north) / 2;
        const midLon = (west + east) / 2;
        const url =
          `${wmsEndpoint(region)}?service=WMS&version=1.3.0&request=GetMap&layers=${region.layer}&styles=` +
          `&format=image%2Fpng&transparent=true&width=512&height=512&crs=EPSG%3A4326` +
          `&bbox=${midLat - 2},${midLon - 2},${midLat + 2},${midLon + 2}&time=${encodeURIComponent(time)}`;
        const res = await fetch(url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('image/png');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        const bytes = new Uint8Array(await res.arrayBuffer());
        expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
      });
    });
  }
});

suite('live backup source (Iowa Environmental Mesonet)', () => {
  it('serves a PNG tile for every backup frame, with CORS', async () => {
    for (const frame of buildMesonetFrames(Date.now())) {
      const url = frame.param.replace('{z}', '7').replace('{x}', '29').replace('{y}', '48');
      const res = await fetch(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});
