import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { conversationCap, usagePeriod } from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";

// -----------------------------------------------------------------------------
// Dashboard analytics. Counts come from bounded index reads capped at CAP — when
// a tenant grows past that, swap these reads for the @convex-dev/aggregate
// component (O(log n), kept in sync inside each write mutation). The query shape
// here stays the same, so the UI wouldn't change.
// -----------------------------------------------------------------------------

const CAP = 1000;
const DAY = 86_400_000;

export const overview = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const now = Date.now();

    // Conversations (widget chat sessions) — the dashboard's activity metric.
    const convoRows = await ctx.db
      .query("conversations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(CAP);
    const capped = convoRows.length === CAP;
    const conversations = convoRows.length;
    const conversationsThisWeek = convoRows.filter(
      (c) => c.lastMessageAt >= now - 7 * DAY,
    ).length;

    // Current-month conversation activity — pooled at the account level.
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

    // Onboarding signal for the overview checklist — cheap existence check.
    const knowledgeRow = await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
    return {
      knowledgeReady: knowledgeRow !== null,
      conversations,
      conversationsThisWeek,
      conversationsThisMonth,
      conversationCap: conversationCap(plan),
      capped,
    };
  },
});
