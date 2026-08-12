import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import {
  tierLimits,
  usagePeriod,
  creditStatus,
  creditTokens,
} from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";

// -----------------------------------------------------------------------------
// Server-side plan helpers that need DB reads. Usage is pooled at the account
// level, so counters are read by accountId. The only metered resource is AI
// usage — a token-based credit balance (no hard cap; overage accrues in credits).
// -----------------------------------------------------------------------------

/** This period's billable AI tokens (input+output) for an account. */
async function billableTokensThisPeriod(
  ctx: QueryCtx,
  accountId: Id<"accounts"> | undefined,
  period: string,
): Promise<number> {
  if (!accountId) return 0;
  const counter = await ctx.db
    .query("usageCounters")
    .withIndex("by_account_period", (q) =>
      q.eq("accountId", accountId).eq("period", period),
    )
    .unique();
  return (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0);
}

/** Runaway safety valve for the widget: only "blocked" when usage is far beyond
 *  the account's credit allowance (10×). Normal over-allowance usage flows and
 *  accrues overage — there is no hard credit cap. */
export const creditSafetyStatus = internalQuery({
  args: { businessId: v.id("businesses"), period: v.string() },
  returns: v.object({ blocked: v.boolean() }),
  handler: async (ctx, { businessId, period }) => {
    const business = await ctx.db.get(businessId);
    const plan = await planForBusiness(ctx, businessId);
    const allowance = creditTokens(plan);
    if (allowance === null) return { blocked: false }; // enterprise/unlimited
    const billableTokens = await billableTokensThisPeriod(
      ctx,
      business?.accountId,
      period,
    );
    return { blocked: billableTokens > allowance * 10 };
  },
});

/** The caller's plan + what's included + this month's pooled usage. Powers the
 *  dashboard Plan & usage page. AI conversations report as a credit balance. */
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

    const billableTokens =
      (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0);

    return {
      tier: plan,
      period,
      // AI conversations → a token-based credit balance.
      aiCredits: {
        ...creditStatus(plan, billableTokens),
        conversations: counter?.conversations ?? 0,
      },
      features: {
        whiteLabel: limits.whiteLabel,
        customEmailDomain: limits.customEmailDomain,
      },
    };
  },
});
