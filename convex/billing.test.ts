/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const provisionArgs = (name: string, slug: string, prefix: string) => ({
  name,
  slug,
  embedKeyPrefix: prefix,
  embedKeyHash: "h",
  embedKey: `ek_${prefix}.x`,
});

/** Provision an owner + business on a tier and return the handles. */
async function seed(
  t: TestConvex<typeof schema>,
  slug: string,
  prefix: string,
  tier: "starter" | "professional" | "premium",
) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: `${slug}@x.com` }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    ...provisionArgs(slug, slug, prefix),
    tier,
  });
  const accountId = (await t.run((ctx) => ctx.db.get(businessId)))!.accountId!;
  return { as, businessId, accountId };
}

// -----------------------------------------------------------------------------
// Subscription lifecycle
// -----------------------------------------------------------------------------

test("applySubscription sets plan + ids, re-syncs entitlements, resumes paused", async () => {
  const t = convexTest(schema, modules);
  const { businessId, accountId } = await seed(t, "acme", "aaaaaa", "starter");
  // A paused (billing-lapsed) business is resumed by a recovered subscription.
  await t.run((ctx) => ctx.db.patch(businessId, { status: "paused" as const }));

  await t.mutation(internal.billingSync.applySubscription, {
    accountId,
    stripeSubscriptionId: "sub_123",
    stripeCustomerId: "cus_123",
    plan: "premium",
    cadence: "monthly",
    status: "active",
    paidLocations: 2,
    founding: true,
  });

  const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
  expect(account.plan).toBe("premium");
  expect(account.subscriptionStatus).toBe("active");
  expect(account.stripeSubscriptionId).toBe("sub_123");
  expect(account.stripeCustomerId).toBe("cus_123");
  expect(account.paidLocations).toBe(2);
  expect(account.foundingPartner).toBe(true);
  expect(account.billingCadence).toBe("monthly");

  // Paused business resumes to live; its modules match the premium bundle.
  const business = (await t.run((ctx) => ctx.db.get(businessId)))!;
  expect(business.status).toBe("live");
  const features = await t.run((ctx) =>
    ctx.db
      .query("tenantFeatures")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .unique(),
  );
  expect(features?.integrationsEnabled).toBe(true); // premium bundles Integrations
  expect(features?.bookingEnabled).toBe(true);
});

test("founding is capped and locked once granted", async () => {
  const t = convexTest(schema, modules);
  // Fill all 10 founding slots first.
  await t.run(async (ctx) => {
    for (let i = 0; i < 10; i++) {
      const u = await ctx.db.insert("users", { email: `f${i}@x.com` });
      await ctx.db.insert("accounts", {
        ownerUserId: u,
        plan: "starter",
        foundingPartner: true,
      });
    }
  });
  const { accountId } = await seed(t, "late", "bbbbbb", "starter");
  await t.mutation(internal.billingSync.applySubscription, {
    accountId,
    stripeSubscriptionId: "sub_late",
    plan: "starter",
    cadence: "monthly",
    status: "active",
    paidLocations: 0,
    founding: true, // requested, but slots are full
  });
  const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
  expect(account.foundingPartner ?? false).toBe(false);
});

test("clearSubscription flags canceled and pauses a live business", async () => {
  const t = convexTest(schema, modules);
  const { businessId, accountId } = await seed(t, "gone", "cccccc", "professional");
  // A live business whose subscription is canceled gets paused.
  await t.run((ctx) => ctx.db.patch(businessId, { status: "live" as const }));

  await t.mutation(internal.billingSync.clearSubscription, {
    accountId,
    status: "canceled",
  });

  const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
  expect(account.subscriptionStatus).toBe("canceled");
  expect(account.stripeSubscriptionId).toBeUndefined();
  const business = (await t.run((ctx) => ctx.db.get(businessId)))!;
  expect(business.status).toBe("paused");
});

// -----------------------------------------------------------------------------
// Pack purchases → lifted allowances
// -----------------------------------------------------------------------------

test("applyPackPurchase credits the current period and lifts the AI-credit allowance", async () => {
  const t = convexTest(schema, modules);
  const { as, accountId } = await seed(t, "packs", "dddddd", "starter");

  await t.mutation(internal.billingSync.applyPackPurchase, {
    accountId,
    pack: "credits",
  });

  const period = new Date().toISOString().slice(0, 7);
  const counter = await t.run((ctx) =>
    ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", accountId).eq("period", period),
      )
      .unique(),
  );
  expect(counter?.purchasedCreditCents).toBe(1000); // $10 pack

  // planUsage: Starter's 1,500¢ grant + a 1,000¢ pack = 2,500 credits granted.
  const usage = await as.query(api.tiers.planUsage, { slug: "packs" });
  expect(usage.aiCredits.grantedCents).toBe(2500);
  expect(usage.aiCredits.allowanceTokens).toBe(2_500_000); // 2,500 × 1,000 tokens
});

test("email pack lifts the hard send cap and the surfaced allowance", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId, accountId } = await seed(t, "mail", "eeeeee", "starter");
  const period = new Date().toISOString().slice(0, 7);

  // Sit exactly at Starter's 2,500 email cap.
  await t.run((ctx) =>
    ctx.db.insert("usageCounters", {
      accountId,
      period,
      conversations: 0,
      email: 2500,
    }),
  );
  let status = await t.query(internal.usage.emailCapStatus, {
    businessId,
    period,
  });
  expect(status.over).toBe(true); // capped before the pack

  // Buy a 1,000-email bundle → cap rises to 3,500, no longer over.
  await t.mutation(internal.billingSync.applyPackPurchase, {
    accountId,
    pack: "emails",
  });
  status = await t.query(internal.usage.emailCapStatus, { businessId, period });
  expect(status.cap).toBe(3500);
  expect(status.over).toBe(false);

  const usage = await as.query(api.tiers.planUsage, { slug: "mail" });
  expect(usage.emails.cap).toBe(3500);
});
