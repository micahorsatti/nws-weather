import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getCurrentPosition, searchPlaces } from '../../data';
import type { Place } from '../../data/types';
import { selectGps } from '../../state/places';
import { IconLocate, IconPin, IconSearch } from './Icons';

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; results: Place[] }
  | { status: 'error'; message: string };

/** Debounce between the last keystroke and the network request. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface PlaceSearchProps {
  onPick: (place: Place) => void;
  autoFocus?: boolean;
  label?: string;
}

/** City or ZIP search. Each keystroke restarts a 300 ms timer; an in-flight request is aborted when superseded. */
export function PlaceSearch({ onPick, autoFocus, label = 'Search for a city or ZIP code' }: PlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (q.length < 2) {
      setState({ status: 'idle' });
      setActive(-1);
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    const timer = window.setTimeout(() => {
      searchPlaces(q, ctrl.signal)
        .then((results) => {
          if (ctrl.signal.aborted) return;
          setState({ status: 'ready', results });
          setActive(results.length ? 0 : -1);
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
          setState({ status: 'error', message: err instanceof Error && err.message ? err.message : 'Search failed.' });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, attempt]);

  const results = state.status === 'ready' ? state.results : [];

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results.length) {
      e.preventDefault();
      onPick(results[Math.max(0, active)]);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    }
  };

  return (
    <div className="psearch">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="psearch__box">
        <IconSearch size={18} className="psearch__icon" />
        <input
          id={inputId}
          ref={inputRef}
          className="psearch__input"
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && results[active] ? `${listId}-${active}` : undefined}
          placeholder="City or ZIP code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="search"
        />
        {state.status === 'loading' ? <span className="spinner" role="status" aria-label="Searching" /> : null}
      </div>

      <ul id={listId} role="listbox" aria-label="Search results" className="psearch__list" hidden={results.length === 0}>
        {results.map((p, i) => (
          <li
            key={p.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'psearch__item is-active' : 'psearch__item'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(p)}
            onMouseEnter={() => setActive(i)}
          >
            <IconPin size={18} />
            <span>{p.name}</span>
          </li>
        ))}
      </ul>

      {state.status === 'ready' && results.length === 0 ? (
        <p className="psearch__note" role="status">
          No matches in the United States for &ldquo;{q}&rdquo;. Try a city name or a 5-digit ZIP code.
        </p>
      ) : null}
      {state.status === 'error' ? (
        <>
          <p className="psearch__note psearch__note--error" role="alert">
            Search isn&rsquo;t working right now. {state.message}
          </p>
          <button type="button" className="btn btn--quiet" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </>
      ) : null}
    </div>
  );
}

/** "Use my location": asks the browser for a fix and selects the GPS place. */
export function useLocate(onDone?: () => void) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const pos = await getCurrentPosition();
      selectGps(pos.lat, pos.lon);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'We couldn’t get your location.');
    } finally {
      setLocating(false);
    }
  }, [onDone]);
  return { locate, locating, error };
}

export function LocateButton({ onDone, className }: { onDone?: () => void; className?: string }) {
  const { locate, locating, error } = useLocate(onDone);
  return (
    <>
      <button type="button" className={className ?? 'btn btn--primary btn--block'} onClick={locate} disabled={locating}>
        {locating ? <span className="spinner spinner--inline" aria-hidden="true" /> : <IconLocate size={18} />}
        {locating ? 'Finding you…' : 'Use my location'}
      </button>
      {error ? (
        <p className="psearch__note psearch__note--error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
