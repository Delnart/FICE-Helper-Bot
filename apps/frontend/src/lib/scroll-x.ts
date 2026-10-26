/**
 * Desktop support for `.scroll-x` strips (chip filters, the journal grid).
 * Touch screens swipe them natively; with a mouse there was no way to scroll
 * sideways (scrollbars are hidden by design). Adds:
 *  - wheel → horizontal scroll over short strips (chip rows), so the page still
 *    scrolls vertically over tall ones like the journal table;
 *  - click-and-drag scrolling with the mouse, without firing a click after a drag.
 * Returns a cleanup function.
 */
const SHORT_STRIP_PX = 96;
const DRAG_THRESHOLD_PX = 5;

export function enableDesktopScrollX(): () => void {
  const stripOf = (t: EventTarget | null) =>
    t instanceof Element ? (t.closest('.scroll-x') as HTMLElement | null) : null;

  const onWheel = (e: WheelEvent) => {
    const el = stripOf(e.target);
    if (!el || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    if (el.clientHeight > SHORT_STRIP_PX || el.scrollWidth <= el.clientWidth) return;
    const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
    if (atStart || atEnd) return; // let the page scroll once the strip is at its edge
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };

  let drag: { el: HTMLElement; x: number; left: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = stripOf(e.target);
    if (el && el.scrollWidth > el.clientWidth) drag = { el, x: e.clientX, left: el.scrollLeft, moved: false };
  };
  // Released outside the window / iframe (no pointerup reaches us), cancelled, or the window
  // lost focus: drop the drag without swallowing a click, so the strip doesn't stay glued to the cursor.
  const cancel = () => {
    drag = null;
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    if (e.buttons === 0) return cancel();
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    drag.el.scrollLeft = drag.left - dx;
  };
  const onUp = () => {
    if (drag?.moved) {
      // Swallow the click that follows the drag so chips/marks aren't toggled.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    drag = null;
  };

  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  return () => {
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
  };
}
