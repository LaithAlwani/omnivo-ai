import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireMemberBySlug, isManager } from "./lib/authz";
import { appError } from "./lib/errors";
import { randomHex } from "./lib/keys";
import { DAY_MS, isOpenSlot, type Span } from "./lib/slots";
import {
  blackoutSpans,
  expandByBuffer,
  policyOf,
} from "./lib/bookingRules";

// -----------------------------------------------------------------------------
// Booking engine. `book` (action) mints a cancel token, then `create` (a single
// transaction) assigns a staff member if needed, re-validates the slot against
// live bookings, and inserts — so two racing bookings can't take the same slot.
// -----------------------------------------------------------------------------

const customerArgs = {
  customerName: v.string(),
  customerEmail: v.string(),
  customerPhone: v.optional(v.string()),
  note: v.optional(v.string()),
};

async function ruleAndBusy(
  ctx: MutationCtx,
  business: Doc<"businesses">,
  staffId: Id<"staff">,
  start: number,
  excludeId?: Id<"bookings">,
): Promise<{ rule: Doc<"availabilityRules"> | null; busy: Span[] }> {
  const policy = policyOf(business);
  const rule = await ctx.db
    .query("availabilityRules")
    .withIndex("by_staff", (q) => q.eq("staffId", staffId))
    .unique();
  const rows = await ctx.db
    .query("bookings")
    .withIndex("by_staff_start", (q) =>
      q.eq("staffId", staffId).gte("start", start - DAY_MS).lt("start", start + DAY_MS),
    )
    .collect();
  const appts: Span[] = rows
    .filter((b) => b.status === "confirmed" && b._id !== excludeId)
    .map((b) => ({ start: b.start, end: b.end }));

  const cbusy = await ctx.db
    .query("calendarBusy")
    .withIndex("by_staff_start", (q) =>
      q.eq("staffId", staffId).gte("start", start - DAY_MS).lt("start", start + DAY_MS),
    )
    .collect();
  for (const g of cbusy) appts.push({ start: g.start, end: g.end });

  // Appointments carry a buffer; time-off blackouts are hard-closed as-is.
  const buffered = expandByBuffer(appts, policy.bufferMinutes);
  const blocks = await blackoutSpans(
    ctx,
    business._id,
    staffId,
    start - DAY_MS,
    start + DAY_MS,
  );
  return { rule, busy: [...buffered, ...blocks] };
}

/** Appointment length: the service's duration, else the staff's default slot. */
function slotDuration(
  service: Doc<"services"> | null,
  rule: Doc<"availabilityRules">,
): number {
  return service?.durationMinutes ?? rule.slotMinutes;
}

/** Does this staff perform the service? (no restriction list = anyone.) */
function performsService(
  staff: Doc<"staff">,
  service: Doc<"services"> | null,
): boolean {
  if (!service?.staffIds || service.staffIds.length === 0) return true;
  return service.staffIds.includes(staff._id);
}

/**
 * Employee visibility: managers (owner/admin) see all bookings; a `staff` member
 * sees only bookings for the staff row(s) linked to their account. Enforced
 * server-side in every booking read/write.
 */
async function bookingScope(ctx: QueryCtx, slug: string) {
  const { business, userId, membership } = await requireMemberBySlug(ctx, slug);
  const manager = isManager(membership.role);
  let allowed: Set<string> | null = null;
  if (!manager) {
    const mine = await ctx.db
      .query("staff")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    allowed = new Set(
      mine.filter((s) => s.businessId === business._id).map((s) => s._id),
    );
  }
  return { business, manager, allowed };
}

function canManageBooking(
  manager: boolean,
  allowed: Set<string> | null,
  staffId: Id<"staff">,
) {
  return manager || (allowed?.has(staffId) ?? false);
}

/** Round-robin / least-busy pick among staff who are free at `start`. */
async function assignStaff(
  ctx: MutationCtx,
  business: Doc<"businesses">,
  start: number,
  service: Doc<"services"> | null,
): Promise<{ staffId: Id<"staff">; rule: Doc<"availabilityRules"> } | null> {
  const staff = (
    await ctx.db
      .query("staff")
      .withIndex("by_business_active", (q) =>
        q.eq("businessId", business._id).eq("active", true),
      )
      .collect()
  ).filter(
    (s) => s.bookable && !s.externalBookingUrl && performsService(s, service),
  );

  const candidates: {
    staffId: Id<"staff">;
    rule: Doc<"availabilityRules">;
    load: number;
  }[] = [];

  for (const s of staff) {
    const { rule, busy } = await ruleAndBusy(ctx, business, s._id, start);
    if (!rule || !isOpenSlot(rule, busy, start, slotDuration(service, rule))) {
      continue;
    }
    candidates.push({ staffId: s._id, rule, load: busy.length });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.load - b.load);
  return { staffId: candidates[0].staffId, rule: candidates[0].rule };
}

type BookParams = {
  staffId: Id<"staff"> | "any";
  start: number;
  source: "dashboard" | "assistant" | "widget";
  cancelToken: string;
  serviceId?: Id<"services">;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  note?: string;
};

/**
 * The transactional heart of booking, tenant already resolved. Shared by the
 * member path (`create`, membership-gated) and the public path
 * (`createForBusiness`, embed-key-gated) so both enforce the exact same rules:
 * service duration, lead-time/window, staff eligibility, and double-booking.
 */
async function bookCore(
  ctx: MutationCtx,
  business: Doc<"businesses">,
  args: BookParams,
): Promise<{
  bookingId: Id<"bookings">;
  staffId: Id<"staff">;
  start: number;
  end: number;
}> {
  // Resolve the service (if chosen) — its duration drives the slot length.
  let service: Doc<"services"> | null = null;
  if (args.serviceId) {
    service = await ctx.db.get(args.serviceId);
    if (!service || service.businessId !== business._id || !service.active) {
      appError("NOT_FOUND", "That service is unavailable.");
    }
  }

  // Lead-time + booking-window guardrails (authoritative; getSlots mirrors it).
  const policy = policyOf(business);
  const now = Date.now();
  if (args.start < now + policy.minNoticeMinutes * 60_000) {
    appError("CONFLICT", "That time is too soon to book.");
  }
  if (args.start > now + policy.maxAdvanceDays * DAY_MS) {
    appError("CONFLICT", "That's further ahead than bookings are allowed.");
  }

  let staffId: Id<"staff">;
  let rule: Doc<"availabilityRules">;

  if (args.staffId === "any") {
    const picked = await assignStaff(ctx, business, args.start, service);
    if (!picked) {
      appError("CONFLICT", "No one is available at that time.");
    }
    staffId = picked.staffId;
    rule = picked.rule;
  } else {
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.businessId !== business._id) {
      appError("NOT_FOUND", "That staff member no longer exists.");
    }
    if (!staff.bookable || !staff.active) {
      appError("CONFLICT", "That staff member isn't bookable.");
    }
    if (staff.externalBookingUrl) {
      appError("CONFLICT", "This staff member books through an external link.");
    }
    if (!performsService(staff, service)) {
      appError("CONFLICT", "That staff member doesn't offer this service.");
    }
    const { rule: r, busy } = await ruleAndBusy(ctx, business, staff._id, args.start);
    if (!r) appError("CONFLICT", "That staff member has no availability set.");
    // Double-booking safety: re-check against live bookings inside the txn.
    if (!isOpenSlot(r, busy, args.start, slotDuration(service, r))) {
      appError("CONFLICT", "That time isn't available — it may have just been taken.");
    }
    staffId = staff._id;
    rule = r;
  }

  const end = args.start + slotDuration(service, rule) * 60_000;
  const bookingId = await ctx.db.insert("bookings", {
    businessId: business._id,
    staffId,
    start: args.start,
    end,
    status: "confirmed",
    customerName: args.customerName.trim(),
    customerEmail: args.customerEmail.trim(),
    customerPhone: args.customerPhone?.trim() || undefined,
    serviceId: args.serviceId,
    note: args.note?.trim() || undefined,
    cancelToken: args.cancelToken,
    source: args.source,
  });

  // Best-effort: write the appointment onto the staff's connected calendar.
  await ctx.scheduler.runAfter(0, internal.calendar.pushEvent, { bookingId });
  // Best-effort: text the customer a confirmation (tier-gated + phone-gated
  // inside the action, so it's a no-op when SMS isn't applicable).
  await ctx.scheduler.runAfter(0, internal.sms.sendBookingConfirmation, {
    bookingId,
  });
  // Every booking also gets an email confirmation (no tier gate) — the action
  // self-gates on a present email + configured SMTP.
  await ctx.scheduler.runAfter(0, internal.emailNode.sendBookingConfirmation, {
    bookingId,
  });

  return { bookingId, staffId, start: args.start, end };
}

// Hydrated context an SMS action needs to compose a confirmation/reminder.
// Actions have no `ctx.db`, so they read this instead of the raw tables.
export const notificationContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  returns: v.union(
    v.null(),
    v.object({
      businessId: v.id("businesses"),
      status: v.union(v.literal("confirmed"), v.literal("cancelled")),
      start: v.number(),
      customerName: v.string(),
      customerPhone: v.union(v.string(), v.null()),
      customerEmail: v.string(),
      businessName: v.string(),
      tier: v.union(
        v.literal("starter"),
        v.literal("professional"),
        v.literal("enterprise"),
      ),
      timezone: v.union(v.string(), v.null()),
      staffName: v.union(v.string(), v.null()),
      serviceName: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { bookingId }) => {
    const bk = await ctx.db.get(bookingId);
    if (!bk) return null;
    const business = await ctx.db.get(bk.businessId);
    if (!business) return null;
    const staff = await ctx.db.get(bk.staffId);
    const service = bk.serviceId ? await ctx.db.get(bk.serviceId) : null;
    return {
      businessId: bk.businessId,
      status: bk.status,
      start: bk.start,
      customerName: bk.customerName,
      customerPhone: bk.customerPhone ?? null,
      customerEmail: bk.customerEmail,
      businessName: business.name,
      tier: business.tier,
      timezone: business.timezone ?? null,
      staffName: staff?.name ?? null,
      serviceName: service?.name ?? null,
    };
  },
});

const bookingCoreArgs = {
  staffId: v.union(v.id("staff"), v.literal("any")),
  start: v.number(),
  source: v.union(
    v.literal("dashboard"),
    v.literal("assistant"),
    v.literal("widget"),
  ),
  cancelToken: v.string(),
  serviceId: v.optional(v.id("services")),
  ...customerArgs,
};

const bookingReturn = v.object({
  bookingId: v.id("bookings"),
  staffId: v.id("staff"),
  start: v.number(),
  end: v.number(),
});

// Member path: tenant resolved by the caller's membership.
export const create = internalMutation({
  args: { slug: v.string(), ...bookingCoreArgs },
  returns: bookingReturn,
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    return await bookCore(ctx, business, args);
  },
});

// Public path: tenant resolved from a verified embed key (see public.ts).
export const createForBusiness = internalMutation({
  args: { businessId: v.id("businesses"), ...bookingCoreArgs },
  returns: bookingReturn,
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    return await bookCore(ctx, business, args);
  },
});

export const book = action({
  args: {
    slug: v.string(),
    staffId: v.union(v.id("staff"), v.literal("any")),
    start: v.number(),
    serviceId: v.optional(v.id("services")),
    source: v.optional(
      v.union(
        v.literal("dashboard"),
        v.literal("assistant"),
        v.literal("widget"),
      ),
    ),
    ...customerArgs,
  },
  returns: v.object({
    bookingId: v.id("bookings"),
    staffId: v.id("staff"),
    start: v.number(),
    end: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    bookingId: Id<"bookings">;
    staffId: Id<"staff">;
    start: number;
    end: number;
  }> => {
    const cancelToken = randomHex(16);
    return await ctx.runMutation(internal.bookings.create, {
      slug: args.slug,
      staffId: args.staffId,
      start: args.start,
      serviceId: args.serviceId,
      source: args.source ?? "dashboard",
      cancelToken,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      note: args.note,
    });
  },
});

/** Upcoming confirmed bookings visible to the caller (role-scoped). */
export const listUpcoming = query({
  args: { slug: v.string(), fromMs: v.number() },
  handler: async (ctx, args) => {
    const { business, manager, allowed } = await bookingScope(ctx, args.slug);
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) =>
        q.eq("businessId", business._id).gte("start", args.fromMs),
      )
      .collect();

    return Promise.all(
      rows
        .filter(
          (b) =>
            b.status === "confirmed" &&
            canManageBooking(manager, allowed, b.staffId),
        )
        .sort((a, b) => a.start - b.start)
        .map(async (b) => {
          const staff = await ctx.db.get(b.staffId);
          return {
            _id: b._id,
            staffId: b.staffId,
            serviceId: b.serviceId ?? null,
            start: b.start,
            end: b.end,
            staffName: staff?.name ?? "—",
            customerName: b.customerName,
            customerEmail: b.customerEmail,
            customerPhone: b.customerPhone ?? null,
          };
        }),
    );
  },
});

export const cancel = mutation({
  args: { slug: v.string(), bookingId: v.id("bookings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business, manager, allowed } = await bookingScope(ctx, args.slug);
    const bk = await ctx.db.get(args.bookingId);
    if (!bk || bk.businessId !== business._id) {
      appError("NOT_FOUND", "That booking no longer exists.");
    }
    if (!canManageBooking(manager, allowed, bk.staffId)) {
      appError("FORBIDDEN", "You can only manage your own bookings.");
    }
    await ctx.db.patch(args.bookingId, { status: "cancelled" });
    if (bk.calendarEventId) {
      await ctx.scheduler.runAfter(0, internal.calendar.removeEvent, {
        staffId: bk.staffId,
        eventId: bk.calendarEventId,
      });
    }
    return null;
  },
});

export const reschedule = mutation({
  args: {
    slug: v.string(),
    bookingId: v.id("bookings"),
    newStart: v.number(),
  },
  returns: v.object({ start: v.number(), end: v.number() }),
  handler: async (ctx, args) => {
    const { business, manager, allowed } = await bookingScope(ctx, args.slug);
    const bk = await ctx.db.get(args.bookingId);
    if (!bk || bk.businessId !== business._id) {
      appError("NOT_FOUND", "That booking no longer exists.");
    }
    if (bk.status !== "confirmed") {
      appError("CONFLICT", "This booking isn't active.");
    }
    if (!canManageBooking(manager, allowed, bk.staffId)) {
      appError("FORBIDDEN", "You can only manage your own bookings.");
    }

    // Same lead-time + window rules apply to the new time.
    const policy = policyOf(business);
    const now = Date.now();
    if (args.newStart < now + policy.minNoticeMinutes * 60_000) {
      appError("CONFLICT", "That time is too soon to book.");
    }
    if (args.newStart > now + policy.maxAdvanceDays * DAY_MS) {
      appError("CONFLICT", "That's further ahead than bookings are allowed.");
    }

    // Same service ⇒ same duration when moving the appointment.
    const service = bk.serviceId ? await ctx.db.get(bk.serviceId) : null;

    // Validate the new slot for the same staff, excluding this booking itself.
    const { rule, busy } = await ruleAndBusy(ctx, business, bk.staffId, args.newStart, bk._id);
    if (!rule) appError("CONFLICT", "That staff member has no availability set.");
    const duration = slotDuration(service, rule);
    if (!isOpenSlot(rule, busy, args.newStart, duration)) {
      appError("CONFLICT", "That time isn't available — it may have just been taken.");
    }

    const end = args.newStart + duration * 60_000;
    const oldEventId = bk.calendarEventId;
    await ctx.db.patch(bk._id, { start: args.newStart, end });

    // Move the calendar event: delete the old, create a fresh one at the new time.
    if (oldEventId) {
      await ctx.scheduler.runAfter(0, internal.calendar.removeEvent, {
        staffId: bk.staffId,
        eventId: oldEventId,
      });
    }
    await ctx.scheduler.runAfter(0, internal.calendar.pushEvent, {
      bookingId: bk._id,
    });

    return { start: args.newStart, end };
  },
});
