/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
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
    status: "active",
    paidLocations: 2,
  });

  const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
  expect(account.plan).toBe("premium");
  expect(account.subscriptionStatus).toBe("active");
  expect(account.stripeSubscriptionId).toBe("sub_123");
  expect(account.stripeCustomerId).toBe("cus_123");
  expect(account.paidLocations).toBe(2);

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
