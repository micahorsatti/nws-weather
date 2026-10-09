// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentPosition, searchPlaces } from '../data';
import { GPS_PLACE_ID, placeIdFor } from '../data/types';
import type { Place } from '../data/types';
import { placesStore, selectPlace, usePlaces } from '../state/places';
import { PlaceSearch, SEARCH_DEBOUNCE_MS } from './components/PlaceSearch';
import { PlaceSheet } from './components/PlaceSheet';

// Rendering the whole screen in jsdom is slow when the full suite runs its files in parallel: give every test room.
vi.setConfig({ testTimeout: 30_000 });

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return { ...actual, searchPlaces: vi.fn(), getCurrentPosition: vi.fn() };
});

const searchMock = vi.mocked(searchPlaces);
const locateMock = vi.mocked(getCurrentPosition);

const manhattan: Place = { id: placeIdFor(39.1836, -96.5717), name: 'Manhattan, KS', lat: 39.1836, lon: -96.5717, kind: 'search' };
const manhattanBeach: Place = { id: placeIdFor(33.8847, -118.4109), name: 'Manhattan Beach, CA', lat: 33.8847, lon: -118.4109, kind: 'search' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function type(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  localStorage.clear();
  placesStore.reload();
  searchMock.mockReset();
  locateMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PlaceSearch', () => {
  it('waits for a pause in typing before searching', async () => {
    searchMock.mockResolvedValue([manhattan]);
    render(<PlaceSearch onPick={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await type(input, 'Man');
    await advance(SEARCH_DEBOUNCE_MS - 1);
    expect(searchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith('Man', expect.any(AbortSignal));
    expect(screen.getByRole('option', { name: 'Manhattan, KS' })).toBeTruthy();
  });

  it('restarts the timer on every keystroke', async () => {
    searchMock.mockResolvedValue([]);
    render(<PlaceSearch onPick={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await type(input, 'Ma');
    await advance(200);
    await type(input, 'Man');
    await advance(200);
    expect(searchMock).not.toHaveBeenCalled();
    await advance(100);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith('Man', expect.any(AbortSignal));
  });

  it('aborts a superseded request and ignores its late answer', async () => {
    const first = deferred<Place[]>();
    const second = deferred<Place[]>();
    searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<PlaceSearch onPick={vi.fn()} />);
    const input = screen.getByRole('combobox');

    await type(input, 'Man');
    await advance(SEARCH_DEBOUNCE_MS);
    const firstSignal = searchMock.mock.calls[0][1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    await type(input, 'Manh');
    expect(firstSignal.aborted).toBe(true);
    await advance(SEARCH_DEBOUNCE_MS);
    expect(searchMock).toHaveBeenCalledTimes(2);

    // The first answer arrives late: it must not replace the newer search.
    await act(async () => first.resolve([manhattanBeach]));
    expect(screen.queryByRole('option', { name: /Beach/ })).toBeNull();
    await act(async () => second.resolve([manhattan]));
    expect(screen.getByRole('option', { name: 'Manhattan, KS' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Beach/ })).toBeNull();
  });

  it('does not search for one character or only spaces, and aborts when the text is cleared', async () => {
    searchMock.mockResolvedValue([manhattan]);
    render(<PlaceSearch onPick={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await type(input, 'M');
    await type(input, '   ');
    await advance(1000);
    expect(searchMock).not.toHaveBeenCalled();

    await type(input, 'Man');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole('option', { name: 'Manhattan, KS' })).toBeTruthy();
    await type(input, '');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('says so when nothing matches', async () => {
    searchMock.mockResolvedValue([]);
    render(<PlaceSearch onPick={vi.fn()} />);
    await type(screen.getByRole('combobox'), 'Atlantis');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole('status').textContent).toMatch(/No matches in the United States for .Atlantis./);
  });

  it('reports a failed search and lets the user try again', async () => {
    searchMock.mockRejectedValueOnce(new Error('Geocoder is down')).mockResolvedValueOnce([manhattan]);
    render(<PlaceSearch onPick={vi.fn()} />);
    await type(screen.getByRole('combobox'), 'Man');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByRole('alert').textContent).toMatch(/Search isn.t working right now\. Geocoder is down/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await advance(SEARCH_DEBOUNCE_MS);
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('option', { name: 'Manhattan, KS' })).toBeTruthy();
  });

  it('picks with the mouse or with the keyboard', async () => {
    searchMock.mockResolvedValue([manhattan, manhattanBeach]);
    const onPick = vi.fn();
    render(<PlaceSearch onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await type(input, 'Man');
    await advance(SEARCH_DEBOUNCE_MS);

    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenLastCalledWith(manhattanBeach);

    fireEvent.click(options[0]);
    expect(onPick).toHaveBeenLastCalledWith(manhattan);
  });
});

function Harness({ onClose }: { onClose: () => void }) {
  const places = usePlaces();
  return <PlaceSheet places={places} currentName={places.selected?.name ?? null} onClose={onClose} />;
}

describe('PlaceSheet', () => {
  it('stars the current place, lists it, and removes it again', async () => {
    selectPlace(manhattan);
    render(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Places' });
    expect(within(dialog).getByText('Star a place to keep it here for quick switching.')).toBeTruthy();

    const star = within(dialog).getByRole('button', { name: 'Save' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      fireEvent.click(star);
    });
    expect(placesStore.get().saved).toEqual([{ ...manhattan, kind: 'saved' }]);
    expect(within(dialog).getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Remove Manhattan, KS' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Manhattan, KS' }));
    });
    expect(placesStore.get().saved).toEqual([]);
  });

  it('switches to a saved place and closes', async () => {
    selectPlace(manhattan);
    placesStore.set((s) => ({ ...s, saved: [{ ...manhattanBeach, kind: 'saved' }] }));
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manhattan Beach, CA' }));
    });
    expect(placesStore.get().selected?.id).toBe(manhattanBeach.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('uses the device location as the "Current location" place', async () => {
    locateMock.mockResolvedValue({ lat: 39.6797, lon: -96.9064, accuracyM: 20 });
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    });
    expect(placesStore.get().selected).toMatchObject({ id: GPS_PLACE_ID, kind: 'gps', name: 'Current location', lat: 39.6797, lon: -96.9064 });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the reason when the location cannot be read, and stays open', async () => {
    locateMock.mockRejectedValue(new Error('Location permission was denied. You can allow it in your browser settings.'));
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/permission was denied/);
    expect(onClose).not.toHaveBeenCalled();
    expect(placesStore.get().selected).toBeNull();
  });

  it('selects a search result and closes', async () => {
    searchMock.mockResolvedValue([manhattan]);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await type(screen.getByRole('combobox'), 'Manhattan');
    await advance(SEARCH_DEBOUNCE_MS);
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Manhattan, KS' }));
    });
    expect(placesStore.get().selected).toEqual(manhattan);
    expect(onClose).toHaveBeenCalled();
  });
});
