'use client';

import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

export interface FilterOption<T extends string> {
  id: T;
  label: string;
  /** Full name when `label` is an abbreviation: tooltip + accessible name. */
  title?: string;
}

/**
 * One row of filter chips that never wraps (scrolls sideways, edge to edge). The ink pill
 * slides to the active chip; chips differ in width, so it is placed from the chip's own box.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: Array<FilterOption<T>>;
  value: T;
  onChange: (id: T) => void;
  'aria-label': string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  // Chips come and go (e.g. the journal's disciplines per week): re-place when the set changes.
  const set = options.map((o) => `${o.id}\n${o.label}`).join('\n\n');

  useLayoutEffect(() => {
    const r = row.current;
    const p = pill.current;
    if (!r || !p) return;
    const active = () => r.querySelector<HTMLElement>('[aria-pressed="true"]');
    // First placement jumps there; later ones slide (transition in globals.css).
    const first = !p.style.width;
    const place = () => {
      const on = active();
      if (!on) return;
      const jump = !p.style.width;
      if (jump) p.style.transition = 'none';
      p.style.width = `${on.offsetWidth}px`;
      p.style.transform = `translateX(${on.offsetLeft}px)`;
      if (jump) {
        void p.offsetWidth; // commit the jump before the transition comes back
        p.style.transition = '';
      }
    };
    place();

    // Bring the active chip into view (only this row scrolls, never the page): centred, so its
    // neighbours show too. Instant on open (a preselected chip), smooth on a change.
    const on = active();
    if (on && (on.offsetLeft < r.scrollLeft || on.offsetLeft + on.offsetWidth > r.scrollLeft + r.clientWidth)) {
      const still = first || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      r.scrollTo({ left: on.offsetLeft - (r.clientWidth - on.offsetWidth) / 2, behavior: still ? 'auto' : 'smooth' });
    }

    // Chip widths change when the web font swaps in (or the text scales) — follow them.
    const ro = new ResizeObserver(place);
    r.querySelectorAll('button').forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [value, set]);

  return (
    <div ref={row} className="chips-slide scroll-x -mx-4 px-4" role="group" aria-label={ariaLabel}>
      <span ref={pill} className="slide-pill" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          aria-label={o.title}
          title={o.title}
          // 10px sides fit the Subjects filters on a 360px phone; a bit roomier from 390px.
          className={cn('chip chip-btn px-2.5 min-[390px]:px-3', value === o.id && 'chip-ink')}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
