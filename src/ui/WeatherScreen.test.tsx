// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMockBundle } from '../mocks';
import type { MockName } from '../mocks';
import type { UnitSystem } from '../lib/units';
import type { RadarViewProps } from '../features/radar/RadarView';
import { WeatherScreen } from './WeatherScreen';

// Rendering the whole screen in jsdom is slow when the full suite runs its files in parallel: give every test room.
vi.setConfig({ testTimeout: 30_000 });

// The radar view is a heavy Leaflet chunk; the integration only needs to know it is mounted with the right props.
vi.mock('../features/radar/RadarView', () => ({
  default: ({ lat, lon, alerts, onClose }: RadarViewProps) => (
    <div role="dialog" aria-label="Fake radar" data-lat={lat} data-lon={lon} data-alerts={alerts.length}>
      <button type="button" onClick={onClose}>
        Close fake radar
      </button>
    </div>
  ),
}));

// 1:30 PM in Linn, KS (CDT) and 12:30 PM in Bozeman, MT (MDT): daytime in both, so every period exists.
const NOW = Date.parse('2026-07-15T18:30:00Z');

function renderScreen(name: MockName, units: UnitSystem = 'imperial') {
  const bundle = getMockBundle(name, NOW);
  const loadDiscussion = vi.fn();
  const utils = render(<WeatherScreen bundle={bundle} now={NOW} units={units} loadDiscussion={loadDiscussion} />);
  return { bundle, loadDiscussion, ...utils };
}

afterEach(() => {
  cleanup();
});

describe('hero', () => {
  it('shows the current temperature with a prominent "Feels like"', () => {
    renderScreen('summer');
    const hero = screen.getByTestId('hero');
    expect(within(hero).getByText('Feels like')).toBeTruthy();
    expect(screen.getByTestId('hero-feels').textContent).toMatch(/^Feels like\s+\d+°$/);
    expect(screen.getByTestId('hero-temp').textContent).toMatch(/\d+°F/);
    expect(screen.getByTestId('hero-hl').textContent).toMatch(/H\s*\d+°.*L\s*\d+°/);
  });

  it('explains humid heat as warmer and wind as colder, without the technical names', () => {
    const { unmount } = renderScreen('summer');
    expect(screen.getByTestId('hero-note').textContent).toBe('Humidity makes it feel warmer');
    unmount();
    renderScreen('winter');
    expect(screen.getByTestId('hero-note').textContent).toBe('Wind makes it feel colder');
    expect(document.body.textContent).not.toMatch(/heat index|wind chill/i);
  });

  it('says where the reading came from', () => {
    renderScreen('summer');
    expect(screen.getByTestId('hero-provenance').textContent).toMatch(/^Observed \d{1,2}:\d{2}\s?[AP]M · Manhattan Regional Airport$/);
  });

  it('falls back to the forecast hour when the station report is stale or missing', () => {
    const bundle = getMockBundle('summer', NOW);
    bundle.current = null;
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={vi.fn()} />);
    expect(screen.getByTestId('hero-provenance').textContent).toBe('Estimated from the forecast');
    expect(screen.getByTestId('hero-feels').textContent).toMatch(/^Feels like\s+\d+°$/);
  });

  it('switches to Celsius when the units are metric', () => {
    renderScreen('summer', 'metric');
    expect(screen.getByTestId('hero-temp').textContent).toMatch(/\d+°C/);
    expect(screen.getByTestId('hero-temp').textContent).not.toMatch(/°F/);
  });
});

describe('10-day list', () => {
  it('renders ten rows with the extended-outlook divider before the GFS days', () => {
    renderScreen('summer');
    const rows = screen.getAllByTestId('day-row');
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 7).every((r) => r.getAttribute('data-extended') === null)).toBe(true);
    expect(rows.slice(7).every((r) => r.getAttribute('data-extended') === 'true')).toBe(true);

    const divider = screen.getByTestId('extended-divider');
    expect(divider.textContent).toMatch(/Extended outlook/);
    expect(divider.textContent).toMatch(/NOAA GFS model, lower confidence/);
    expect(rows[6].compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(rows[7]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('labels today and gives every row a distinct date', () => {
    renderScreen('winter');
    const rows = screen.getAllByTestId('day-row');
    expect(rows[0].textContent).toMatch(/^Today/);
    const dates = rows.map((r) => r.querySelector('small')?.textContent);
    expect(new Set(dates).size).toBe(10);
  });

  it('expands a day to show the forecaster text and the extra details, one at a time', () => {
    renderScreen('summer');
    const rows = screen.getAllByTestId('day-row');
    const first = within(rows[1]).getByRole('button');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const panel = within(rows[1]).getByRole('region');
    expect(within(panel).getByText('Feels like')).toBeTruthy();
    expect(panel.textContent).toMatch(/Chance of precipitation is \d+%/);
    expect(panel.textContent).toMatch(/Sunrise · sunset/);

    // Opening another day closes the first.
    const second = within(rows[2]).getByRole('button');
    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('explains that an extended day is model output rather than a forecaster', () => {
    renderScreen('summer');
    const rows = screen.getAllByTestId('day-row');
    fireEvent.click(within(rows[8]).getByRole('button'));
    expect(within(rows[8]).getByRole('region').textContent).toMatch(/GFS computer model/);
  });

  it('copes with a first day that has no daytime period and no high', () => {
    const bundle = getMockBundle('summer', NOW);
    bundle.daily[0] = { ...bundle.daily[0], day: null, highC: null };
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={vi.fn()} />);
    const rows = screen.getAllByTestId('day-row');
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toMatch(/—/);
    fireEvent.click(within(rows[0]).getByRole('button'));
    expect(within(rows[0]).getByRole('region').textContent).toMatch(/Tonight/);
    // The hero simply omits the high.
    expect(screen.getByTestId('hero-hl').textContent).not.toMatch(/H\s*\d/);
  });

  it('drops days that are already in the past (stale cache)', () => {
    const later = NOW + 2 * 86_400_000;
    const bundle = getMockBundle('summer', NOW);
    render(<WeatherScreen bundle={bundle} now={later} units="imperial" loadDiscussion={vi.fn()} />);
    expect(screen.getAllByTestId('day-row')).toHaveLength(8);
  });
});

describe('alerts', () => {
  it('shows the most severe alert with its end time and a "+2 more" count (summer)', () => {
    renderScreen('summer');
    const banner = screen.getByTestId('alert-banner');
    expect(banner.textContent).toMatch(/Severe Thunderstorm Warning/);
    expect(banner.textContent).toMatch(/until \d{1,2}:\d{2}\s?[AP]M/);
    expect(banner.textContent).toMatch(/\+2 more/);
    expect(banner.className).toMatch(/sev-severe/);
  });

  it('has no banner when there are no alerts (winter)', () => {
    renderScreen('winter');
    expect(screen.queryByTestId('alert-banner')).toBeNull();
  });

  it('opens a sheet listing every alert as plain, reflowed text', () => {
    renderScreen('summer');
    fireEvent.click(screen.getByTestId('alert-banner'));
    const dialog = screen.getByRole('dialog', { name: /Weather alerts/ });
    const items = within(dialog).getAllByTestId('alert-item');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/HAZARD/);
    expect(items[0].textContent).toMatch(/70 mph wind gusts and quarter size hail/);
    expect(items[0].textContent).toMatch(/What to do/);
    // Hard line breaks from the product text are gone: paragraphs, not 65-column lines.
    expect(items[0].textContent).not.toMatch(/\n/);
    expect(dialog.querySelector('a[href^="https://"]')).not.toBeNull();
  });

  it('hides alerts that have already expired', () => {
    const bundle = getMockBundle('summer', NOW);
    render(<WeatherScreen bundle={bundle} now={NOW + 20 * 3_600_000} units="imperial" loadDiscussion={vi.fn()} />);
    expect(screen.queryByTestId('alert-banner')).toBeNull();
  });
});

describe('hourly chart', () => {
  it('selects the current hour so the readout always shows real values', () => {
    const { bundle } = renderScreen('summer');
    const readout = screen.getByTestId('readout');
    expect(readout.textContent).toMatch(/Temperature/);
    expect(readout.textContent).toMatch(/Feels like/);
    expect(readout.textContent).not.toMatch(/Tap an hour|Click or hover over the chart/);
    expect(readout.textContent).toMatch(/Wed 1 PM/);
    expect(bundle.hourly.length).toBeGreaterThan(100);
  });

  it('keeps the hint as a small caption under the chart', () => {
    renderScreen('summer');
    const caption = screen.getByTestId('hourly').querySelector('.chart__caption');
    expect(caption?.textContent).toMatch(/details/);
  });

  it('shows the readout for the hour that was clicked', () => {
    renderScreen('summer');
    const svg = screen.getByTestId('hourly-scroll').querySelector('svg.chart__svg') as SVGSVGElement;
    // 56 px per hour: x = 300 is hour index 5 (6:30 PM).
    fireEvent.click(svg, { clientX: 300 });
    expect(screen.getByTestId('readout').textContent).toMatch(/Wed 6 PM/);
  });

  it('steps through the hours with the arrow keys', () => {
    renderScreen('summer');
    const scroller = screen.getByTestId('hourly-scroll');
    fireEvent.keyDown(scroller, { key: 'ArrowRight' });
    expect(screen.getByTestId('readout').textContent).toMatch(/Wed 2 PM/);
    fireEvent.keyDown(scroller, { key: 'ArrowRight' });
    expect(screen.getByTestId('readout').textContent).toMatch(/Wed 3 PM/);
    fireEvent.keyDown(scroller, { key: 'Escape' });
    expect(screen.getByTestId('readout').textContent).toMatch(/Wed 1 PM/);
  });

  it('switches between 48 hours and 7 days', () => {
    renderScreen('summer');
    const table = () => screen.getByTestId('hourly-table').querySelectorAll('tbody tr').length;
    expect(table()).toBe(48);
    fireEvent.click(screen.getByRole('radio', { name: 'Next 7 days' }));
    expect(table()).toBeGreaterThan(100);
    expect(screen.getByRole('radio', { name: 'Next 7 days' }).getAttribute('aria-checked')).toBe('true');
  });

  it('drops hours that have already passed', () => {
    const bundle = getMockBundle('summer', NOW);
    render(<WeatherScreen bundle={bundle} now={NOW + 5 * 3_600_000} units="imperial" loadDiscussion={vi.fn()} />);
    const firstRow = screen.getByTestId('hourly-table').querySelector('tbody tr th');
    expect(firstRow?.textContent).toMatch(/Wed 6:00 PM/);
  });

  it('offers the same numbers as a text table for assistive technology', () => {
    renderScreen('winter');
    const table = screen.getByTestId('hourly-table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Feels like');
    // The table is hidden by a wrapper; hiding the <table> itself widens the page (see a11y.test.tsx).
    expect(table.classList.contains('sr-only')).toBe(false);
    expect(table.parentElement?.classList.contains('sr-only')).toBe(true);
  });

  it('says so when no precipitation is expected, instead of showing an empty row', () => {
    const bundle = getMockBundle('summer', NOW);
    bundle.hourly = bundle.hourly.map((h) => ({ ...h, precipChancePct: 0, precipMm: 0, snowMm: 0 }));
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={vi.fn()} />);
    expect(screen.getByTestId('hourly').querySelector('.ch-none')?.textContent).toBe('No precipitation expected in the next 48 hours');
    fireEvent.click(screen.getByRole('radio', { name: 'Next 7 days' }));
    expect(screen.getByTestId('hourly').querySelector('.ch-none')?.textContent).toBe('No precipitation expected in the next 7 days');
  });

  it('labels the temperature axis in the chosen unit', () => {
    renderScreen('winter', 'metric');
    expect(screen.getByTestId('hourly').querySelector('.chart__axis')?.textContent).toMatch(/°C/);
  });
});

describe('detail tiles', () => {
  it('shows wind, UV, air quality, precipitation, humidity, pressure and the sun arc', () => {
    renderScreen('summer');
    const tiles = screen.getByTestId('tiles');
    for (const label of ['Wind', 'UV index', 'Air quality', 'Precipitation', 'Humidity', 'Pressure', 'Sunrise & sunset']) {
      expect(within(tiles).getByRole('heading', { name: label })).toBeTruthy();
    }
    expect(tiles.textContent).toMatch(/Unhealthy for Sensitive Groups/);
    expect(tiles.textContent).toMatch(/AirNow/);
  });

  it('names the model as the source when AQI is not official', () => {
    renderScreen('winter');
    expect(screen.getByTestId('tiles').textContent).toMatch(/Open-Meteo model/);
  });

  it('opens the air quality sheet with the scale and the forecast days', () => {
    renderScreen('summer');
    fireEvent.click(screen.getByRole('button', { name: /Air quality 112/ }));
    const dialog = screen.getByRole('dialog', { name: 'Air quality' });
    const scale = within(dialog).getByRole('list', { name: 'Air Quality Index categories' });
    expect(within(scale).getAllByRole('listitem')).toHaveLength(6);
    expect(scale.querySelector('[aria-current="true"]')?.textContent).toMatch(/Unhealthy for Sensitive Groups.*You are here/);
    expect(dialog.textContent).toMatch(/Forecast/);
    expect(dialog.textContent).toMatch(/Ozone concentrations/);
  });
});

describe('forecaster discussion', () => {
  it('loads the discussion for the forecast office and shows it without the routing header', async () => {
    const bundle = getMockBundle('summer', NOW);
    const loadDiscussion = vi.fn().mockResolvedValue({
      wfo: 'TOP',
      issuedAt: bundle.fetchedAt,
      text: '\n000\nFXUS63 KTOP 082323\nAFDTOP\n\nArea Forecast Discussion\nNational Weather Service Topeka KS\n623 PM CDT Wed Jul 15 2026\n\n.KEY MESSAGES...\n\n- Storms are likely this evening.\n',
      url: 'https://forecast.weather.gov/product.php?site=NWS&issuedby=TOP&product=AFD',
    });
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={loadDiscussion} />);
    fireEvent.click(screen.getByRole('button', { name: /forecaster.s discussion/ }));
    const dialog = screen.getByRole('dialog', { name: 'Forecaster discussion' });
    await waitFor(() => expect(within(dialog).getByTestId('afd-text')).toBeTruthy());
    expect(loadDiscussion).toHaveBeenCalledWith('TOP', expect.any(AbortSignal));
    const text = within(dialog).getByTestId('afd-text').textContent ?? '';
    expect(text.startsWith('Area Forecast Discussion')).toBe(true);
    expect(text).not.toMatch(/FXUS63|AFDTOP/);
    expect(dialog.querySelector('a[href="https://forecast.weather.gov/product.php?site=NWS&issuedby=TOP&product=AFD"]')).not.toBeNull();
  });

  it('offers a retry when the discussion cannot be loaded', async () => {
    const loadDiscussion = vi.fn().mockRejectedValueOnce(new Error('NWS is down')).mockResolvedValueOnce({
      wfo: 'TOP',
      issuedAt: '2026-07-15T13:00:00-05:00',
      text: 'Area Forecast Discussion\nok',
      url: 'https://forecast.weather.gov/x',
    });
    const bundle = getMockBundle('summer', NOW);
    render(<WeatherScreen bundle={bundle} now={NOW} units="imperial" loadDiscussion={loadDiscussion} />);
    fireEvent.click(screen.getByRole('button', { name: /forecaster.s discussion/ }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('afd-text')).toBeTruthy());
    expect(loadDiscussion).toHaveBeenCalledTimes(2);
  });
});

describe('radar', () => {
  it('opens the radar view full-screen with the place and alerts, and returns focus on close', async () => {
    renderScreen('summer');
    const opener = screen.getByTestId('radar-card');
    opener.focus();
    fireEvent.click(opener);
    const radar = await screen.findByRole('dialog', { name: 'Fake radar' });
    expect(radar.getAttribute('data-lat')).toBe('39.6797');
    expect(radar.getAttribute('data-lon')).toBe('-96.9064');
    expect(radar.getAttribute('data-alerts')).toBe('3');

    fireEvent.click(within(radar).getByRole('button', { name: 'Close fake radar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fake radar' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('footer', () => {
  it('credits the data sources', () => {
    renderScreen('summer');
    const footer = document.querySelector('footer');
    expect(footer?.textContent).toMatch(/National Weather Service/);
    expect(footer?.textContent).toMatch(/NOAA GFS model via Open-Meteo/);
    expect(footer?.textContent).toMatch(/EPA\s+AirNow/);
    expect(footer?.textContent).toMatch(/Copernicus CAMS/);
    expect(footer?.textContent).toMatch(/Maps: Esri, HERE, Garmin, © OpenStreetMap contributors/);
    expect(footer?.textContent).not.toMatch(/CARTO/);
  });

  it('discloses partial failures quietly, with details on demand', () => {
    renderScreen('winter'); // the winter fixture reports an Open-Meteo UV outage
    const problems = screen.getByTestId('problems');
    expect(problems.textContent).toMatch(/UV temporarily unavailable/);
    expect(within(problems).getByText(/open-meteo-uv/)).toBeTruthy();
  });

  it('shows no disclosure when nothing failed', () => {
    renderScreen('summer');
    expect(screen.queryByTestId('problems')).toBeNull();
  });
});
