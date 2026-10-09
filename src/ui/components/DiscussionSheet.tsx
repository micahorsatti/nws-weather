import { useEffect, useRef, useState } from 'react';
import type { ForecastDiscussion } from '../../data/types';
import { parseDiscussion } from '../lib/discussion';
import { formatFull, parseTime } from '../lib/time';
import { IconExternal } from './Icons';
import { Sheet } from './Sheet';

export type DiscussionLoader = (wfo: string, signal?: AbortSignal) => Promise<ForecastDiscussion>;

type State = { status: 'loading' } | { status: 'ready'; data: ForecastDiscussion } | { status: 'error'; message: string };

export interface DiscussionSheetProps {
  wfo: string;
  tz: string;
  load: DiscussionLoader;
  onClose: () => void;
}

export function DiscussionSheet({ wfo, tz, load, onClose }: DiscussionSheetProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    loadRef
      .current(wfo, ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => ctrl.abort();
  }, [wfo, attempt]);

  const issued = state.status === 'ready' ? parseTime(state.data.issuedAt) : null;
  const safeUrl = state.status === 'ready' && /^https:\/\//i.test(state.data.url) ? state.data.url : null;

  return (
    <Sheet
      title="Forecaster discussion"
      wide
      onClose={onClose}
      subtitle={state.status === 'ready' ? `NWS ${state.data.wfo}${issued !== null ? ` · issued ${formatFull(issued, tz)}` : ''}` : `NWS ${wfo}`}
    >
      {state.status === 'loading' ? (
        <div className="afd-loading" role="status" aria-live="polite">
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
          <p className="sr-only">Loading the forecaster discussion</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="notice notice--error" role="alert">
          <p>The forecaster discussion couldn&rsquo;t be loaded.</p>
          <p className="muted">{state.message}</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <p className="afd-intro">
            This is the written analysis the forecasters at the National Weather Service office share with each other &mdash; more technical than the
            forecast, and often the best explanation of <em>why</em>.
          </p>
          <div className="afd" data-testid="afd-text">
            {parseDiscussion(state.data.text).map((b, i) => {
              if (b.kind === 'heading') return <h3 key={i} className="afd__heading">{b.text}</h3>;
              if (b.kind === 'rule') return <hr key={i} className="afd__rule" />;
              return (
                <p key={i} className={b.kind === 'pre' ? 'afd__pre' : 'afd__para'}>
                  {b.text}
                </p>
              );
            })}
          </div>
          {safeUrl ? (
            <a className="ext-link" href={safeUrl} target="_blank" rel="noopener noreferrer">
              Open on forecast.weather.gov <IconExternal size={16} />
            </a>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
