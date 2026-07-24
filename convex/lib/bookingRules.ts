import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { Span } from "./slots";

// -----------------------------------------------------------------------------
// Booking guardrails shared by slot generation (query) and booking (mutation):
// lead time, booking window, buffers, and time-off blackouts. Kept in one place
// so the times the assistant is offered and the times it can actually book agree.
// -----------------------------------------------------------------------------

type Ctx = GenericQueryCtx<DataModel>;

export type Policy = {
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
};

/**
 * Normalize a business's policy. Guardrails are opt-in: a business that hasn't
 * set one gets no lead time, no buffer, and no booking-window cap (Infinity).
 */
export function policyOf(business: Doc<"businesses">): Policy {
  const p = business.bookingPolicy;
  return {
    minNoticeMinutes: p?.minNoticeMinutes ?? 0,
    maxAdvanceDays: p?.maxAdvanceDays ?? Number.POSITIVE_INFINITY,
    bufferMinutes: p?.bufferMinutes ?? 0,
  };
}

/** Grow each busy span by the buffer on both sides to enforce a gap. */
export function expandByBuffer(spans: Span[], bufferMinutes: number): Span[] {
  if (bufferMinutes <= 0) return spans;
  const b = bufferMinutes * 60_000;
  return spans.map((s) => ({ start: s.start - b, end: s.end + b }));
}

/**
 * Blackout spans overlapping [fromMs, toMs) for a staff member — both the
 * staff's own time off and business-wide closures.
 */
export async function blackoutSpans(
  ctx: Ctx,
  businessId: Id<"businesses">,
  staffId: Id<"staff">,
  fromMs: number,
  toMs: number,
): Promise<Span[]> {
  const rows = await ctx.db
    .query("blackouts")
    .withIndex("by_business_start", (q) => q.eq("businessId", businessId))
    .collect();
  return rows
    .filter(
      (r) =>
        (r.staffId === undefined || r.staffId === staffId) &&
        r.start < toMs &&
        r.end > fromMs,
    )
    .map((r) => ({ start: r.start, end: r.end }));
}
