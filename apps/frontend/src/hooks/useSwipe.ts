'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** +1 = swipe left (next), -1 = swipe right (previous). Returns the switch to make, or null at an end. */
export type SwipeTarget = (dir: 1 | -1) => (() => void) | null;

const LOCK_PX = 10; // movement before the gesture picks an axis
const EDGE_PX = 16; // OS / Telegram back gestures start at the screen edges
const COMMIT = 0.25; // share of the width that switches on release
const FLING = 0.4; // px/ms — a quick flick switches below COMMIT
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'; // --ease-out
const EASE_SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)'; // --ease-spring

/** Resistance past an end: follows the finger less and less, never beyond a quarter width. */
const rubber = (d: number, w: number) => d / (1 + Math.abs(d) / (w * 0.25));

/**
 * Horizontal swipe between pages of content (touch and pen; the mouse keeps text selection).
 * `touch-action: pan-y` leaves vertical scrolling to the browser and hands horizontal moves to us.
 * While dragging the element follows the finger via direct style writes (no React state per move);
 * on release past COMMIT / a fling it slides out, the switch renders, and the new content slides in
 * from the other side. A click right after a swipe is swallowed (rows are links). Returns a callback ref.
 */
export function useSwipe(target: SwipeTarget) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    el.style.touchAction = 'pan-y';

    type Gesture = {
      id: number;
      x0: number;
      y0: number;
      /** Last sample, for the release velocity. */
      x: number;
      t: number;
      v: number;
      /** Set once the gesture locks horizontal. */
      locked?: { w: number; dx: number; next: (() => void) | null; prev: (() => void) | null };
    };
    let g: Gesture | null = null;
    let anim: Animation | null = null;
    let leaving = false;
    let blockClickUntil = 0;

    const place = (dx: number, w: number) => {
      el.style.transform = `translate3d(${dx}px,0,0)`;
      el.style.opacity = String(1 - Math.min(Math.abs(dx) / w, 1) * 0.4);
    };
    const release = () => {
      const from = { transform: el.style.transform || 'translate3d(0,0,0)', opacity: el.style.opacity || '1' };
      el.style.transform = '';
      el.style.opacity = '';
      return from;
    };
    const settle = () => {
      const from = release();
      if (!reduce.matches) {
        anim = el.animate([from, { transform: 'translate3d(0,0,0)', opacity: 1 }], { duration: 240, easing: EASE_SPRING });
      }
    };
    const leave = (dir: 1 | -1, go: () => void, dx: number, w: number) => {
      if (reduce.matches) return go();
      leaving = true;
      const out = el.animate(
        [release(), { transform: `translate3d(${dx - dir * w * 0.3}px,0,0)`, opacity: 0 }],
        { duration: 150, easing: EASE_OUT, fill: 'forwards' },
      );
      out.onfinish = () => {
        flushSync(go); // the new day is in the DOM before it slides in
        out.cancel();
        leaving = false;
        // Opacity comes from the content's own entrance (.anim-rise on the re-keyed list).
        anim = el.animate(
          [{ transform: `translate3d(${dir * w * 0.15}px,0,0)` }, { transform: 'translate3d(0,0,0)' }],
          { duration: 240, easing: EASE_OUT },
        );
      };
    };
    const cancel = () => {
      const s = g;
      g = null;
      if (s?.locked) settle();
    };

    const onDown = (e: PointerEvent) => {
      if (g || leaving || e.pointerType === 'mouse' || !e.isPrimary) return;
      if (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t: e.timeStamp, v: 0 };
    };
    // On window: a second finger anywhere cancels; any new press ends the click block.
    const onAnyDown = (e: PointerEvent) => {
      blockClickUntil = 0;
      if (g && e.pointerId !== g.id) cancel();
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dt = e.timeStamp - g.t;
      if (dt > 0) g.v = 0.6 * ((e.clientX - g.x) / dt) + 0.4 * g.v;
      g.x = e.clientX;
      g.t = e.timeStamp;
      if (!g.locked) {
        const dx = e.clientX - g.x0;
        const dy = e.clientY - g.y0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g = null; // vertical: the page scrolls
          return;
        }
        anim?.cancel();
        g.x0 = e.clientX; // start following from here, no jump
        g.locked = { w: el.offsetWidth || 1, dx: 0, next: targetRef.current(1), prev: targetRef.current(-1) };
      }
      const l = g.locked;
      const d = e.clientX - g.x0;
      l.dx = (d < 0 ? l.next : l.prev) ? d : rubber(d, l.w);
      if (!reduce.matches) place(l.dx, l.w);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g;
      g = null;
      if (!s.locked) return;
      blockClickUntil = performance.now() + 600;
      const { w, dx } = s.locked;
      const d = e.clientX - s.x0;
      const dir = d < 0 ? 1 : -1;
      const go = dir === 1 ? s.locked.next : s.locked.prev;
      const v = e.timeStamp - s.t < 100 ? s.v : 0; // finger held still before lifting: no fling
      const fling = Math.abs(v) > FLING && Math.sign(v) === Math.sign(d);
      if (go && d && (Math.abs(d) > w * COMMIT || fling)) leave(dir, go, dx, w);
      else settle();
    };
    const onCancel = (e: PointerEvent) => {
      if (g && e.pointerId === g.id) cancel();
    };
    const onClick = (e: MouseEvent) => {
      if (performance.now() >= blockClickUntil) return;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick, true);
    window.addEventListener('pointerdown', onAnyDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick, true);
      window.removeEventListener('pointerdown', onAnyDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      anim?.cancel();
    };
  }, [el]);

  return setEl;
}
