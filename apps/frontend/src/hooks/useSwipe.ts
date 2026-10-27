'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** +1 = swipe left (next), -1 = swipe right (previous). Returns the switch to make, or null at an end. */
export type SwipeTarget = (dir: 1 | -1) => (() => void) | null;
/** Runs `go` with the swipe's slide: the content leaves against `dir`, the new one comes in from its side. */
export type Slide = (dir: 1 | -1, go: () => void) => void;

const SLOP_PX = 6; // movement before the gesture picks an axis — under the browser's own scroll slop
const H_SLOPE = 1; // tan 45°: up to 45° off horizontal counts as a swipe, steeper is a scroll
const EDGE_PX = 16; // OS / Telegram back gestures start at the screen edges
const COMMIT = 0.15; // share of the width that switches on release
const FLING = 0.2; // px/ms over the last VEL_MS — a light flick switches below COMMIT
const FLING_MIN_PX = 20; // a fling still needs this much travel: iOS reports a tap's jitter from the first pixel
const VEL_MS = 100;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'; // --ease-out
const EASE_SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)'; // --ease-spring

/** Resistance past an end: follows the finger less and less, never beyond a quarter width. */
const rubber = (d: number, w: number) => d / (1 + Math.abs(d) / (w * 0.25));

/**
 * Horizontal swipe between pages of content (touch only; the mouse keeps text selection).
 * Touch Events with a non-passive touchmove: the first moves past SLOP_PX pick the axis. Horizontal
 * (within 45°) → every following move is preventDefault-ed, so the page doesn't scroll; vertical →
 * the gesture is dropped and the page scrolls. (`touch-action: pan-y` would let the browser claim
 * any diagonal move and cancel the swipe.) While dragging the element follows the finger via direct
 * style writes; on release past COMMIT / a fling it slides out, the switch renders, and the new
 * content slides in from the other side. `slide` is for buttons: the switch renders at once (the
 * control reacts on tap) and the new content slides in the same way. A click right after a swipe is
 * swallowed (rows are links). Move / end listeners sit on the touch's own target: touch events keep
 * going to it even when React removes it mid-gesture (the content is re-keyed), never to `el`.
 */
export function useSwipe(target: SwipeTarget): { ref: (el: HTMLElement | null) => void; slide: Slide } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const slideRef = useRef<Slide>((_, go) => go());
  const slide = useCallback<Slide>((dir, go) => slideRef.current(dir, go), []);

  useEffect(() => {
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    type Gesture = {
      x0: number;
      y0: number;
      /** Recent samples, for the release velocity. */
      pts: Array<{ x: number; t: number }>;
      /** Set once the gesture locks horizontal; `x` is where, so the element follows without a jump. */
      locked?: { x: number; w: number; dx: number; next: (() => void) | null; prev: (() => void) | null };
    };
    let g: Gesture | null = null;
    let anim: Animation | null = null;
    /** The switch waiting for the slide-out to end; a new one meanwhile retargets it. */
    let pending: { dir: 1 | -1; go: () => void } | null = null;
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
    const arrive = (dir: 1 | -1) => {
      // Opacity comes from the content's own entrance (.anim-rise on the re-keyed list).
      const w = el.offsetWidth || 1;
      anim = el.animate(
        [{ transform: `translate3d(${dir * w * 0.15}px,0,0)` }, { transform: 'translate3d(0,0,0)' }],
        { duration: 240, easing: EASE_OUT },
      );
    };
    const leave = (dir: 1 | -1, go: () => void, dx: number) => {
      if (reduce.matches) return go();
      pending = { dir, go };
      anim?.cancel();
      const w = el.offsetWidth || 1;
      const out = el.animate(
        [release(), { transform: `translate3d(${dx - dir * w * 0.3}px,0,0)`, opacity: 0 }],
        { duration: 150, easing: EASE_OUT, fill: 'forwards' },
      );
      out.onfinish = () => {
        const p = pending!;
        pending = null;
        flushSync(p.go); // the new day is in the DOM before it slides in
        out.cancel();
        arrive(p.dir);
      };
    };
    slideRef.current = (dir, go) => {
      if (reduce.matches) return go();
      if (pending) {
        // A swipe is leaving: this switch follows its own once it lands.
        const prev = pending.go;
        pending.go = () => {
          prev();
          go();
        };
        return;
      }
      anim?.cancel();
      flushSync(go);
      arrive(dir);
    };

    let tgt: HTMLElement | null = null;
    const unbind = () => {
      tgt?.removeEventListener('touchmove', onMove);
      tgt?.removeEventListener('touchend', onEnd);
      tgt?.removeEventListener('touchcancel', cancel);
      tgt = null;
    };
    const cancel = () => {
      unbind();
      const s = g;
      g = null;
      if (s?.locked) settle();
    };

    const onStart = (e: TouchEvent) => {
      blockClickUntil = 0;
      if (e.touches.length > 1) return cancel(); // a second finger: pinch, not a swipe
      cancel(); // a gesture whose end never arrived
      const t = e.touches[0];
      if (pending || t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) return;
      g = { x0: t.clientX, y0: t.clientY, pts: [{ x: t.clientX, t: e.timeStamp }] };
      tgt = e.target as HTMLElement;
      tgt.addEventListener('touchmove', onMove, { passive: false });
      tgt.addEventListener('touchend', onEnd);
      tgt.addEventListener('touchcancel', cancel);
    };
    const onMove = (e: TouchEvent) => {
      if (!g) return;
      if (e.touches.length > 1) return cancel();
      const t = e.touches[0];
      g.pts.push({ x: t.clientX, t: e.timeStamp });
      while (g.pts[0].t < e.timeStamp - VEL_MS) g.pts.shift();
      if (!g.locked) {
        const dx = Math.abs(t.clientX - g.x0);
        const dy = Math.abs(t.clientY - g.y0);
        if (Math.max(dx, dy) < SLOP_PX) return;
        // Vertical, or the browser already scrolls (its touchmoves stop being cancelable): let it.
        if (dy > dx * H_SLOPE || !e.cancelable) {
          g = null;
          return;
        }
        anim?.cancel();
        g.locked = {
          x: t.clientX,
          w: el.offsetWidth || 1,
          dx: 0,
          next: targetRef.current(1),
          prev: targetRef.current(-1),
        };
      }
      if (e.cancelable) e.preventDefault(); // ours now: the page doesn't scroll
      const l = g.locked;
      const d = t.clientX - l.x;
      l.dx = (d < 0 ? l.next : l.prev) ? d : rubber(d, l.w);
      if (!reduce.matches) place(l.dx, l.w);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length) return;
      unbind();
      if (!g) return;
      const s = g;
      g = null;
      if (!s.locked) return;
      blockClickUntil = performance.now() + 600;
      const { w, dx } = s.locked;
      // From the touch start: Chrome may not deliver moves inside its scroll slop, which would eat a light swipe.
      const d = e.changedTouches[0].clientX - s.x0;
      const dir = d < 0 ? 1 : -1;
      const go = dir === 1 ? s.locked.next : s.locked.prev;
      // Velocity over the last VEL_MS; a finger held still before lifting leaves one sample: no fling.
      const pts = s.pts.filter((p) => p.t >= e.timeStamp - VEL_MS);
      const a = pts[0];
      const b = pts[pts.length - 1];
      const v = pts.length > 1 && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
      const fling = Math.abs(d) > FLING_MIN_PX && Math.abs(v) > FLING && Math.sign(v) === Math.sign(d);
      if (go && d && (Math.abs(d) > w * COMMIT || fling)) leave(dir, go, dx);
      else settle();
    };
    const onClick = (e: MouseEvent) => {
      if (performance.now() >= blockClickUntil) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Does nothing: keeps `el` in the browser's cancelable-touchmove region, which iOS reads at touchstart,
    // before the target's own listener exists — else the moves arrive uncancelable and the swipe is dropped.
    const keepCancelable = () => {};
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', keepCancelable, { passive: false });
    el.addEventListener('click', onClick, true);
    return () => {
      unbind();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', keepCancelable);
      el.removeEventListener('click', onClick, true);
      slideRef.current = (_, go) => go();
      anim?.cancel();
    };
  }, [el]);

  return { ref: setEl, slide };
}
