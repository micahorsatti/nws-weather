import { describe, expect, it } from 'vitest';
import conusXml from './__fixtures__/conus-capabilities.xml?raw';
import { parseCapabilities } from './capabilities';

const iso = (ms: number) => new Date(ms).toISOString();

/** Minimal capabilities document around a layer body. */
function doc(layers: string): string {
  return `<?xml version="1.0"?><WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Layer><Title/>${layers}</Layer></Capability></WMS_Capabilities>`;
}

describe('parseCapabilities with a real GeoServer response', () => {
  const caps = parseCapabilities(conusXml, 'conus_bref_qcd');

  it('finds the 60 advertised scans, oldest first', () => {
    expect(caps).not.toBeNull();
    expect(caps?.times).toHaveLength(60);
    expect(iso(caps!.times[0] as number)).toBe('2026-10-09T00:30:05.000Z');
    expect(iso(caps!.times[59] as number)).toBe('2026-10-09T02:28:09.000Z');
    expect(caps!.times).toEqual([...caps!.times].sort((a, b) => a - b));
  });

  it('reads the default time, which is the newest scan', () => {
    expect(caps?.defaultTime).toBe(Date.parse('2026-10-09T02:28:09Z'));
    expect(caps?.defaultTime).toBe(caps?.times[59]);
  });

  it('shows the roughly 2-minute scan cadence', () => {
    const t = caps!.times;
    const gaps = t.slice(1).map((v, i) => (v - (t[i] as number)) / 1000);
    expect(Math.min(...gaps)).toBeGreaterThan(80);
    expect(Math.max(...gaps)).toBeLessThan(160);
  });

  it('works without a layer name, and with an unknown one (first time dimension wins)', () => {
    expect(parseCapabilities(conusXml)?.times).toHaveLength(60);
    expect(parseCapabilities(conusXml, 'not_a_layer')?.times).toHaveLength(60);
  });
});

describe('parseCapabilities forms and edge cases', () => {
  it('reads a start/end/period interval', () => {
    const xml = doc('<Layer><Name>a</Name><Dimension name="time" default="2026-10-09T01:00:00Z" units="ISO8601">2026-10-09T00:00:00Z/2026-10-09T01:00:00Z/PT10M</Dimension></Layer>');
    const caps = parseCapabilities(xml, 'a');
    expect(caps?.times).toHaveLength(7);
    expect(caps?.defaultTime).toBe(Date.parse('2026-10-09T01:00:00Z'));
  });

  it('reads a mix of a comma list and an interval', () => {
    const xml = doc('<Layer><Name>a</Name><Dimension name="time">2026-10-08T23:50:00Z,2026-10-09T00:00:00Z/2026-10-09T00:10:00Z/PT5M</Dimension></Layer>');
    expect(parseCapabilities(xml, 'a')?.times.map(iso)).toEqual([
      '2026-10-08T23:50:00.000Z',
      '2026-10-09T00:00:00.000Z',
      '2026-10-09T00:05:00.000Z',
      '2026-10-09T00:10:00.000Z',
    ]);
  });

  it('accepts a WMS 1.1.1 <Extent name="time">', () => {
    const xml = doc('<Layer><Name>a</Name><Extent name="time" default="2026-10-09T00:10:00Z" nearestValue="0">2026-10-09T00:00:00Z,2026-10-09T00:10:00Z</Extent></Layer>');
    expect(parseCapabilities(xml, 'a')?.times).toHaveLength(2);
  });

  it('accepts single-quoted attributes and a namespace prefix', () => {
    const xml = doc("<wms:Layer><wms:Name>a</wms:Name><wms:Dimension units='ISO8601' name='time'>2026-10-09T00:00:00Z</wms:Dimension></wms:Layer>");
    expect(parseCapabilities(xml, 'a')?.times).toHaveLength(1);
  });

  it('uses the default when the dimension body is empty', () => {
    const xml = doc('<Layer><Name>a</Name><Dimension name="time" default="2026-10-09T00:10:00Z"></Dimension></Layer>');
    expect(parseCapabilities(xml, 'a')?.times).toEqual([Date.parse('2026-10-09T00:10:00Z')]);
  });

  it('skips other dimensions, including self-closing ones, to find time', () => {
    const xml = doc('<Layer><Name>a</Name><Dimension name="elevation" units="m"/><Dimension name="run" default="x">r1</Dimension><Dimension name="time">2026-10-09T00:00:00Z</Dimension></Layer>');
    expect(parseCapabilities(xml, 'a')?.times).toHaveLength(1);
  });

  it('ignores a time dimension that only appears inside an XML comment', () => {
    const xml = doc('<!-- <Dimension name="time">2026-01-01T00:00:00Z</Dimension> --><Layer><Name>a</Name><Dimension name="time">2026-10-09T00:00:00Z</Dimension></Layer>');
    expect(parseCapabilities(xml, 'a')?.times.map(iso)).toEqual(['2026-10-09T00:00:00.000Z']);
  });

  it('keeps layers apart: a layer without a time dimension does not borrow its neighbor’s', () => {
    const xml = doc(
      '<Layer><Name>a</Name><Dimension name="time">2026-10-09T00:00:00Z</Dimension></Layer><Layer><Name>b</Name><Title>no time here</Title></Layer>',
    );
    expect(parseCapabilities(xml, 'a')?.times).toHaveLength(1);
    expect(parseCapabilities(xml, 'b')).toBeNull();
  });

  it('picks the requested layer among several', () => {
    const xml = doc(
      '<Layer><Name>a</Name><Dimension name="time">2026-10-09T00:00:00Z</Dimension></Layer><Layer><Name>b</Name><Dimension name="time">2026-10-09T05:00:00Z,2026-10-09T05:10:00Z</Dimension></Layer>',
    );
    expect(parseCapabilities(xml, 'b')?.times.map(iso)).toEqual(['2026-10-09T05:00:00.000Z', '2026-10-09T05:10:00.000Z']);
  });

  it.each([
    ['empty', ''],
    ['an exception document', '<ServiceExceptionReport><ServiceException>Layer not found</ServiceException></ServiceExceptionReport>'],
    ['no time dimension', doc('<Layer><Name>a</Name></Layer>')],
    ['a time dimension with no parseable values', doc('<Layer><Name>a</Name><Dimension name="time">soon</Dimension></Layer>')],
    ['an HTML error page', '<html><body><h1>503 Service Unavailable</h1></body></html>'],
  ])('returns null for %s', (_label, xml) => {
    expect(parseCapabilities(xml, 'a')).toBeNull();
  });
});
