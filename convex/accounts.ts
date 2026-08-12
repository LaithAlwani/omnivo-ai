import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import { accountLocationLimit } from "./lib/accounts";
import { syncEntitlementsToPlan } from "./entitlements";
import {
  type Plan,
  tierLimits,
  locationLimit,
  planPrice,
  usagePeriod,
  creditStatus,
} from "./lib/tiers";

// -----------------------------------------------------------------------------
// Accounts — the owner-level subscription. Holds the base plan and its pooled
// allowances; projects (businesses) belong to an account and share its usage.
// One account per owner: created lazily the first time they onboard a business.
// -----------------------------------------------------------------------------

/** The signed-in user's account, creating it (on `plan`) if they don't have one
 *  yet. Called from the business-provisioning path. */
export async function getOrCreateAccount(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  plan: Plan,
): Promise<Id<"accounts">> {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("accounts", { ownerUserId, plan });
}

/** How many projects the account already owns (against its project limit). */
export async function projectCount(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<number> {
  const projects = await ctx.db
    .query("businesses")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return projects.length;
}

/** The caller's account: plan, effective limits, project usage, and pooled
 *  monthly usage. Powers the account/plan overview. */
export const myAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const account = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .unique();
    if (!account) return null;

    const period = usagePeriod(Date.now());
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", account._id).eq("period", period),
      )
      .unique();

    const limits = tierLimits(account.plan);
    const convUsed = counter?.conversations ?? 0;
    // AI usage → a token-based credit balance; overage accrues in credits past
    // the included monthly allowance. It's the only metered/billable resource.
    const billableTokens =
      (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0);
    const aiCredits = creditStatus(account.plan, billableTokens);
    const overageCents = aiCredits.overageCents;

    const includedLocations = locationLimit(account.plan);
    const businessCount = (
      await ctx.db
        .query("businesses")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect()
    ).length;

    return {
      plan: account.plan,
      period,
      // Back-compat: one business per account now, so max is always 1.
      projects: { used: businessCount, max: 1 },
      locationLimitPerProject: accountLocationLimit(account),
      // Billing snapshot for the account/usage view.
      billing: {
        priceMonthly: planPrice(account.plan),
        aiCredits,
        // Stripe subscription state for the billing UI (null before checkout).
        subscriptionStatus: account.subscriptionStatus ?? null,
        hasSubscription: !!account.stripeSubscriptionId,
      },
      locations: {
        included: includedLocations,
        paid: account.paidLocations ?? 0,
        cap: accountLocationLimit(account),
      },
      usage: {
        // Retained as an activity metric; the credit balance (billing.aiCredits)
        // is now what governs AI usage.
        conversations: { used: convUsed, cap: limits.conversationsPerMonth },
      },
      // Estimated AI-credit overage this period.
      overageCents,
      features: {
        whiteLabel: limits.whiteLabel,
        customEmailDomain: limits.customEmailDomain,
      },
    };
  },
});

/** Change the plan on the account owning `slug` and re-sync its business's
 *  modules to the new tier's bundle (owner only). Customer plan changes go
 *  through Stripe (checkout/portal); this stays as a platform/support fallback. */
export const setPlan = mutation({
  args: { slug: v.string(), plan: planValidator },
  returns: v.null(),
  handler: async (ctx, { slug, plan }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "owner");
    if (!business.accountId) appError("NOT_FOUND", "This account has no plan yet.");
    const account = await ctx.db.get(business.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    await ctx.db.patch(business.accountId, { plan });
    // Every business under the account picks up the new tier's modules.
    const businesses = await ctx.db
      .query("businesses")
      .withIndex("by_account", (q) => q.eq("accountId", business.accountId!))
      .collect();
    for (const b of businesses) {
      await syncEntitlementsToPlan(ctx, b._id, plan);
    }
    return null;
  },
});
