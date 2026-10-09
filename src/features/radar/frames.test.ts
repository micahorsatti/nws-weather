import { describe, expect, it } from 'vitest';
import conusXml from './__fixtures__/conus-capabilities.xml?raw';
import { parseCapabilities } from './capabilities';
import { MESONET_SUFFIXES, buildMesonetFrames, buildWmsFrames, mesonetTileTemplate, sourceKey } from './frames';
import { MINUTE_MS } from './radarTime';
import { RADAR_REGIONS } from './region';

const conus = RADAR_REGIONS.find((r) => r.id === 'conus')!;
const alaska = RADAR_REGIONS.find((r) => r.id === 'alaska')!;
const times = parseCapabilities(conusXml, 'conus_bref_qcd')!.times;

describe('buildWmsFrames', () => {
  const frames = buildWmsFrames(conus, times);

  it('turns the chosen scans into frames, oldest first', () => {
    expect(frames.length).toBeGreaterThanOrEqual(8);
    expect(frames.length).toBeLessThanOrEqual(10);
    expect(frames.map((f) => f.time)).toEqual([...frames.map((f) => f.time)].sort((a, b) => a - b));
    expect(frames[frames.length - 1]?.time).toBe(Date.parse('2026-10-09T02:28:09Z'));
  });

  it('uses the exact ISO time the server advertised as the WMS TIME value', () => {
    for (const f of frames) {
      expect(f.param).toBe(new Date(f.time).toISOString());
      expect(f.param).toMatch(/^2026-10-09T\d\d:\d\d:\d\d\.000Z$/);
      expect(f.approximate).toBe(false);
    }
    expect(frames[frames.length - 1]?.param).toBe('2026-10-09T02:28:09.000Z');
  });

  it('gives each frame a unique id that names its region and scan', () => {
    expect(new Set(frames.map((f) => f.id)).size).toBe(frames.length);
    expect(frames[0]?.id).toMatch(/^wms:conus:2026-10-09T/);
    // Same scan in another region is a different frame (layers must not be reused across regions).
    expect(buildWmsFrames(alaska, times)[0]?.id).toMatch(/^wms:alaska:/);
  });

  it('is empty when the server lists nothing', () => {
    expect(buildWmsFrames(conus, [])).toEqual([]);
  });
});

describe('buildMesonetFrames (backup source)', () => {
  const now = Date.parse('2026-10-09T02:31:20Z');
  const frames = buildMesonetFrames(now);

  it('has six frames at 10-minute spacing, oldest first', () => {
    expect(frames).toHaveLength(MESONET_SUFFIXES.length);
    const gaps = frames.slice(1).map((f, i) => (f.time - (frames[i] as { time: number }).time) / MINUTE_MS);
    expect(gaps).toEqual([10, 10, 10, 10, 10]);
  });

  it('flags every time as an estimate and keeps the newest a few minutes behind real time', () => {
    for (const f of frames) expect(f.approximate).toBe(true);
    const newest = frames[frames.length - 1]!;
    expect(newest.time).toBe(Date.parse('2026-10-09T02:25:00Z')); // floor((02:31:20 - 3 min) / 5 min)
    expect((now - newest.time) / MINUTE_MS).toBeGreaterThanOrEqual(3);
    expect((now - newest.time) / MINUTE_MS).toBeLessThanOrEqual(9);
  });

  it('points at the n0q mosaic layers: -m50m ... -m10m, then the unsuffixed newest', () => {
    expect(frames.map((f) => f.param.match(/nexrad-n0q-900913([^/]*)\//)?.[1])).toEqual(['-m50m', '-m40m', '-m30m', '-m20m', '-m10m', '']);
    for (const f of frames) {
      expect(f.param).toMatch(/^https:\/\/mesonet\.agron\.iastate\.edu\/cache\/tile\.py\/1\.0\.0\/nexrad-n0q-900913/);
      expect(f.param).toContain('/{z}/{x}/{y}.png');
    }
  });

  it('ids and URLs are stable within a 5-minute period and change in the next, so refreshes fetch fresh tiles', () => {
    const sameBucket = buildMesonetFrames(now + 60_000); // 02:32:20, same 5-minute bucket as 02:31:20
    expect(sameBucket.map((f) => f.id)).toEqual(frames.map((f) => f.id));
    expect(sameBucket.map((f) => f.param)).toEqual(frames.map((f) => f.param));
    const nextBucket = buildMesonetFrames(now + 5 * MINUTE_MS);
    for (let i = 0; i < frames.length; i++) {
      expect(nextBucket[i]?.id).not.toBe(frames[i]?.id);
      expect(nextBucket[i]?.param).not.toBe(frames[i]?.param);
    }
    expect(new Set(frames.map((f) => f.id)).size).toBe(frames.length);
  });

  it('builds the tile template with a cache-busting bucket', () => {
    expect(mesonetTileTemplate('', 5971717)).toBe(
      'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?t=5971717',
    );
    expect(mesonetTileTemplate('-m10m', 1)).toContain('nexrad-n0q-900913-m10m/{z}/{x}/{y}.png?t=1');
  });
});

describe('sourceKey', () => {
  it('distinguishes regions and the backup source', () => {
    expect(sourceKey({ kind: 'wms', region: conus })).toBe('wms:conus');
    expect(sourceKey({ kind: 'wms', region: alaska })).toBe('wms:alaska');
    expect(sourceKey({ kind: 'mesonet' })).toBe('mesonet');
  });
});
