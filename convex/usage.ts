import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { smsCap, usagePeriod } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Metered-usage counters (conversations live in conversations.ts; SMS here).
// One usageCounters row per business per "YYYY-MM"; increments are O(1) reads.
// -----------------------------------------------------------------------------

/** Bump this month's SMS counter by one (called after a successful send). */
export const recordSms = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const period = usagePeriod(Date.now());
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_business_period", (q) =>
        q.eq("businessId", businessId).eq("period", period),
      )
      .unique();
    if (counter) {
      await ctx.db.patch(counter._id, { sms: (counter.sms ?? 0) + 1 });
    } else {
      await ctx.db.insert("usageCounters", {
        businessId,
        period,
        conversations: 0,
        sms: 1,
      });
    }
    return null;
  },
});

/** Whether a business has hit its monthly SMS cap. `period` passed in so this
 *  stays wall-clock-free. */
export const smsCapStatus = internalQuery({
  args: { businessId: v.id("businesses"), period: v.string() },
  returns: v.object({
    over: v.boolean(),
    used: v.number(),
    cap: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { businessId, period }) => {
    const business = await ctx.db.get(businessId);
    const cap = business ? smsCap(business.tier) : 0;
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_business_period", (q) =>
        q.eq("businessId", businessId).eq("period", period),
      )
      .unique();
    const used = counter?.sms ?? 0;
    return { over: cap !== null && used >= cap, used, cap };
  },
});
