'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../icons';

/** Bottom sheet: scrim + rounded panel with a handle. Closes on scrim tap and Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  // Callers usually pass an inline arrow; keep it in a ref so the effect only runs on open/close.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    // Lock the page behind the sheet. It must be <html>: its overflow is what the viewport
    // scrolls by (globals.css), so overflow on <body> wouldn't stop the page scrolling.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <section className="sheet flex flex-col gap-3.5" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="h2 text-[18px]">
            {title}
          </h2>
          <button type="button" className="icon-btn-plain -mr-2.5" aria-label="Закрити" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        {children}
      </section>
    </>
  );
}
