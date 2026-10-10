// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackToClose } from './useModal';

function Dialog({ onClose }: { onClose: () => void }) {
  useBackToClose(onClose);
  return (
    <button type="button" onClick={onClose}>
      Close
    </button>
  );
}

function Host() {
  const [open, setOpen] = useState(true);
  const [closes, setCloses] = useState(0);
  return (
    <>
      <span data-testid="closes">{closes}</span>
      {open ? (
        <Dialog
          onClose={() => {
            setOpen(false);
            setCloses((c) => c + 1);
          }}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
      )}
    </>
  );
}

/** What Android's back gesture does to the page: a popstate. */
const pressBack = () => act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: null })));
const flush = () => act(() => void vi.runAllTimers());

describe('Back closes the top dialog instead of the app', () => {
  let push: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    push = vi.spyOn(window.history, 'pushState');
    // A real history.back() answers with a popstate a moment later.
    back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate', { state: null })), 0);
    });
  });

  afterEach(() => {
    cleanup();
    flush(); // deliver any pop we caused, so module state is clean for the next test
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('adds exactly one history entry per open dialog, even under StrictMode', () => {
    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toEqual({ nwsDialog: true });
  });

  it('closes the dialog on Back without stepping history back a second time', () => {
    render(<Host />);
    flush();
    pressBack();
    expect(screen.getByTestId('closes').textContent).toBe('1');
    expect(screen.getByText('Open')).toBeTruthy();
    flush();
    expect(back).not.toHaveBeenCalled();
  });

  it('removes its entry when closed another way, and that pop never closes the next dialog', () => {
    render(<Host />);
    flush();
    fireEvent.click(screen.getByText('Close'));
    expect(back).toHaveBeenCalledTimes(1);
    // Reopen before our own pop arrives: it must not close the new dialog.
    fireEvent.click(screen.getByText('Open'));
    flush();
    expect(screen.getByText('Close')).toBeTruthy();
    expect(screen.getByTestId('closes').textContent).toBe('1');
    // A real Back now closes it.
    pressBack();
    expect(screen.getByTestId('closes').textContent).toBe('2');
  });

  it('leaves history alone for a dialog that closes before its entry was added', () => {
    const { unmount } = render(<Host />);
    unmount();
    flush();
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('only the top dialog closes when two are open', () => {
    function Two() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(false);
      return (
        <>
          {a ? <Dialog onClose={() => setA(false)} /> : <span>a closed</span>}
          {b ? <Dialog onClose={() => setB(false)} /> : <span>b closed</span>}
          <button type="button" onClick={() => setB(true)}>
            Open b
          </button>
        </>
      );
    }
    render(<Two />);
    flush();
    fireEvent.click(screen.getByText('Open b'));
    flush();
    pressBack();
    expect(screen.getByText('b closed')).toBeTruthy();
    expect(screen.queryByText('a closed')).toBeNull();
    pressBack();
    expect(screen.getByText('a closed')).toBeTruthy();
  });
});
