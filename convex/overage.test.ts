/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { overageUnits, overageCostCents } from "./lib/tiers";

const modules = import.meta.glob("./**/*.ts");

// Pure overage math: blocks rounded up, unlimited plans never overage.
test("overage math — units past cap billed per block", () => {
  expect(overageUnits(2400, 2500)).toBe(0);
  expect(overageUnits(2750, 2500)).toBe(250);
  expect(overageUnits(100, null)).toBe(0); // unlimited

  // $10 / 1,000 conversations, rounded up per block.
  expect(overageCostCents("conversations", 0)).toBe(0);
  expect(overageCostCents("conversations", 250)).toBe(1000);
  expect(overageCostCents("conversations", 1200)).toBe(2000);
  // $10 / 100 SMS.
  expect(overageCostCents("sms", 150)).toBe(2000);
});

// planUsage surfaces overage once pooled usage passes the plan allowance.
test("planUsage — surfaces overage over the pooled cap", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter", // 2,500 conversation pool
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });

  // Force the account counter past the Starter conversation cap.
  const accountId = (await t.run((ctx) => ctx.db.get(businessId)))!.accountId!;
  const period = new Date().toISOString().slice(0, 7);
  await t.run((ctx) =>
    ctx.db.insert("usageCounters", {
      accountId,
      period,
      conversations: 2750,
    }),
  );

  const usage = await as.query(api.tiers.planUsage, { slug: "clip" });
  expect(usage.conversations.overage).toBe(250);
  expect(usage.conversations.overageCents).toBe(1000); // $10

  const account = await as.query(api.accounts.myAccount, {});
  expect(account?.overageCents).toBe(1000);
});
