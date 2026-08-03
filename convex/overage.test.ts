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

  // Overage is per-unit and pricey: $0.05 / email.
  expect(overageCostCents("emails", 0)).toBe(0);
  expect(overageCostCents("emails", 250)).toBe(1250);
  expect(overageCostCents("emails", 1200)).toBe(6000);
  // $0.50 / SMS.
  expect(overageCostCents("sms", 150)).toBe(7500);
});

// planUsage surfaces email/SMS overage once pooled usage passes the cap, and
// AI-credit overage once billable tokens pass the plan's included allowance.
test("planUsage — surfaces overage over the pooled caps", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter", // 2,500 email pool · 1.5M token credit allowance
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });

  // Force the account counter past the Starter email cap and its token credit
  // allowance (1.5M): 1.6M billable tokens = 100K over → one $3 block.
  const accountId = (await t.run((ctx) => ctx.db.get(businessId)))!.accountId!;
  const period = new Date().toISOString().slice(0, 7);
  await t.run((ctx) =>
    ctx.db.insert("usageCounters", {
      accountId,
      period,
      conversations: 0,
      email: 2750,
      aiInputTokens: 1_000_000,
      aiOutputTokens: 600_000,
    }),
  );

  const usage = await as.query(api.tiers.planUsage, { slug: "clip" });
  expect(usage.emails.overage).toBe(250);
  expect(usage.emails.overageCents).toBe(1250); // 250 × $0.05

  // AI credits: 1.6M tokens, 1.5M allowance → 100K over → one $3 block.
  expect(usage.aiCredits.allowanceTokens).toBe(1_500_000);
  expect(usage.aiCredits.usedTokens).toBe(1_600_000);
  expect(usage.aiCredits.overTokens).toBe(100_000);
  expect(usage.aiCredits.overageCents).toBe(300); // $3

  // myAccount folds both into a single estimated overage figure ($12.50 + $3).
  const account = await as.query(api.accounts.myAccount, {});
  expect(account?.overageCents).toBe(1550);
});
