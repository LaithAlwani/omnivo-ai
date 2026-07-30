import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import {
  accountProjectLimit,
  accountLocationLimit,
} from "./lib/accounts";
import {
  tierLimits,
  usagePeriod,
  overageUnits,
  overageCostCents,
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
  plan: "starter" | "professional" | "enterprise",
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

    const projects = await ctx.db
      .query("businesses")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();

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
    const overageCents =
      overageCostCents(
        "conversations",
        overageUnits(convUsed, limits.conversationsPerMonth),
      ) +
      overageCostCents("emails", overageUnits(emailUsed, limits.emailsPerMonth)) +
      overageCostCents("sms", overageUnits(smsUsed, limits.smsPerMonth));

    return {
      plan: account.plan,
      period,
      projects: {
        used: projects.length,
        max: accountProjectLimit(account),
      },
      locationLimitPerProject: accountLocationLimit(account),
      usage: {
        conversations: {
          used: convUsed,
          cap: limits.conversationsPerMonth,
        },
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

/** Change the plan on the account owning `slug` (manager only; interim manual
 *  control until Stripe drives this). */
export const setPlan = mutation({
  args: { slug: v.string(), plan: planValidator },
  returns: v.null(),
  handler: async (ctx, { slug, plan }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "owner");
    if (!business.accountId) appError("NOT_FOUND", "This project has no account yet.");
    await ctx.db.patch(business.accountId, { plan });
    return null;
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
