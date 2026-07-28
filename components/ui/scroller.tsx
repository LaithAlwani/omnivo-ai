"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A vertical scroll area with a custom overlay thumb — an orange oval that
// tracks scroll position and is draggable. The native scrollbar is hidden, so
// it looks and behaves identically on desktop and touch (where native bars are
// overlay/auto-hidden and can't be shaped). The thumb only appears when the
// content actually overflows.
const MIN_THUMB = 28; // px — keeps the marker readable as an oval

export function Scroller({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTop: number } | null>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => (t.visible ? { ...t, visible: false } : t));
      return;
    }
    const track = clientHeight;
    const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * track);
    const maxTop = track - height;
    const range = scrollHeight - clientHeight;
    const top = range > 0 ? (scrollTop / range) * maxTop : 0;
    setThumb({ height, top, visible: true });
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewport.current;
    if (!el) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startTop: el.scrollTop };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = viewport.current;
    if (!el || !drag.current) return;
    const { scrollHeight, clientHeight } = el;
    const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = clientHeight - height;
    const range = scrollHeight - clientHeight;
    const dy = e.clientY - drag.current.startY;
    el.scrollTop = drag.current.startTop + (dy / maxTop) * range;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewport}
        className={`h-full overflow-y-auto pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {thumb.visible && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute right-0.5 w-2 cursor-grab touch-none select-none rounded-full bg-gradient-to-b from-flare to-ember shadow-[0_0_10px_-1px_rgba(255,92,26,0.6)] transition-colors active:cursor-grabbing"
          style={{ height: thumb.height, top: thumb.top }}
          aria-hidden
        />
      )}
    </div>
  );
}
