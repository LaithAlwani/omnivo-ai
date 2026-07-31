import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { conversationCap, emailCap, smsCap, usagePeriod } from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";
import { entitlementsFor } from "./entitlements";

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

    // Current-month usage vs the plan's caps. Usage is pooled at the account
    // level (O(1) counter read); caps derive from the account's plan.
    const plan = await planForBusiness(ctx, business._id);
    const usage = business.accountId
      ? await ctx.db
          .query("usageCounters")
          .withIndex("by_account_period", (q) =>
            q.eq("accountId", business.accountId!).eq("period", usagePeriod(now)),
          )
          .unique()
      : null;
    const conversationsThisMonth = usage?.conversations ?? 0;

    // Onboarding signals for the overview checklist — cheap existence checks.
    const knowledgeRow = await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
    const calendarConn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .first();
    const entitlements = await entitlementsFor(ctx, business._id);

    return {
      knowledgeReady: knowledgeRow !== null,
      calendarConnected: calendarConn !== null,
      reviewsEnabled: entitlements.reviewManagementEnabled,
      conversations,
      conversationsThisWeek,
      conversationsThisMonth,
      conversationCap: conversationCap(plan),
      smsThisMonth: usage?.sms ?? 0,
      smsCap: smsCap(plan),
      emailThisMonth: usage?.email ?? 0,
      emailCap: emailCap(plan),
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
