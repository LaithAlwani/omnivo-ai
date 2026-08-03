import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
  effectiveMonthlyCents,
  FOUNDING_SLOTS,
  usagePeriod,
  overageUnits,
  overageCostCents,
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
    const emailUsed = counter?.email ?? 0;
    const smsUsed = counter?.sms ?? 0;
    // AI conversations → token-based credit balance (no hard cap; overage accrues
    // past the included allowance). Emails/SMS keep their capped block overage.
    const billableTokens =
      (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0);
    const aiCredits = creditStatus(account.plan, billableTokens);
    const overageCents =
      aiCredits.overageCents +
      overageCostCents("emails", overageUnits(emailUsed, limits.emailsPerMonth)) +
      overageCostCents("sms", overageUnits(smsUsed, limits.smsPerMonth));

    const cadence = account.billingCadence ?? "monthly";
    const founding = account.foundingPartner ?? false;
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
        cadence,
        founding,
        priceMonthly: planPrice(account.plan),
        effectiveMonthlyCents: effectiveMonthlyCents(account.plan, {
          founding,
          cadence,
        }),
        commitmentEndsAt: account.commitmentEndsAt ?? null,
        aiCredits,
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
        emails: { used: emailUsed, cap: limits.emailsPerMonth },
        sms: { used: smsUsed, cap: limits.smsPerMonth },
      },
      // Estimated overage this period across the pooled allowances (metered
      // once billing is active).
      overageCents,
      features: {
        whiteLabel: limits.whiteLabel,
        customEmailDomain: limits.customEmailDomain,
      },
    };
  },
});

/** How many Founding Partner slots remain (for the marketing banner). */
export const foundingSlotsLeft = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const founders = await ctx.db
      .query("accounts")
      .filter((q) => q.eq(q.field("foundingPartner"), true))
      .collect();
    return Math.max(0, FOUNDING_SLOTS - founders.length);
  },
});

/** Change the plan on the account owning `slug` and re-sync its business's
 *  modules to the new tier's bundle (manager only; interim control until
 *  Stripe). Refuses a downgrade before an annual commitment ends. */
export const setPlan = mutation({
  args: { slug: v.string(), plan: planValidator },
  returns: v.null(),
  handler: async (ctx, { slug, plan }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "owner");
    if (!business.accountId) appError("NOT_FOUND", "This account has no plan yet.");
    const account = await ctx.db.get(business.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    // Annual accounts can't downgrade before the commitment ends.
    const rank: Record<Plan, number> = {
      starter: 0,
      professional: 1,
      premium: 2,
      enterprise: 3,
    };
    const isDowngrade = rank[plan] < rank[account.plan];
    if (
      isDowngrade &&
      account.commitmentEndsAt &&
      account.commitmentEndsAt > Date.now()
    ) {
      appError(
        "FORBIDDEN",
        "This plan is on an annual commitment and can't be downgraded until the term ends.",
      );
    }

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

/** Internal: grant Founding Partner status to an account, capped at the first
 *  FOUNDING_SLOTS accounts. Platform/manual until Stripe. */
export const markFoundingPartner = internalMutation({
  args: { accountId: v.id("accounts") },
  returns: v.object({ granted: v.boolean(), slotsLeft: v.number() }),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");
    if (account.foundingPartner) {
      const founders = await ctx.db
        .query("accounts")
        .filter((q) => q.eq(q.field("foundingPartner"), true))
        .collect();
      return { granted: true, slotsLeft: Math.max(0, FOUNDING_SLOTS - founders.length) };
    }
    const founders = await ctx.db
      .query("accounts")
      .filter((q) => q.eq(q.field("foundingPartner"), true))
      .collect();
    if (founders.length >= FOUNDING_SLOTS) {
      return { granted: false, slotsLeft: 0 };
    }
    await ctx.db.patch(accountId, { foundingPartner: true });
    return { granted: true, slotsLeft: FOUNDING_SLOTS - founders.length - 1 };
  },
});

// -----------------------------------------------------------------------------
// Migration: backfill accounts for pre-account data. Idempotent — safe to run
// repeatedly. Creates one account per distinct business owner (from the owner
// membership), maps the legacy per-business `tier` → account `plan`, links each
// business, and re-keys its usageCounters onto the account.
// -----------------------------------------------------------------------------
export const backfillAccounts = internalMutation({
  args: {},
  returns: v.object({
    accountsCreated: v.number(),
    businessesLinked: v.number(),
    countersRekeyed: v.number(),
  }),
  handler: async (ctx) => {
    let accountsCreated = 0;
    let businessesLinked = 0;
    let countersRekeyed = 0;

    const businesses = await ctx.db.query("businesses").collect();
    for (const business of businesses) {
      if (business.accountId) continue;

      // The owner membership decides who the account belongs to.
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_business", (q) => q.eq("businessId", business._id))
        .collect();
      const owner =
        memberships.find((m) => m.role === "owner") ?? memberships[0];
      if (!owner) continue; // orphan business — nothing to attach it to

      const plan = business.tier ?? "starter";
      let account = await ctx.db
        .query("accounts")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", owner.userId))
        .unique();
      if (!account) {
        const accountId = await ctx.db.insert("accounts", {
          ownerUserId: owner.userId,
          plan,
        });
        accountsCreated++;
        account = await ctx.db.get(accountId);
      }
      if (!account) continue;

      await ctx.db.patch(business._id, { accountId: account._id });
      businessesLinked++;

      // Fold this business's per-business counters into the account pool.
      const counters = await ctx.db
        .query("usageCounters")
        .withIndex("by_business_period", (q) =>
          q.eq("businessId", business._id),
        )
        .collect();
      for (const c of counters) {
        if (c.accountId) continue; // already migrated
        const existing = await ctx.db
          .query("usageCounters")
          .withIndex("by_account_period", (q) =>
            q.eq("accountId", account!._id).eq("period", c.period),
          )
          .unique();
        if (existing) {
          await ctx.db.patch(existing._id, {
            conversations: existing.conversations + c.conversations,
            sms: (existing.sms ?? 0) + (c.sms ?? 0),
            email: (existing.email ?? 0) + (c.email ?? 0),
          });
          await ctx.db.delete(c._id);
        } else {
          await ctx.db.patch(c._id, {
            accountId: account._id,
            businessId: undefined,
          });
        }
        countersRekeyed++;
      }
    }

    return { accountsCreated, businessesLinked, countersRekeyed };
  },
});

// -----------------------------------------------------------------------------
// Migration: move to the tiered bundles. Legacy "professional" accounts had the
// premium feature set (white-label + all modules), so map them → "premium" to
// avoid a silent downgrade, then re-sync every business's module entitlements to
// its account plan. Idempotent.
// -----------------------------------------------------------------------------
export const retierAndResync = internalMutation({
  args: {},
  returns: v.object({ retiered: v.number(), resynced: v.number() }),
  handler: async (ctx) => {
    let retiered = 0;
    let resynced = 0;

    const accounts = await ctx.db.query("accounts").collect();
    for (const account of accounts) {
      let plan = account.plan;
      if (plan === "professional") {
        plan = "premium";
        await ctx.db.patch(account._id, { plan });
        retiered++;
      }
      const businesses = await ctx.db
        .query("businesses")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect();
      for (const b of businesses) {
        await syncEntitlementsToPlan(ctx, b._id, plan);
        resynced++;
      }
    }

    return { retiered, resynced };
  },
});
