import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../useModal';
import { IconClose } from './Icons';

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider panel on desktop (the forecaster discussion is monospace and reads better wide). */
  wide?: boolean;
  /** Optional small line under the title. */
  subtitle?: ReactNode;
}

/**
 * A modal dialog: a bottom sheet on phones, a centred panel on larger screens.
 * Escape closes, Tab is trapped, the page behind is inert, and focus returns to the opener.
 */
export function Sheet({ title, onClose, children, wide = false, subtitle }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(panelRef, onClose);

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={wide ? 'sheet sheet--wide' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet__grab" aria-hidden="true" />
        <header className="sheet__head">
          <div className="sheet__titles">
            <h2 id={titleId} className="sheet__title">
              {title}
            </h2>
            {subtitle ? <p className="sheet__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
