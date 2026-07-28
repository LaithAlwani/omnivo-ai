import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { conversationCap, smsCap, usagePeriod } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Dashboard analytics. Counts come from bounded index reads capped at CAP — when
// a tenant grows past that, swap these reads for the @convex-dev/aggregate
// component (O(log n), kept in sync inside each write mutation). The query shape
// here stays the same, so the UI wouldn't change.
// -----------------------------------------------------------------------------

const CAP = 1000;
const DAY = 86_400_000;

const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
] as const;

export const overview = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const now = Date.now();

    // Upcoming confirmed bookings (soonest first), plus a 7-day slice.
    const upcomingRows = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) =>
        q.eq("businessId", business._id).gte("start", now),
      )
      .take(CAP);
    const confirmed = upcomingRows.filter((b) => b.status === "confirmed");
    const upcomingBookings = confirmed.length;
    const bookingsThisWeek = confirmed.filter(
      (b) => b.start < now + 7 * DAY,
    ).length;

    // Leads bucketed by pipeline stage (bounded per stage).
    let capped = upcomingRows.length === CAP;
    const byStatus = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
    for (const status of LEAD_STATUSES) {
      const rows = await ctx.db
        .query("leads")
        .withIndex("by_business_status", (q) =>
          q.eq("businessId", business._id).eq("status", status),
        )
        .take(CAP);
      byStatus[status] = rows.length;
      if (rows.length === CAP) capped = true;
    }

    const openLeads = byStatus.new + byStatus.contacted + byStatus.qualified;
    const totalLeads = LEAD_STATUSES.reduce((s, st) => s + byStatus[st], 0);

    // Conversations (widget chat sessions).
    const convoRows = await ctx.db
      .query("conversations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(CAP);
    if (convoRows.length === CAP) capped = true;
    const conversations = convoRows.length;
    const conversationsThisWeek = convoRows.filter(
      (c) => c.lastMessageAt >= now - 7 * DAY,
    ).length;

    // Current-month usage vs the plan's conversation cap (O(1) counter read).
    const usage = await ctx.db
      .query("usageCounters")
      .withIndex("by_business_period", (q) =>
        q.eq("businessId", business._id).eq("period", usagePeriod(now)),
      )
      .unique();
    const conversationsThisMonth = usage?.conversations ?? 0;

    return {
      conversations,
      conversationsThisWeek,
      conversationsThisMonth,
      conversationCap: conversationCap(business.tier),
      smsThisMonth: usage?.sms ?? 0,
      smsCap: smsCap(business.tier),
      upcomingBookings,
      bookingsThisWeek,
      openLeads,
      wonLeads: byStatus.won,
      totalLeads,
      leadsByStatus: byStatus,
      capped,
    };
  },
});
