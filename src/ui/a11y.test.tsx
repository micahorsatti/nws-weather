// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMockBundle } from '../mocks';
import { WeatherScreen } from './WeatherScreen';

// Rendering the whole screen in jsdom is slow when the full suite runs its files in parallel: give every test room.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Guards against the page-widening bug: a <table> (or any table part) given the visually-hidden class keeps
 * its full nowrap width, because browsers do not clip table boxes to 1 px. The page then scrolls sideways and
 * mobile Chrome zooms the whole app out. Hidden tables must sit inside a wrapper that carries the class.
 *
 * jsdom has no layout engine, so the real "document does not overflow" measurement is done in the browser;
 * these tests pin down the structural rule that prevents it.
 */
const TABLE_PARTS = 'table, thead, tbody, tfoot, tr, th, td, caption, colgroup, col';
const TABLE_PART_WITH_SR_ONLY = /<(?:table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)\b[^>]*\bsr-only\b/;

const NOW = Date.parse('2026-07-15T18:30:00Z');

afterEach(() => {
  cleanup();
});

describe('visually hidden text', () => {
  // (Vitest replaces every CSS import with an empty string, so the .sr-only rule itself can't be asserted here.)
  it('is never put on a table or table part in the source', () => {
    const files = import.meta.glob(['./**/*.tsx', '../App.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const offenders = Object.entries(files)
      .filter(([, source]) => TABLE_PART_WITH_SR_ONLY.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('is never on a table part in the rendered screen or any of its sheets', () => {
    const bundle = getMockBundle('summer', NOW);
    const loadDiscussion = vi.fn().mockResolvedValue({ wfo: 'TOP', issuedAt: bundle.fetchedAt, text: 'Area Forecast Discussion\nok', url: 'https://forecast.weather.gov/x' });
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={loadDiscussion} />);

    const check = () => {
      const bad = Array.from(document.querySelectorAll(TABLE_PARTS)).filter((el) => el.classList.contains('sr-only'));
      expect(bad).toEqual([]);
    };
    check();
    // The hidden hourly table is wrapped.
    expect(screen.getByTestId('hourly-table').closest('.sr-only')?.tagName).toBe('DIV');

    fireEvent.click(screen.getByRole('radio', { name: 'Next 7 days' }));
    check();
    fireEvent.click(screen.getByRole('button', { name: /Air quality 112/ }));
    check();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Air quality' }), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('alert-banner'));
    check();
  });
});
