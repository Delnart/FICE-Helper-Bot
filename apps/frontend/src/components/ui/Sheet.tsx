'use client';

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../icons';

// When and by which sheet the last one closed — to spot one sheet swapped for another.
let lastClosed: { at: number; by: object | null } = { at: -1e9, by: null };

/**
 * Bottom sheet: scrim + rounded panel with a handle. Closes on scrim tap and Escape.
 * Opens with a scrim fade + slide-up (globals.css); closing unmounts at once.
 */
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

  // Another sheet closed in this same commit (e.g. «Посилання» → «Редагувати»): its scrim is already
  // up, so skip the fade or the backdrop blinks. The old sheet's layout cleanup runs before this
  // effect; `by` ignores StrictMode re-running this sheet's own effect.
  const scrim = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    if (lastClosed.by !== scrim && performance.now() - lastClosed.at < 50) {
      scrim.current?.style.setProperty('animation', 'none');
    }
    return () => {
      lastClosed = { at: performance.now(), by: scrim };
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div ref={scrim} className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <section className="sheet flex flex-col gap-3.5" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="h2 min-w-0 text-[18px]">
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label="Закрити" onClick={onClose}>
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </div>
        {children}
      </section>
    </>
  );
}
