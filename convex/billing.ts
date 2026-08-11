"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import {
  type Tier,
  type PackKey,
  planPrice,
  annualMonthlyPrice,
  packPriceCents,
  ADDITIONAL_LOCATION_CENTS,
  FOUNDING_DISCOUNT_PCT,
} from "./lib/tiers";

// -----------------------------------------------------------------------------
// Stripe billing — the Node-runtime half that talks to the Stripe API. The
// account (owner-level) is the subscription entity. Public actions create
// Checkout/portal sessions; the webhook verifies signatures and hands off to
// `convex/billingSync.ts` mutations for all DB writes. Pricing is single-sourced
// from `convex/lib/tiers.ts`; `bootstrapStripe` mirrors it into Stripe once.
// -----------------------------------------------------------------------------

const PAID_TIERS: Tier[] = ["starter", "professional", "premium"];
const CADENCES = ["monthly", "annual"] as const;
const cadenceValidator = v.union(v.literal("monthly"), v.literal("annual"));

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    appError(
      "CONFIG",
      "Billing isn't configured — set STRIPE_SECRET_KEY on the Convex deployment.",
    );
  }
  return new Stripe(key);
}

function siteUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

// --- One-time bootstrap ------------------------------------------------------

async function ensureProduct(
  stripe: Stripe,
  id: string,
  name: string,
): Promise<string> {
  try {
    const existing = await stripe.products.retrieve(id);
    return existing.id;
  } catch {
    const created = await stripe.products.create({ id, name });
    return created.id;
  }
}

async function ensurePrice(
  stripe: Stripe,
  lookupKey: string,
  params: Omit<Stripe.PriceCreateParams, "lookup_key">,
): Promise<string> {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const created = await stripe.prices.create({
    ...params,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  });
  return created.id;
}

async function ensureCoupon(stripe: Stripe, id: string): Promise<string> {
  try {
    const existing = await stripe.coupons.retrieve(id);
    return existing.id;
  } catch {
    const created = await stripe.coupons.create({
      id,
      percent_off: FOUNDING_DISCOUNT_PCT,
      duration: "forever",
      name: "Founding Partner",
    });
    return created.id;
  }
}

/** Idempotently create the Products/Prices/coupon that back the tiers + packs,
 *  and record their Stripe ids in `billingConfig`. Run once per deployment:
 *  `npx convex run billing:bootstrapStripe`. Safe to re-run. */
export const bootstrapStripe = internalAction({
  args: {},
  returns: v.object({ created: v.array(v.string()) }),
  handler: async (ctx) => {
    const stripe = getStripe();
    const set = async (key: string, stripeId: string) => {
      await ctx.runMutation(internal.billingSync.upsertBillingConfig, {
        key,
        stripeId,
      });
    };
    const keys: string[] = [];

    // Subscription tiers × cadences.
    for (const tier of PAID_TIERS) {
      const product = await ensureProduct(
        stripe,
        `omnivo_${tier}`,
        `Omnivo ${tier[0].toUpperCase()}${tier.slice(1)}`,
      );
      for (const cadence of CADENCES) {
        const monthly = planPrice(tier)!; // dollars
        const amount =
          cadence === "monthly"
            ? monthly * 100
            : annualMonthlyPrice(tier)! * 12 * 100; // 2 months free, billed yearly
        const key = `sub_${tier}_${cadence}`;
        const priceId = await ensurePrice(stripe, key, {
          product,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval: cadence === "monthly" ? "month" : "year" },
        });
        await set(key, priceId);
        keys.push(key);
      }
    }

    // One-time consumable packs.
    const packs: PackKey[] = ["credits", "emails", "sms"];
    for (const pack of packs) {
      const product = await ensureProduct(
        stripe,
        `omnivo_pack_${pack}`,
        `Omnivo ${pack} pack`,
      );
      const key = `pack_${pack}`;
      const priceId = await ensurePrice(stripe, key, {
        product,
        currency: "usd",
        unit_amount: packPriceCents(pack),
      });
      await set(key, priceId);
      keys.push(key);
    }

    // Extra-location subscription add-on (quantity managed via the portal).
    const locationProduct = await ensureProduct(
      stripe,
      "omnivo_addon_location",
      "Omnivo additional location",
    );
    const locationPrice = await ensurePrice(stripe, "addon_location", {
      product: locationProduct,
      currency: "usd",
      unit_amount: ADDITIONAL_LOCATION_CENTS,
      recurring: { interval: "month" },
    });
    await set("addon_location", locationPrice);
    keys.push("addon_location");

    // Founding Partner coupon (50% off, forever).
    const coupon = await ensureCoupon(stripe, "founding_50");
    await set("coupon_founding", coupon);
    keys.push("coupon_founding");

    return { created: keys };
  },
});

// --- Checkout / portal -------------------------------------------------------

/** Create or reuse the account's Stripe Customer. */
async function ensureCustomer(
  ctx: ActionCtx,
  stripe: Stripe,
  billing: {
    accountId: Id<"accounts">;
    stripeCustomerId: string | null;
    ownerEmail: string | null;
  },
): Promise<string> {
  if (billing.stripeCustomerId) return billing.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: billing.ownerEmail ?? undefined,
    metadata: { accountId: String(billing.accountId) },
  });
  await ctx.runMutation(internal.billingSync.saveStripeCustomerId, {
    accountId: billing.accountId,
    stripeCustomerId: customer.id,
  });
  return customer.id;
}

/** Subscription Checkout for the caller's account (owner-only). Returns a hosted
 *  Checkout URL the client redirects to. */
export const createCheckoutSession = action({
  args: { slug: v.string(), plan: planValidator, cadence: cadenceValidator },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { slug, plan, cadence }) => {
    const stripe = getStripe();
    const billing = await ctx.runQuery(
      internal.billingSync.ownerBillingContext,
      { slug },
    );
    const config = await ctx.runQuery(internal.billingSync.billingConfigMap, {});
    const price = config[`sub_${plan}_${cadence}`];
    if (!price) {
      appError("CONFIG", "Billing isn't set up yet — run billing:bootstrapStripe.");
    }

    const customer = await ensureCustomer(ctx, stripe, billing);
    const founding = billing.foundingPartner || billing.foundingSlotsLeft > 0;
    const site = siteUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      ...(founding && config.coupon_founding
        ? { discounts: [{ coupon: config.coupon_founding }] }
        : { allow_promotion_codes: true }),
      subscription_data: {
        metadata: {
          accountId: String(billing.accountId),
          plan,
          cadence,
          founding: String(founding),
        },
      },
      success_url: `${site}/dashboard/${slug}/usage?checkout=success`,
      cancel_url: `${site}/dashboard/${slug}/usage?checkout=cancel`,
    });
    if (!session.url) appError("CONFIG", "Stripe did not return a checkout URL.");
    return { url: session.url };
  },
});

/** One-time Checkout for a consumable pack (credits / emails / SMS). */
export const createPackCheckout = action({
  args: {
    slug: v.string(),
    pack: v.union(v.literal("credits"), v.literal("emails"), v.literal("sms")),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { slug, pack }) => {
    const stripe = getStripe();
    const billing = await ctx.runQuery(
      internal.billingSync.ownerBillingContext,
      { slug },
    );
    const config = await ctx.runQuery(internal.billingSync.billingConfigMap, {});
    const price = config[`pack_${pack}`];
    if (!price) {
      appError("CONFIG", "Billing isn't set up yet — run billing:bootstrapStripe.");
    }

    const customer = await ensureCustomer(ctx, stripe, billing);
    const site = siteUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price, quantity: 1 }],
      metadata: { accountId: String(billing.accountId), pack },
      success_url: `${site}/dashboard/${slug}/usage?pack=success`,
      cancel_url: `${site}/dashboard/${slug}/usage?pack=cancel`,
    });
    if (!session.url) appError("CONFIG", "Stripe did not return a checkout URL.");
    return { url: session.url };
  },
});

/** Stripe Billing Portal session for plan changes / payment method / cancel. */
export const createPortalSession = action({
  args: { slug: v.string() },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { slug }) => {
    const stripe = getStripe();
    const billing = await ctx.runQuery(
      internal.billingSync.ownerBillingContext,
      { slug },
    );
    if (!billing.stripeCustomerId) {
      appError("NOT_FOUND", "No billing account yet — subscribe first.");
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: `${siteUrl()}/dashboard/${slug}/usage`,
    });
    return { url: session.url };
  },
});

// --- Webhook -----------------------------------------------------------------

/** Resolve a subscription's plan + cadence from its first recurring item, using
 *  the reverse of the billingConfig map. Returns null if it's not one of ours. */
function planFromSubscription(
  sub: Stripe.Subscription,
  reverse: Record<string, string>,
): { plan: Tier; cadence: "monthly" | "annual" } | null {
  for (const item of sub.items.data) {
    const key = reverse[item.price.id];
    if (key?.startsWith("sub_")) {
      const [, plan, cadence] = key.split("_");
      return { plan: plan as Tier, cadence: cadence as "monthly" | "annual" };
    }
  }
  return null;
}

/** Verify the Stripe signature and apply the event to account state. Called by
 *  the `/stripe/webhook` HTTP route with the raw body + signature header. */
export const handleWebhook = internalAction({
  args: { body: v.string(), signature: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { body, signature }) => {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      appError(
        "CONFIG",
        "Billing webhook isn't configured — set STRIPE_WEBHOOK_SECRET on the Convex deployment.",
      );
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      return { ok: false }; // bad signature → 400
    }

    const config = await ctx.runQuery(internal.billingSync.billingConfigMap, {});
    const reverse: Record<string, string> = Object.fromEntries(
      Object.entries(config).map(([k, id]) => [id, k]),
    );

    const accountFromCustomer = async (
      customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
    ): Promise<Id<"accounts"> | null> => {
      const id = typeof customer === "string" ? customer : customer?.id;
      if (!id) return null;
      const res = await ctx.runQuery(internal.billingSync.accountByCustomer, {
        stripeCustomerId: id,
      });
      return res?.accountId ?? null;
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.mode === "payment" && s.metadata?.accountId && s.metadata?.pack) {
          await ctx.runMutation(internal.billingSync.applyPackPurchase, {
            accountId: s.metadata.accountId as Id<"accounts">,
            pack: s.metadata.pack,
          });
        }
        break; // subscription mode is handled by customer.subscription.* below
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const accountId =
          (sub.metadata?.accountId as Id<"accounts"> | undefined) ??
          (await accountFromCustomer(sub.customer));
        if (!accountId) break;

        const resolved = planFromSubscription(sub, reverse);
        if (!resolved) break; // not one of our subscription prices

        const locationItem = sub.items.data.find(
          (it) => it.price.id === config.addon_location,
        );
        const paidLocations = locationItem?.quantity ?? 0;
        const founding =
          sub.metadata?.founding === "true" ||
          (Array.isArray(sub.discounts) && sub.discounts.length > 0);
        // Annual commitments lock until the period ends; monthly has none.
        const periodEnd =
          (sub as unknown as { current_period_end?: number })
            .current_period_end ?? sub.items.data[0]?.current_period_end;
        const commitmentEndsAt =
          resolved.cadence === "annual" && periodEnd
            ? periodEnd * 1000
            : undefined;

        await ctx.runMutation(internal.billingSync.applySubscription, {
          accountId,
          stripeSubscriptionId: sub.id,
          stripeCustomerId:
            typeof sub.customer === "string" ? sub.customer : undefined,
          plan: resolved.plan,
          cadence: resolved.cadence,
          status: sub.status,
          paidLocations,
          founding,
          commitmentEndsAt,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const accountId =
          (sub.metadata?.accountId as Id<"accounts"> | undefined) ??
          (await accountFromCustomer(sub.customer));
        if (accountId) {
          await ctx.runMutation(internal.billingSync.clearSubscription, {
            accountId,
            status: sub.status,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        const accountId = await accountFromCustomer(inv.customer);
        if (accountId) {
          await ctx.runMutation(internal.billingSync.setSubscriptionStatus, {
            accountId,
            status: "past_due",
          });
        }
        break;
      }
    }

    return { ok: true };
  },
});
