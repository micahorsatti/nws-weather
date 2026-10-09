import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Remembers which control the user last activated, so focus can go back to it when a dialog closes.
 * (Safari does not focus buttons on click, so document.activeElement is not reliable at open time.)
 */
let lastTrigger: HTMLElement | null = null;
let listening = false;

function ensureTriggerTracking(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a[href], [role="button"], summary, input') : null;
      if (el) lastTrigger = el;
    },
    true,
  );
}
ensureTriggerTracking();

/** The control that opened the current dialog (the last one clicked or activated), if it is still on the page. */
export function currentOpener(): HTMLElement | null {
  return lastTrigger && document.contains(lastTrigger) ? lastTrigger : (document.activeElement as HTMLElement | null);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

// ---- page lock: the app behind a dialog is inert and does not scroll (counted, so dialogs can overlap)
let openDialogs = 0;
let savedOverflow = '';

function acquireLock(): void {
  if (openDialogs === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.getElementById('root')?.setAttribute('inert', '');
  }
  openDialogs += 1;
}

function releaseLock(): void {
  openDialogs = Math.max(0, openDialogs - 1);
  if (openDialogs === 0) {
    document.body.style.overflow = savedOverflow;
    document.getElementById('root')?.removeAttribute('inert');
  }
}

/** Restore focus to `opener` once the dialog is gone (unless another dialog has taken over). */
function restoreFocus(opener: HTMLElement | null): void {
  window.requestAnimationFrame(() => {
    if (openDialogs === 0 && opener && document.contains(opener)) opener.focus({ preventScroll: true });
  });
}

/** Lock the page behind a self-managed dialog (one that handles its own focus, like the radar view). */
export function usePageLock(): void {
  useEffect(() => {
    acquireLock();
    return releaseLock;
  }, []);
}

/** Focus returns here on unmount. Call from the component that owns the open/close state. */
export function useRestoreFocus(): void {
  useEffect(() => {
    const opener = currentOpener();
    return () => restoreFocus(opener);
  }, []);
}

/**
 * Modal behaviour for a dialog element: focus moves in, Tab is trapped, Escape closes, the page behind is
 * inert and does not scroll, and focus returns to the opener on close.
 */
export function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = currentOpener();
    acquireLock();
    dialog.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape in a search box with text clears the text first; only an empty box closes the dialog.
        if (e.target instanceof HTMLInputElement && e.target.type === 'search' && e.target.value !== '') return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      releaseLock();
      restoreFocus(opener);
    };
    // Runs once per mount: re-running would reset focus. onClose is read through closeRef.
  }, [ref]);
}
