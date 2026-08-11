import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import {
  tierLimits,
  usagePeriod,
  overageUnits,
  overageCostCents,
  creditStatus,
  creditTokens,
  withPurchased,
  TOKENS_PER_CREDIT,
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
// Server-side plan helpers that need DB reads. Usage is pooled at the account
// level, so counters are read by accountId. AI conversations are governed by the
// token-based credit economy (no hard cap); emails/SMS still have monthly caps.
// -----------------------------------------------------------------------------

/** This period's billable AI tokens + prepaid credit top-ups for an account. */
async function creditUsageThisPeriod(
  ctx: QueryCtx,
  accountId: Id<"accounts"> | undefined,
  period: string,
): Promise<{ billableTokens: number; purchasedCreditCents: number }> {
  if (!accountId) return { billableTokens: 0, purchasedCreditCents: 0 };
  const counter = await ctx.db
    .query("usageCounters")
    .withIndex("by_account_period", (q) =>
      q.eq("accountId", accountId).eq("period", period),
    )
    .unique();
  return {
    billableTokens:
      (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0),
    purchasedCreditCents: counter?.purchasedCreditCents ?? 0,
  };
}

/** Runaway safety valve for the widget: only "blocked" when usage is far beyond
 *  the account's credit allowance (10×, incl. any purchased packs). Normal
 *  over-allowance usage flows and accrues overage — there is no hard credit cap. */
export const creditSafetyStatus = internalQuery({
  args: { businessId: v.id("businesses"), period: v.string() },
  returns: v.object({ blocked: v.boolean() }),
  handler: async (ctx, { businessId, period }) => {
    const business = await ctx.db.get(businessId);
    const plan = await planForBusiness(ctx, businessId);
    const included = creditTokens(plan);
    if (included === null) return { blocked: false }; // enterprise/unlimited
    const { billableTokens, purchasedCreditCents } = await creditUsageThisPeriod(
      ctx,
      business?.accountId,
      period,
    );
    const allowance = included + purchasedCreditCents * TOKENS_PER_CREDIT;
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
    const purchasedCreditCents = counter?.purchasedCreditCents ?? 0;

    return {
      tier: plan,
      period,
      // AI conversations → a token-based credit balance (incl. prepaid packs).
      aiCredits: {
        ...creditStatus(plan, billableTokens, purchasedCreditCents),
        conversations: counter?.conversations ?? 0,
      },
      emails: meter(
        counter?.email ?? 0,
        withPurchased(limits.emailsPerMonth, counter?.purchasedEmails ?? 0),
        "emails",
      ),
      sms: meter(
        counter?.sms ?? 0,
        withPurchased(limits.smsPerMonth, counter?.purchasedSms ?? 0),
        "sms",
      ),
      features: {
        whiteLabel: limits.whiteLabel,
        customEmailDomain: limits.customEmailDomain,
      },
    };
  },
});
