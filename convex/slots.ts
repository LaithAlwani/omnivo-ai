import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { DAY_MS, openSlots, type Span } from "./lib/slots";
import {
  blackoutSpans,
  expandByBuffer,
  policyOf,
} from "./lib/bookingRules";

// Open appointment slots for a specific staff member, or the merged set across
// all bookable staff when staffId is "any". Reactive to bookings — a booked slot
// disappears immediately. `fromMs` is passed in (queries can't read the clock).

async function busyFor(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  staffId: Id<"staff">,
  fromMs: number,
  toMs: number,
  bufferMinutes: number,
): Promise<Span[]> {
  const rows = await ctx.db
    .query("bookings")
    .withIndex("by_staff_start", (q) =>
      q.eq("staffId", staffId).gte("start", fromMs - DAY_MS).lt("start", toMs),
    )
    .collect();
  const bookings = rows
    .filter((b) => b.status === "confirmed")
    .map((b) => ({ start: b.start, end: b.end }));

  // External calendar (Google/Outlook) busy times block slots too.
  const cbusy = await ctx.db
    .query("calendarBusy")
    .withIndex("by_staff_start", (q) =>
      q.eq("staffId", staffId).gte("start", fromMs - DAY_MS).lt("start", toMs),
    )
    .collect();

  // Appointments carry a buffer (gap); blackouts are hard-closed as-is.
  const appts = expandByBuffer(
    [...bookings, ...cbusy.map((g) => ({ start: g.start, end: g.end }))],
    bufferMinutes,
  );
  const blocks = await blackoutSpans(ctx, businessId, staffId, fromMs, toMs);
  return [...appts, ...blocks];
}

type SlotArgs = {
  staffId: Id<"staff"> | "any";
  fromMs: number;
  days: number;
  serviceId?: Id<"services">;
  // When set, only staff at this location are considered (multi-location books).
  locationId?: Id<"locations">;
};

/**
 * Open slots for a business, tenant already resolved. Shared by the member query
 * (`getSlots`) and the public query (`getSlotsForBusiness`, embed-key-gated) so
 * the times shown to a website visitor match what the dashboard would show.
 */
async function computeSlots(
  ctx: QueryCtx,
  business: Doc<"businesses">,
  args: SlotArgs,
) {
  const policy = policyOf(business);
    // Lead time trims the near edge; the booking window caps the far edge.
    const effFrom = args.fromMs + policy.minNoticeMinutes * 60_000;
    const cap = args.fromMs + policy.maxAdvanceDays * DAY_MS;
    const toMs = Math.min(args.fromMs + Math.min(args.days, 60) * DAY_MS, cap);
    if (toMs <= effFrom) return [];

    // Resolve the service (if any) → duration + who may perform it.
    let duration: number | undefined;
    let performs: (s: Doc<"staff">) => boolean = () => true;
    if (args.serviceId) {
      const service = await ctx.db.get(args.serviceId);
      if (!service || service.businessId !== business._id || !service.active) {
        return [];
      }
      duration = service.durationMinutes;
      const ids = service.staffIds;
      if (ids && ids.length) performs = (s) => ids.includes(s._id);
    }

    // External-link (Calendly) staff have no internal slots — they hand off.
    let staffList: Doc<"staff">[];
    if (args.staffId === "any") {
      staffList = (
        await ctx.db
          .query("staff")
          .withIndex("by_business_active", (q) =>
            q.eq("businessId", business._id).eq("active", true),
          )
          .collect()
      ).filter(
        (s) =>
          s.bookable &&
          !s.externalBookingUrl &&
          performs(s) &&
          (!args.locationId || s.locationId === args.locationId),
      );
    } else {
      const s = await ctx.db.get(args.staffId);
      staffList =
        s && s.businessId === business._id && !s.externalBookingUrl && performs(s)
          ? [s]
          : [];
    }

    const merged = new Map<number, { end: number; staffId: Id<"staff"> }>();

    for (const s of staffList) {
      const rule = await ctx.db
        .query("availabilityRules")
        .withIndex("by_staff", (q) => q.eq("staffId", s._id))
        .unique();
      if (!rule) continue;
      const busy = await busyFor(
        ctx,
        business._id,
        s._id,
        effFrom,
        toMs,
        policy.bufferMinutes,
      );
      const dur = (duration ?? rule.slotMinutes) * 60_000;
      for (const start of openSlots(rule, busy, effFrom, toMs, duration)) {
        // "any": first staff to offer a start time wins the slot.
        if (!merged.has(start)) merged.set(start, { end: start + dur, staffId: s._id });
      }
    }

  return Array.from(merged.entries())
    .map(([start, { end, staffId }]) => ({ start, end, staffId }))
    .sort((a, b) => a.start - b.start);
}

export const getSlots = query({
  args: {
    slug: v.string(),
    staffId: v.union(v.id("staff"), v.literal("any")),
    fromMs: v.number(),
    days: v.number(),
    // When set, slot length = the service's duration and only staff who perform
    // it are considered. Omitted → the staff's default slot length.
    serviceId: v.optional(v.id("services")),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    return await computeSlots(ctx, business, args);
  },
});

// Public path: tenant resolved from a verified embed key (see public.ts).
export const getSlotsForBusiness = internalQuery({
  args: {
    businessId: v.id("businesses"),
    staffId: v.union(v.id("staff"), v.literal("any")),
    fromMs: v.number(),
    days: v.number(),
    serviceId: v.optional(v.id("services")),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return [];
    return await computeSlots(ctx, business, args);
  },
});
