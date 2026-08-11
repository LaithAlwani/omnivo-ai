import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import { syncEntitlementsToPlan } from "./entitlements";
import { FOUNDING_SLOTS, usagePeriod, packGrant, type PackKey } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Billing state sync — the DB-facing half of Stripe. `convex/billing.ts` (Node
// runtime) talks to the Stripe API and calls these to persist results. Kept in
// the default runtime because a `"use node"` module can only export actions.
// The account (owner-level) is the subscription entity; usage is pooled per
// account per "YYYY-MM".
// -----------------------------------------------------------------------------

const cadenceValidator = v.union(v.literal("monthly"), v.literal("annual"));

/** Owner-authed billing context for a project — what checkout/portal need to
 *  create a Stripe session. Owner-only; throws otherwise. */
export const ownerBillingContext = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "owner");
    if (!business.accountId) appError("NOT_FOUND", "This account has no plan yet.");
    const account = await ctx.db.get(business.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    const founders = await ctx.db
      .query("accounts")
      .filter((q) => q.eq(q.field("foundingPartner"), true))
      .collect();

    return {
      accountId: account._id,
      plan: account.plan,
      cadence: account.billingCadence ?? "monthly",
      stripeCustomerId: account.stripeCustomerId ?? null,
      stripeSubscriptionId: account.stripeSubscriptionId ?? null,
      foundingPartner: account.foundingPartner ?? false,
      foundingSlotsLeft: Math.max(0, FOUNDING_SLOTS - founders.length),
      ownerEmail: (await ctx.db.get(account.ownerUserId))?.email ?? null,
    };
  },
});

/** The Stripe object ids created by the bootstrap, as a { key → stripeId } map. */
export const billingConfigMap = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("billingConfig").collect();
    return Object.fromEntries(rows.map((r) => [r.key, r.stripeId])) as Record<
      string,
      string
    >;
  },
});

/** Upsert a bootstrap-created Stripe id under a logical key. */
export const upsertBillingConfig = internalMutation({
  args: { key: v.string(), stripeId: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, stripeId }) => {
    const existing = await ctx.db
      .query("billingConfig")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { stripeId });
    } else {
      await ctx.db.insert("billingConfig", { key, stripeId });
    }
    return null;
  },
});

/** Persist the account's Stripe Customer id (created lazily at first checkout). */
export const saveStripeCustomerId = internalMutation({
  args: { accountId: v.id("accounts"), stripeCustomerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, stripeCustomerId }) => {
    await ctx.db.patch(accountId, { stripeCustomerId });
    return null;
  },
});

/** Map a Stripe customer back to its account (webhook fallback when metadata is
 *  absent, e.g. invoice events). */
export const accountByCustomer = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, { stripeCustomerId }) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripeCustomerId", stripeCustomerId),
      )
      .unique();
    return account ? { accountId: account._id } : null;
  },
});

/** Re-sync every business under an account to a plan's module bundle. */
async function resyncAccountEntitlements(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  plan: Parameters<typeof syncEntitlementsToPlan>[2],
): Promise<void> {
  const businesses = await ctx.db
    .query("businesses")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  for (const b of businesses) {
    await syncEntitlementsToPlan(ctx, b._id, plan);
  }
}

/** Apply an active Stripe subscription to the account: plan, cadence, status,
 *  paid locations, founding flag, Stripe ids — then re-sync entitlements and
 *  activate the account's businesses. Drives `customer.subscription.created`
 *  and `.updated`. All fields are already resolved from the Stripe objects by
 *  the Node webhook handler. */
export const applySubscription = internalMutation({
  args: {
    accountId: v.id("accounts"),
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    plan: planValidator,
    cadence: cadenceValidator,
    status: v.string(),
    paidLocations: v.number(),
    founding: v.boolean(),
    commitmentEndsAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    // Founding is capped at the first FOUNDING_SLOTS accounts; once granted it
    // stays granted (locked-in discount).
    let founding = account.foundingPartner ?? false;
    if (args.founding && !founding) {
      const founders = await ctx.db
        .query("accounts")
        .filter((q) => q.eq(q.field("foundingPartner"), true))
        .collect();
      if (founders.length < FOUNDING_SLOTS) founding = true;
    }

    await ctx.db.patch(args.accountId, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      ...(args.stripeCustomerId
        ? { stripeCustomerId: args.stripeCustomerId }
        : {}),
      plan: args.plan,
      billingCadence: args.cadence,
      subscriptionStatus: args.status,
      paidLocations: args.paidLocations,
      foundingPartner: founding,
      ...(args.commitmentEndsAt !== undefined
        ? { commitmentEndsAt: args.commitmentEndsAt }
        : {}),
    });

    // Active/trialing subscriptions activate the account's businesses; other
    // states (past_due, unpaid) leave status alone so a recovered payment resumes.
    if (args.status === "active" || args.status === "trialing") {
      const businesses = await ctx.db
        .query("businesses")
        .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
        .collect();
      for (const b of businesses) {
        if (b.status !== "active") await ctx.db.patch(b._id, { status: "active" });
      }
    }

    await resyncAccountEntitlements(ctx, args.accountId, args.plan);
    return null;
  },
});

/** A subscription ended (canceled/deleted): flag the account and suspend its
 *  businesses so the widget stops. Plan/entitlements are left intact so
 *  re-subscribing restores service instantly. Drives `customer.subscription.deleted`. */
export const clearSubscription = internalMutation({
  args: { accountId: v.id("accounts"), status: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, status }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    await ctx.db.patch(accountId, {
      subscriptionStatus: status,
      stripeSubscriptionId: undefined,
    });
    const businesses = await ctx.db
      .query("businesses")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const b of businesses) {
      if (b.status === "active") await ctx.db.patch(b._id, { status: "suspended" });
    }
    return null;
  },
});

/** Set only the subscription status (e.g. past_due on a failed invoice) without
 *  touching plan/entitlements. */
export const setSubscriptionStatus = internalMutation({
  args: { accountId: v.id("accounts"), status: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, status }) => {
    await ctx.db.patch(accountId, { subscriptionStatus: status });
    return null;
  },
});

/** Credit a completed one-time pack purchase to the current period's allowance
 *  (no rollover). Drives `checkout.session.completed` with mode="payment". */
export const applyPackPurchase = internalMutation({
  args: { accountId: v.id("accounts"), pack: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, pack }) => {
    const grant = packGrant(pack as PackKey);
    const period = usagePeriod(Date.now());
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", accountId).eq("period", period),
      )
      .unique();
    if (counter) {
      await ctx.db.patch(counter._id, {
        purchasedCreditCents:
          (counter.purchasedCreditCents ?? 0) + grant.creditCents,
        purchasedEmails: (counter.purchasedEmails ?? 0) + grant.emails,
        purchasedSms: (counter.purchasedSms ?? 0) + grant.sms,
      });
    } else {
      await ctx.db.insert("usageCounters", {
        accountId,
        period,
        conversations: 0,
        purchasedCreditCents: grant.creditCents,
        purchasedEmails: grant.emails,
        purchasedSms: grant.sms,
      });
    }
    return null;
  },
});
