import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import {
  conversationCap,
  tierLimits,
  usagePeriod,
  overageUnits,
  overageCostCents,
  type MeteredUnit,
} from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";

const meter = (used: number, cap: number | null, unit: MeteredUnit) => {
  const over = overageUnits(used, cap);
  return {
    used,
    cap,
    remaining: cap === null ? null : Math.max(0, cap - used),
    overage: over,
    overageCents: overageCostCents(unit, over),
  };
};

// -----------------------------------------------------------------------------
// Server-side plan enforcement helpers. The capability rules themselves live in
// lib/tiers.ts; this exposes the pieces that need database reads. Usage is
// POOLED at the account level, so counters are read by accountId.
// -----------------------------------------------------------------------------

/** Where an account stands against its monthly conversation cap. `period` is
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
    const plan = await planForBusiness(ctx, businessId);
    const cap = conversationCap(plan);

    let used = 0;
    if (business?.accountId) {
      const counter = await ctx.db
        .query("usageCounters")
        .withIndex("by_account_period", (q) =>
          q.eq("accountId", business.accountId!).eq("period", period),
        )
        .unique();
      used = counter?.conversations ?? 0;
    }

    return { over: cap !== null && used >= cap, used, cap };
  },
});

/** The caller's plan + what's included + this month's pooled usage against
 *  limits. Powers the dashboard Plan & usage page. */
export const planUsage = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const plan = await planForBusiness(ctx, business._id);
    const limits = tierLimits(plan);
    const period = usagePeriod(Date.now());

    const counter = business.accountId
      ? await ctx.db
          .query("usageCounters")
          .withIndex("by_account_period", (q) =>
            q.eq("accountId", business.accountId!).eq("period", period),
          )
          .unique()
      : null;

    return {
      tier: plan,
      period,
      conversations: meter(
        counter?.conversations ?? 0,
        limits.conversationsPerMonth,
        "conversations",
      ),
      emails: meter(counter?.email ?? 0, limits.emailsPerMonth, "emails"),
      sms: meter(counter?.sms ?? 0, limits.smsPerMonth, "sms"),
      features: {
        whiteLabel: limits.whiteLabel,
        customEmailDomain: limits.customEmailDomain,
      },
    };
  },
});
