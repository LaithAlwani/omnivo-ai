"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// Horizontal day strip + slots for the active day. Reactive to bookings.
// Used by the new-booking form and the reschedule modal.
export function SlotPicker({
  slug,
  staffId,
  serviceId,
  selected,
  onSelect,
}: {
  slug: string;
  staffId: "any" | Id<"staff">;
  serviceId?: Id<"services">;
  selected: number | null;
  onSelect: (start: number) => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Desktop arrows nudge the day strip by roughly three cells; the strip still
  // scrolls by touch/trackpad on mobile (where the arrows are hidden).
  const scrollStrip = (dir: -1 | 1) =>
    stripRef.current?.scrollBy({ left: dir * 220, behavior: "smooth" });
  const slots = useQuery(api.slots.getSlots, {
    slug,
    staffId,
    serviceId,
    fromMs: nowMs,
    days: 14,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, { start: number; end: number }[]>();
    for (const s of slots ?? []) {
      if (s.start <= nowMs) continue;
      const key = new Date(s.start).toDateString();
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [slots, nowMs]);

  const days = useMemo(() => {
    const base = new Date(nowMs);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const key = d.toDateString();
      return {
        key,
        weekday: d.toLocaleDateString([], { weekday: "short" }),
        dayNum: d.getDate(),
        slots: byDay.get(key) ?? [],
      };
    });
  }, [nowMs, byDay]);

  const activeKey =
    selectedDay ?? days.find((d) => d.slots.length > 0)?.key ?? days[0]?.key;
  const activeDay = days.find((d) => d.key === activeKey);

  if (slots === undefined) {
    return <p className="text-sm text-faint">Loading slots…</p>;
  }

  return (
    <div>
      <div className="flex items-stretch gap-2">
        {/* Desktop-only scroll arrow (left). Hidden on mobile, which swipes. */}
        <button
          type="button"
          onClick={() => scrollStrip(-1)}
          aria-label="Earlier days"
          className="hidden w-8 shrink-0 items-center justify-center rounded-xl border border-line-strong text-bone-dim transition-colors hover:border-ember/50 hover:text-bone sm:flex"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Day strip — scrollbar hidden (invisible on mobile too). */}
        <div
          ref={stripRef}
          className="flex w-full min-w-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {days.map((d) => {
            const has = d.slots.length > 0;
            const active = d.key === activeKey;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDay(d.key)}
                className={`flex w-16 shrink-0 flex-col items-center rounded-xl border px-2 py-2.5 transition-colors ${
                  active
                    ? "border-ember bg-ember-soft"
                    : has
                      ? "border-line-strong hover:border-ember/50"
                      : "border-line opacity-45"
                }`}
              >
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-faint">
                  {d.weekday}
                </span>
                <span
                  className={`mt-0.5 font-display text-2xl leading-none ${
                    active ? "text-bone" : "text-bone-dim"
                  }`}
                >
                  {d.dayNum}
                </span>
                <span className="mt-1 h-1.5">
                  {has && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-ember" />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Desktop-only scroll arrow (right). */}
        <button
          type="button"
          onClick={() => scrollStrip(1)}
          aria-label="Later days"
          className="hidden w-8 shrink-0 items-center justify-center rounded-xl border border-line-strong text-bone-dim transition-colors hover:border-ember/50 hover:text-bone sm:flex"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="m6 3 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-4">
        {activeDay && activeDay.slots.length > 0 ? (
          <>
            <p className="font-mono text-xs uppercase tracking-wider text-faint">
              {fmtDay(activeDay.slots[0].start)}
            </p>
            <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {activeDay.slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => onSelect(s.start)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    selected === s.start
                      ? "border-ember bg-ember text-[#160b04]"
                      : "border-line-strong text-bone-dim hover:border-ember/50 hover:text-bone"
                  }`}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          </>
        ) : byDay.size === 0 ? (
          <p className="text-sm text-faint">
            No open slots in the next 2 weeks. Set weekly hours on the{" "}
            <span className="text-bone-dim">Schedule</span> page.
          </p>
        ) : (
          <p className="text-sm text-faint">
            No open slots this day — try a highlighted one.
          </p>
        )}
      </div>
    </div>
  );
}
