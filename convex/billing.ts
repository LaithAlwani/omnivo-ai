"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appError } from "./lib/errors";
import { planValidator } from "./schema";
import { type Tier, planPrice, ADDITIONAL_LOCATION_CENTS } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Stripe billing — the Node-runtime half that talks to the Stripe API. The
// account (owner-level) is the subscription entity, billed a monthly published
// tier price. Public actions create Checkout/portal sessions; the webhook
// verifies signatures and hands off to `convex/billingSync.ts` for DB writes.
// Pricing is single-sourced from `convex/lib/tiers.ts`.
// -----------------------------------------------------------------------------

const PAID_TIERS: Tier[] = ["starter", "professional", "premium"];

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

/** Idempotently create the monthly subscription Prices + the extra-location
 *  add-on, and record their Stripe ids in `billingConfig`. Run once per
 *  deployment: `npx convex run billing:bootstrapStripe`. Safe to re-run. */
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

    // Monthly subscription price per tier.
    for (const tier of PAID_TIERS) {
      const product = await ensureProduct(
        stripe,
        `omnivo_${tier}`,
        `Omnivo ${tier[0].toUpperCase()}${tier.slice(1)}`,
      );
      const key = `sub_${tier}_monthly`;
      const priceId = await ensurePrice(stripe, key, {
        product,
        currency: "usd",
        unit_amount: planPrice(tier)! * 100,
        recurring: { interval: "month" },
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

/** Monthly subscription Checkout for the caller's account (owner-only). Returns
 *  a hosted Checkout URL the client redirects to. */
export const createCheckoutSession = action({
  args: { slug: v.string(), plan: planValidator },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { slug, plan }) => {
    const stripe = getStripe();
    const billing = await ctx.runQuery(
      internal.billingSync.ownerBillingContext,
      { slug },
    );
    const config = await ctx.runQuery(internal.billingSync.billingConfigMap, {});
    const price = config[`sub_${plan}_monthly`];
    if (!price) {
      appError("CONFIG", "Billing isn't set up yet — run billing:bootstrapStripe.");
    }

    const customer = await ensureCustomer(ctx, stripe, billing);
    const site = siteUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { accountId: String(billing.accountId), plan },
      },
      success_url: `${site}/dashboard/${slug}/usage?checkout=success`,
      cancel_url: `${site}/dashboard/${slug}/usage?checkout=cancel`,
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

/** Resolve a subscription's plan from its first recurring item, using the
 *  reverse of the billingConfig map. Returns null if it's not one of ours. */
function planFromSubscription(
  sub: Stripe.Subscription,
  reverse: Record<string, string>,
): Tier | null {
  for (const item of sub.items.data) {
    const key = reverse[item.price.id];
    if (key?.startsWith("sub_")) return key.split("_")[1] as Tier;
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
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const accountId =
          (sub.metadata?.accountId as Id<"accounts"> | undefined) ??
          (await accountFromCustomer(sub.customer));
        if (!accountId) break;

        const plan = planFromSubscription(sub, reverse);
        if (!plan) break; // not one of our subscription prices

        const locationItem = sub.items.data.find(
          (it) => it.price.id === config.addon_location,
        );
        const paidLocations = locationItem?.quantity ?? 0;

        await ctx.runMutation(internal.billingSync.applySubscription, {
          accountId,
          stripeSubscriptionId: sub.id,
          stripeCustomerId:
            typeof sub.customer === "string" ? sub.customer : undefined,
          plan,
          status: sub.status,
          paidLocations,
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
