// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { placesStore } from '../state/places';
import { SETTINGS_KEY, settingsStore } from '../state/settings';

// Rendering the whole screen in jsdom is slow when the full suite runs its files in parallel: give every test room.
vi.setConfig({ testTimeout: 30_000 });

// 1:30 PM in Linn, KS: daytime, so the first forecast day has its daytime period.
const NOW = Date.parse('2026-07-15T18:30:00Z');

/** Mount the app inside #root, like index.html does (the dialog helper marks #root inert while a sheet is open). */
function mountApp(search: string) {
  window.history.replaceState({}, '', `/${search}`);
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const utils = render(<App />, { container: root });
  return { root, ...utils };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  localStorage.clear();
  settingsStore.reload();
  placesStore.reload();
  // Freeze only the clock, so the mock bundle and the screen agree on "now" while timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  vi.useRealTimers();
  setOnline(true);
  window.history.replaceState({}, '', '/');
});

describe('App with a mock bundle (?mock=summer)', () => {
  it('shows the top bar, hero and 10-day list', async () => {
    mountApp('?mock=summer');
    expect(await screen.findByTestId('hero')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Linn, KS/ })).toBeTruthy();
    expect(screen.getByTestId('updated').textContent).toBe('Updated 4 min ago');
    expect(screen.getAllByTestId('day-row')).toHaveLength(10);
    expect(screen.getByTestId('alert-banner')).toBeTruthy();
    // The title is set in an effect, which may flush a moment after the DOM appears.
    await waitFor(() => expect(document.title).toBe('Linn, KS · NWS Weather'));
  });

  it('shows no alert banner for the winter mock', async () => {
    mountApp('?mock=winter');
    expect(await screen.findByTestId('hero')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bozeman, MT/ })).toBeTruthy();
    expect(screen.queryByTestId('alert-banner')).toBeNull();
  });

  it('switches from °F to °C with the units toggle in Settings, and remembers it', async () => {
    const { root } = mountApp('?mock=summer');
    await screen.findByTestId('hero');

    const fahrenheit = /(-?\d+)°F/.exec(screen.getByTestId('hero-temp').textContent ?? '');
    expect(fahrenheit).not.toBeNull();
    expect(screen.getByTestId('hero-feels').textContent).toMatch(/Feels like\s+\d+°/);

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settingsButton);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(root.hasAttribute('inert')).toBe(true); // the page behind a dialog is inert

    const imperial = within(dialog).getByRole('radio', { name: /Imperial/ });
    const metric = within(dialog).getByRole('radio', { name: /Metric/ });
    expect(imperial.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(metric);

    const celsius = /(-?\d+)°C/.exec(screen.getByTestId('hero-temp').textContent ?? '');
    expect(celsius).not.toBeNull();
    expect(screen.getByTestId('hero-temp').textContent).not.toMatch(/°F/);
    // Same reading, two scales (each rounded, so allow one degree of slack).
    expect(Math.abs(Number(celsius?.[1]) - ((Number(fahrenheit?.[1]) - 32) * 5) / 9)).toBeLessThan(1);
    expect(metric.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').units).toBe('metric');

    // The hourly chart's axis follows, too.
    expect(screen.getByTestId('hourly').querySelector('.chart__axis')?.textContent).toMatch(/°C/);

    // Escape closes the dialog, unlocks the page and puts focus back on the button that opened it.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(root.hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(settingsButton));
  });

  it('switches back to °F', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Metric/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: /Imperial/ }));
    expect(screen.getByTestId('hero-temp').textContent).toMatch(/°F/);
  });

  it('lets the theme be chosen, and always stamps the resolved theme on <html>', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'System' }));
    await waitFor(() => expect(['light', 'dark']).toContain(document.documentElement.dataset.theme));
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toMatch(/^#/);
  });

  it('saves and masks the AirNow key', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const input = within(dialog).getByLabelText('AirNow API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: '  ABCDEF12-3456-7890-ABCD-EF1234567890  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save key' }));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').airNowKey).toBe('ABCDEF12-3456-7890-ABCD-EF1234567890');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show' }));
    expect(input.type).toBe('text');
    expect(within(dialog).getByText(/Stored only on this device and sent only to AirNow/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /Get a free key/ }).getAttribute('href')).toBe('https://docs.airnowapi.org/account/request/');
  });

  it('credits the data and map sources in Settings', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.textContent).toMatch(/Maps:\s*Esri, HERE, Garmin, © OpenStreetMap contributors/);
    expect(dialog.textContent).not.toMatch(/CARTO/);
    expect(dialog.textContent).toMatch(/National Weather Service/);
  });

  it('shows an unobtrusive banner while offline', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    expect(screen.queryByTestId('status-banner')).toBeNull();
    act(() => setOnline(false));
    expect(screen.getByTestId('status-banner').textContent).toMatch(/^You’re offline — showing data from \d{1,2}:\d{2}\s?[AP]M$/);
    act(() => setOnline(true));
    expect(screen.queryByTestId('status-banner')).toBeNull();
  });

  it('refreshes the mock bundle from the refresh button', async () => {
    mountApp('?mock=summer');
    await screen.findByTestId('hero');
    expect(screen.getByTestId('updated').getAttribute('title')).toBe('Wed, Jul 15, 1:26 PM');
    vi.setSystemTime(NOW + 10 * 60_000);
    fireEvent.click(screen.getByTestId('refresh'));
    // The regenerated bundle was "fetched" 4 minutes before the new time (the on-screen clock ticks every 30 s).
    await waitFor(() => expect(screen.getByTestId('updated').getAttribute('title')).toBe('Wed, Jul 15, 1:36 PM'));
  });
});

describe('App without a place', () => {
  it('welcomes a first-time visitor with location and search', async () => {
    mountApp('');
    const welcome = await screen.findByTestId('welcome');
    expect(within(welcome).getByRole('button', { name: 'Use my location' })).toBeTruthy();
    expect(within(welcome).getByRole('combobox')).toBeTruthy();
    // No place, so no refresh button; the bar shows the app name.
    expect(screen.queryByTestId('refresh')).toBeNull();
    expect(screen.getByRole('heading', { name: 'NWS Weather', level: 1 })).toBeTruthy();
  });
});
