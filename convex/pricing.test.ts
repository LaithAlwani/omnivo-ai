/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { planPrice, monthlyCents, smsCap, locationLimit } from "./lib/tiers";

const modules = import.meta.glob("./**/*.ts");

async function ownerWithBusiness(
  t: TestConvex<typeof schema>,
  plan: "starter" | "professional" | "premium",
) {
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "o@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  await as.mutation(internal.businesses.provision, {
    name: "Co",
    slug: "co",
    tier: plan,
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { as };
}

// Published monthly pricing + the installer override fork.
test("pricing helpers — published price, monthlyCents override, caps", () => {
  expect(planPrice("starter")).toBe(299);
  expect(planPrice("professional")).toBe(449);
  expect(planPrice("premium")).toBe(499);
  expect(planPrice("enterprise")).toBeNull();

  // monthlyCents falls back to the published tier price (in cents)...
  expect(monthlyCents("premium")).toBe(49900);
  expect(monthlyCents("enterprise")).toBeNull();
  // ...but an installer's quoted override wins.
  expect(monthlyCents("premium", 60000)).toBe(60000);
  expect(monthlyCents("enterprise", 120000)).toBe(120000);

  // SMS is in every tier now, scaling up; locations scale with the tier.
  expect(smsCap("starter")).toBe(100);
  expect(smsCap("professional")).toBe(500);
  expect(smsCap("premium")).toBe(1500);
  expect(locationLimit("starter")).toBe(1);
  expect(locationLimit("professional")).toBe(2);
  expect(locationLimit("premium")).toBe(5);
});

// setPlan re-syncs the plan; every tier now bundles the same connector modules.
test("setPlan — changes the plan, connector modules stay on across tiers", async () => {
  const t = convexTest(schema, modules);
  const { as } = await ownerWithBusiness(t, "starter");

  // Connectors (Integrations/booking/lead) are base — on from Starter up.
  let e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.integrationsEnabled).toBe(true);
  expect(e.bookingEnabled).toBe(true);
  expect(e.leadQualificationEnabled).toBe(true);

  await as.mutation(api.accounts.setPlan, { slug: "co", plan: "premium" });
  expect((await as.query(api.accounts.myAccount, {}))?.plan).toBe("premium");
  e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.integrationsEnabled).toBe(true);
  expect(e.bookingEnabled).toBe(true);

  await as.mutation(api.accounts.setPlan, { slug: "co", plan: "starter" });
  expect((await as.query(api.accounts.myAccount, {}))?.plan).toBe("starter");
  e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.integrationsEnabled).toBe(true); // still base on Starter
});

// Extra locations bought raise the effective cap.
test("paid locations raise the effective location cap", async () => {
  const t = convexTest(schema, modules);
  const { as } = await ownerWithBusiness(t, "starter");
  // Grant 2 extra locations directly (Stripe syncs paidLocations in production).
  await t.run(async (ctx) => {
    const account = await ctx.db.query("accounts").first();
    await ctx.db.patch(account!._id, { paidLocations: 2 });
  });
  const acct = await as.query(api.accounts.myAccount, {});
  // Starter includes 1 + 2 paid = 3.
  expect(acct?.locations).toMatchObject({ included: 1, paid: 2, cap: 3 });
});