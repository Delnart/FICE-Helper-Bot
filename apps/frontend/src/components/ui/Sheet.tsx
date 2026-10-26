'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
  // Callers usually pass an inline arrow; keep it in a ref so the effect only runs on open/close.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <section className="sheet flex flex-col gap-3.5" role="dialog" aria-modal="true">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="h2 text-lg">{title}</h2>
          <button type="button" className="icon-btn-plain -mr-2.5" aria-label="Закрити" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </>
  );
}
