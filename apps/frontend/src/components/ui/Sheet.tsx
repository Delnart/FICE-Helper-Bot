'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from '../icons';

// When and by which sheet the last one closed — to spot one sheet swapped for another.
let lastClosed: { at: number; by: object | null } = { at: -1e9, by: null };
// Sheets holding the page scroll lock: one can open while another still plays its exit.
let locks = 0;
// Exit length: the `.closing` transitions in globals.css.
const EXIT_MS = 200;

/**
 * Bottom sheet: scrim + rounded panel with a handle. Closes on ✕, scrim tap and Escape.
 * Opens with a scrim fade + slide-up and closes with the reverse (globals.css): a user close plays the
 * exit and then calls onClose; `open` turning false plays it before the panel goes. A parent that
 * unmounts the Sheet itself (`{cond ? <Sheet open … /> : null}`) skips it.
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
  // Callers usually pass an inline arrow; keep it in a ref so effects don't re-run on it.
  const close = useRef(onClose);
  close.current = onClose;
  const isOpen = useRef(open);
  isOpen.current = open;

  // `alive`: in the DOM — open or playing the exit. `dismissed`: closed by the user, onClose still due.
  const [alive, setAlive] = useState(open);
  const [dismissed, setDismissed] = useState(false);
  if (open && !alive) setAlive(true);
  const closing = alive && (!open || dismissed);
  const dismiss = () => setDismissed(true);
  // Keep the open content through the exit (e.g. a title from state the parent just cleared).
  const shown = useRef({ title, children });
  if (open) shown.current = { title, children };

  // A timer, not transitionend: reduced motion or a hidden tab may never fire it.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(
      () => {
        setAlive(false);
        setDismissed(false);
        if (isOpen.current) close.current(); // user close: the parent hears of it once the exit is over
      },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS,
    );
    return () => clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDismissed(true);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock the page behind the sheet until the exit ends (or the sheet unmounts). It must be <html>: its
  // overflow is what the viewport scrolls by (globals.css), so overflow on <body> wouldn't stop it.
  useEffect(() => {
    if (!alive) return;
    const root = document.documentElement;
    if (locks++ === 0) root.style.overflow = 'hidden';
    return () => {
      if (--locks === 0) root.style.overflow = '';
    };
  }, [alive]);

  // Another sheet closed in this same commit (e.g. «Посилання» → «Редагувати»): its scrim is already
  // up, so skip the fade or the backdrop blinks. The old sheet's layout cleanup runs before this
  // effect; `by` ignores StrictMode re-running this sheet's own effect.
  const settled = alive && !closing;
  const scrim = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!settled) return;
    if (lastClosed.by !== scrim && performance.now() - lastClosed.at < 50) {
      scrim.current?.style.setProperty('animation', 'none');
    }
    return () => {
      lastClosed = { at: performance.now(), by: scrim };
    };
  }, [settled]);

  // Exit start: drop focus inside (iOS keeps the keyboard up through the exit otherwise), and freeze a
  // still-running entrance where it is: it outranks the exit transition, which then starts from that
  // spot. getAnimations() already sees `.closing`, hence the explicit keyframe ends in globals.css.
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!closing) return;
    if (panel.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    for (const el of [panel.current, scrim.current]) {
      const running = el?.getAnimations?.() ?? [];
      if (!el || !running.length) continue;
      running.forEach((a) => {
        a.commitStyles();
        a.cancel();
      });
      void getComputedStyle(el).opacity; // style the frozen spot, so the transition starts there
      el.style.transform = el.style.opacity = '';
    }
  }, [closing]);

  if (!alive) return null;
  return (
    <>
      <div
        ref={scrim}
        className={cn('sheet-scrim', closing && 'closing')}
        aria-hidden="true"
        onClick={closing ? undefined : dismiss}
      />
      <section
        ref={panel}
        className={cn('sheet flex flex-col gap-3.5', closing && 'closing')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="h2 min-w-0 text-[18px]">
            {shown.current.title}
          </h2>
          <button type="button" className="sheet-close" aria-label="Закрити" onClick={dismiss}>
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </div>
        {shown.current.children}
      </section>
    </>
  );
}
