import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { conversationCap, tierLimits, usagePeriod } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Server-side plan enforcement helpers. The capability rules themselves live in
// lib/tiers.ts; this exposes the pieces that need database reads.
// -----------------------------------------------------------------------------

/** Where a business stands against its monthly conversation cap. `period` is
 *  passed in ("YYYY-MM") so this stays a pure, wall-clock-free query. */
export const conversationCapStatus = internalQuery({
  args: { businessId: v.id("businesses"), period: v.string() },
  returns: v.object({
    over: v.boolean(),
    used: v.number(),
    cap: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { businessId, period }) => {
    const business = await ctx.db.get(businessId);
    const cap = business ? conversationCap(business.tier) : null;

    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_business_period", (q) =>
        q.eq("businessId", businessId).eq("period", period),
      )
      .unique();
    const used = counter?.conversations ?? 0;

    return { over: cap !== null && used >= cap, used, cap };
  },
});

/** The caller's plan + what's included + this month's usage against limits.
 *  Powers the dashboard Plan & usage page. */
export const planUsage = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const limits = tierLimits(business.tier);
    const period = usagePeriod(Date.now());

    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_business_period", (q) =>
        q.eq("businessId", business._id).eq("period", period),
      )
      .unique();
    const convoUsed = counter?.conversations ?? 0;
    const convoCap = limits.conversationsPerMonth;
    const smsUsed = counter?.sms ?? 0;
    const smsLimit = limits.smsPerMonth;

    const remaining = (used: number, cap: number | null) =>
      cap === null ? null : Math.max(0, cap - used);

    return {
      tier: business.tier,
      period,
      limits,
      conversations: {
        used: convoUsed,
        cap: convoCap,
        remaining: remaining(convoUsed, convoCap),
      },
      sms: {
        used: smsUsed,
        cap: smsLimit,
        remaining: remaining(smsUsed, smsLimit),
      },
    };
  },
});
