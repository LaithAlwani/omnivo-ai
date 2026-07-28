import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// -----------------------------------------------------------------------------
// Scheduled fan-out. Every job is kept small and orchestrated top-down —
// all-businesses → one-business → per-staff/per-booking — rather than one giant
// loop, so a single tenant's data can never blow a transaction (plan risk #2).
// -----------------------------------------------------------------------------

// How far ahead of an appointment we text the reminder.
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
// Safety bound on rows touched per tenant per tick (fan-out keeps this ample).
const PER_TENANT_LIMIT = 200;

// --- Reminders --------------------------------------------------------------

/** Tick: fan out to each SMS-eligible business. */
export const enqueueReminders = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Small tenant count early on; revisit with pagination if it grows.
    const businesses = await ctx.db.query("businesses").take(1000);
    for (const b of businesses) {
      if (b.tier === "starter") continue; // SMS is Professional+
      await ctx.scheduler.runAfter(0, internal.crons.remindBusiness, {
        businessId: b._id,
      });
    }
    return null;
  },
});

/** Per-business: text customers whose appointment is within the window, once. */
export const remindBusiness = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) =>
        q
          .eq("businessId", businessId)
          .gt("start", now)
          .lte("start", now + REMINDER_WINDOW_MS),
      )
      .take(PER_TENANT_LIMIT);

    for (const bk of rows) {
      if (bk.status !== "confirmed") continue;
      if (bk.reminderSentAt) continue;
      // customerEmail is always present; this is just defensive.
      if (!bk.customerPhone && !bk.customerEmail) continue;
      // Claim it in this transaction *before* scheduling the sends, so an
      // overlapping tick can't double-notify. Fan out to both channels — each
      // send action re-checks its own gates (SMS is tier + phone gated; email
      // needs a present address + configured SMTP).
      await ctx.db.patch(bk._id, { reminderSentAt: now });
      await ctx.scheduler.runAfter(0, internal.sms.sendBookingReminder, {
        bookingId: bk._id,
      });
      await ctx.scheduler.runAfter(0, internal.emailNode.sendBookingReminder, {
        bookingId: bk._id,
      });
    }
    return null;
  },
});

// --- Calendar free/busy refresh ---------------------------------------------

/** Tick: fan out to each business to refresh its staff calendars. */
export const refreshAllBusy = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(1000);
    for (const b of businesses) {
      await ctx.scheduler.runAfter(0, internal.crons.refreshBusinessBusy, {
        businessId: b._id,
      });
    }
    return null;
  },
});

/** Per-business: refresh cached free/busy for each connected staff calendar. */
export const refreshBusinessBusy = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const conns = await ctx.db
      .query("calendarConnections")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(PER_TENANT_LIMIT);
    for (const conn of conns) {
      await ctx.scheduler.runAfter(0, internal.calendar.syncStaffBusy, {
        staffId: conn.staffId,
      });
    }
    return null;
  },
});

const crons = cronJobs();
// Reminders: every 30 min a booking that entered the 24h window gets one text.
crons.interval("send booking reminders", { minutes: 30 }, internal.crons.enqueueReminders, {});
// Keep cached free/busy fresh so slot generation reflects external calendars.
crons.interval("refresh calendar busy", { hours: 6 }, internal.crons.refreshAllBusy, {});

export default crons;
