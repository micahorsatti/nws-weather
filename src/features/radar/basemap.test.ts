import { describe, expect, it } from 'vitest';
import { MAP_BACKGROUND, attributionFor, attributionText, basemapFor } from './basemap';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows <html data-theme> when it is light or dark, whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to the OS preference when the attribute is missing or not a resolved theme', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
});

describe('basemapFor', () => {
  it('uses the light gray canvas in the light theme and the dark gray canvas in the dark theme', () => {
    const light = basemapFor('light');
    const dark = basemapFor('dark');
    expect(light.base.url).toContain('World_Light_Gray_Base');
    expect(light.labels.url).toContain('World_Light_Gray_Reference');
    expect(dark.base.url).toContain('World_Dark_Gray_Base');
    expect(dark.labels.url).toContain('World_Dark_Gray_Reference');
  });

  it('addresses tiles in Esri order and carries no API key', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const layer of Object.values(basemapFor(theme))) {
        expect(layer.url).toMatch(/^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/Canvas\/.+\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
        expect(layer.url).not.toMatch(/key=|token=/i);
        expect(layer.maxNativeZoom).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('does not use CARTO, whose raster tiles now return an "API KEY REQUIRED" placeholder without a key', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(basemapFor(theme).base.url).not.toContain('cartocdn');
      expect(basemapFor(theme).labels.url).not.toContain('cartocdn');
    }
  });

  it('has a matching background color per theme for tiles that have not loaded yet', () => {
    expect(MAP_BACKGROUND.light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MAP_BACKGROUND.dark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MAP_BACKGROUND.light).not.toBe(MAP_BACKGROUND.dark);
  });
});

describe('attribution', () => {
  it('credits OpenStreetMap, the basemap provider and NOAA/NWS MRMS for the official radar', () => {
    const text = attributionText('wms');
    expect(text).toContain('© OpenStreetMap contributors');
    expect(text).toContain('Esri');
    expect(text).toContain('Radar: NOAA/NWS MRMS');
  });

  it('credits the Iowa Environmental Mesonet when the backup radar is showing', () => {
    const text = attributionText('mesonet');
    expect(text).toContain('© OpenStreetMap contributors');
    expect(text).toContain('Iowa Environmental Mesonet');
    expect(text).not.toContain('MRMS');
  });

  it('links only to https pages', () => {
    for (const kind of ['wms', 'mesonet'] as const) {
      const links = attributionFor(kind).filter((s) => s.href);
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const s of links) expect(s.href).toMatch(/^https:\/\//);
    }
  });
});
