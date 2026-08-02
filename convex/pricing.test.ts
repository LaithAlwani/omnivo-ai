/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  planPrice,
  foundingPrice,
  annualMonthlyPrice,
  effectiveMonthlyCents,
  smsCap,
  locationLimit,
} from "./lib/tiers";

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

// Regular / founding / annual pricing math.
test("pricing helpers — regular, founding (50% off), annual (2 months free)", () => {
  expect(planPrice("starter")).toBe(299);
  expect(planPrice("professional")).toBe(449);
  expect(planPrice("premium")).toBe(499);
  expect(planPrice("enterprise")).toBeNull();

  // 50% off, rounded.
  expect(foundingPrice("starter")).toBe(150);
  expect(foundingPrice("professional")).toBe(225);
  expect(foundingPrice("premium")).toBe(250);

  // × 10/12, rounded.
  expect(annualMonthlyPrice("premium")).toBe(Math.round((499 * 10) / 12)); // 416

  // effectiveMonthlyCents resolves the right rate (in cents).
  expect(effectiveMonthlyCents("premium", {})).toBe(49900);
  expect(effectiveMonthlyCents("premium", { founding: true })).toBe(25000);
  expect(effectiveMonthlyCents("premium", { cadence: "annual" })).toBe(41600);
  // Founding wins over cadence (they don't stack).
  expect(
    effectiveMonthlyCents("premium", { founding: true, cadence: "annual" }),
  ).toBe(25000);

  // SMS is in every tier now, scaling up; locations scale with the tier.
  expect(smsCap("starter")).toBe(100);
  expect(smsCap("professional")).toBe(500);
  expect(smsCap("premium")).toBe(1500);
  expect(locationLimit("starter")).toBe(1);
  expect(locationLimit("professional")).toBe(2);
  expect(locationLimit("premium")).toBe(5);
});

// setPlan re-syncs the business's modules to the new tier's bundle.
test("setPlan — upgrading flips modules on, downgrading turns them off", async () => {
  const t = convexTest(schema, modules);
  const { as } = await ownerWithBusiness(t, "starter");

  let e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.salesAssistantEnabled).toBe(false);
  expect(e.integrationsEnabled).toBe(false);

  await as.mutation(api.accounts.setPlan, { slug: "co", plan: "premium" });
  e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.salesAssistantEnabled).toBe(true);
  expect(e.integrationsEnabled).toBe(true);
  expect(e.smsAutomationEnabled).toBe(true);

  await as.mutation(api.accounts.setPlan, { slug: "co", plan: "starter" });
  e = await as.query(api.entitlements.get, { slug: "co" });
  expect(e.salesAssistantEnabled).toBe(false);
  expect(e.reviewManagementEnabled).toBe(false);
  expect(e.bookingEnabled).toBe(true); // still in Starter
});

// Extra locations bought raise the effective cap.
test("paid locations raise the effective location cap", async () => {
  const t = convexTest(schema, modules);
  const { as } = await ownerWithBusiness(t, "starter");
  // Grant 2 extra locations directly (manual until Stripe).
  await t.run(async (ctx) => {
    const account = await ctx.db.query("accounts").first();
    await ctx.db.patch(account!._id, { paidLocations: 2 });
  });
  const acct = await as.query(api.accounts.myAccount, {});
  // Starter includes 1 + 2 paid = 3.
  expect(acct?.locations).toMatchObject({ included: 1, paid: 2, cap: 3 });
});

// Founding Partner is capped at the first 10 accounts.
test("founding — first 10 accounts granted, 11th refused", async () => {
  const t = convexTest(schema, modules);
  // Ten accounts already marked founding.
  const ids = await t.run(async (ctx) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const u = await ctx.db.insert("users", { email: `f${i}@x.com` });
      out.push(
        await ctx.db.insert("accounts", {
          ownerUserId: u,
          plan: "starter" as const,
          foundingPartner: true,
        }),
      );
    }
    // An 11th, not yet founding.
    const u = await ctx.db.insert("users", { email: "eleventh@x.com" });
    out.push(
      await ctx.db.insert("accounts", { ownerUserId: u, plan: "starter" as const }),
    );
    return out;
  });

  expect(await t.query(api.accounts.foundingSlotsLeft, {})).toBe(0);
  const res = await t.mutation(internal.accounts.markFoundingPartner, {
    accountId: ids[10],
  });
  expect(res.granted).toBe(false);
});