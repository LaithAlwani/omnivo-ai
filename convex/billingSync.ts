import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import { syncEntitlementsToPlan } from "./entitlements";

// -----------------------------------------------------------------------------
// Billing state sync — the DB-facing half of Stripe. `convex/billing.ts` (Node
// runtime) talks to the Stripe API and calls these to persist results. Kept in
// the default runtime because a `"use node"` module can only export actions.
// The account (owner-level) is the subscription entity; usage is pooled per
// account per "YYYY-MM".
// -----------------------------------------------------------------------------

/** Owner-authed billing context for a project — what checkout/portal need to
 *  create a Stripe session. Owner-only; throws otherwise. */
export const ownerBillingContext = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "owner");
    if (!business.accountId) appError("NOT_FOUND", "This account has no plan yet.");
    const account = await ctx.db.get(business.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    return {
      accountId: account._id,
      plan: account.plan,
      stripeCustomerId: account.stripeCustomerId ?? null,
      stripeSubscriptionId: account.stripeSubscriptionId ?? null,
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

/** Apply an active Stripe subscription to the account: plan, status, paid
 *  locations, Stripe ids — then re-sync entitlements and resume any paused
 *  business. Drives `customer.subscription.created` and `.updated`. Fields are
 *  resolved from the Stripe objects by the Node webhook handler. */
export const applySubscription = internalMutation({
  args: {
    accountId: v.id("accounts"),
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    plan: planValidator,
    status: v.string(),
    paidLocations: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) appError("NOT_FOUND", "Account not found.");

    await ctx.db.patch(args.accountId, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      ...(args.stripeCustomerId
        ? { stripeCustomerId: args.stripeCustomerId }
        : {}),
      plan: args.plan,
      subscriptionStatus: args.status,
      paidLocations: args.paidLocations,
    });

    // Active/trialing subscription resumes a previously-paused business (billing
    // recovered). It does NOT force a business live — going live is gated by the
    // go-live checklist, not billing.
    if (args.status === "active" || args.status === "trialing") {
      const businesses = await ctx.db
        .query("businesses")
        .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
        .collect();
      for (const b of businesses) {
        if (b.status === "paused") await ctx.db.patch(b._id, { status: "live" });
      }
    }

    await resyncAccountEntitlements(ctx, args.accountId, args.plan);
    return null;
  },
});

/** A subscription ended (canceled/deleted): flag the account and pause its live
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
      if (b.status === "live") await ctx.db.patch(b._id, { status: "paused" });
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
