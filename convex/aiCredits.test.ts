/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  creditGrantCents,
  creditTokens,
  creditCostCents,
  conversationOverageCents,
  creditStatus,
  creditsFromCents,
  TOKENS_PER_CREDIT,
} from "./lib/tiers";
import { estimateCostCents } from "./lib/modelPricing";

const modules = import.meta.glob("./**/*.ts");

// --- Pure credit economy -----------------------------------------------------

test("credit grants + token allowances per tier", () => {
  expect(creditGrantCents("starter")).toBe(1500); // $15
  expect(creditGrantCents("professional")).toBe(3000); // $30
  expect(creditGrantCents("premium")).toBe(5000); // $50
  expect(creditGrantCents("enterprise")).toBe(null); // custom

  // $1 = 100,000 tokens → allowances of 1.5M / 3M / 5M.
  expect(creditTokens("starter")).toBe(1_500_000);
  expect(creditTokens("professional")).toBe(3_000_000);
  expect(creditTokens("premium")).toBe(5_000_000);
  expect(creditTokens("enterprise")).toBe(null);
});

test("credit display denomination — $1 = 100 credits = 1,000-token units", () => {
  // Grants render as whole-number credit counts (the customer-facing unit).
  expect(creditsFromCents(creditGrantCents("starter")!)).toBe(1500);
  expect(creditsFromCents(creditGrantCents("professional")!)).toBe(3000);
  expect(creditsFromCents(creditGrantCents("premium")!)).toBe(5000);
  // 1 credit = 1,000 tokens.
  expect(TOKENS_PER_CREDIT).toBe(1000);
  // A partial-usage cents figure maps 1:1 to credits ($6.50 → 650 credits).
  expect(creditsFromCents(650)).toBe(650);
});

test("credit cost + overage block math", () => {
  // $10 / 1M tokens → 1 cent per 1,000 tokens.
  expect(creditCostCents(100_000)).toBe(100); // $1
  expect(creditCostCents(1_500_000)).toBe(1500); // exactly the Starter grant

  // Overage billed up-front in whole $3 blocks per 100K tokens.
  expect(conversationOverageCents(0)).toBe(0);
  expect(conversationOverageCents(1)).toBe(300); // 1 token over → $3
  expect(conversationOverageCents(100_000)).toBe(300); // full first block
  expect(conversationOverageCents(100_001)).toBe(600); // into the second → $6
});

test("creditStatus — under, at, and past the allowance", () => {
  // Under allowance: partial used, remainder left, no overage.
  const under = creditStatus("starter", 500_000); // $5 of $15
  expect(under.grantedCents).toBe(1500);
  expect(under.usedCents).toBe(500);
  expect(under.remainingCents).toBe(1000);
  expect(under.overTokens).toBe(0);
  expect(under.overageCents).toBe(0);

  // Exactly at allowance: fully used, nothing left, no overage yet.
  const at = creditStatus("starter", 1_500_000);
  expect(at.usedCents).toBe(1500);
  expect(at.remainingCents).toBe(0);
  expect(at.overTokens).toBe(0);
  expect(at.overageCents).toBe(0);

  // 1 token over → grant capped + one $3 overage block.
  const just = creditStatus("starter", 1_500_001);
  expect(just.usedCents).toBe(1500); // capped at the grant
  expect(just.remainingCents).toBe(0);
  expect(just.overTokens).toBe(1);
  expect(just.overageBlocks).toBe(1);
  expect(just.overageCents).toBe(300);

  // 100,001 over → two $3 blocks.
  const deep = creditStatus("starter", 1_600_001);
  expect(deep.overTokens).toBe(100_001);
  expect(deep.overageBlocks).toBe(2);
  expect(deep.overageCents).toBe(600);

  // Enterprise: unlimited grant, never overage.
  const ent = creditStatus("enterprise", 9_000_000);
  expect(ent.grantedCents).toBe(null);
  expect(ent.remainingCents).toBe(null);
  expect(ent.allowanceTokens).toBe(null);
  expect(ent.overageCents).toBe(0);
});

// --- Our cost (COGS) ---------------------------------------------------------

test("estimateCostCents — Haiku rates in cents", () => {
  // 1M input @ $1 + 1M output @ $5 = $6.00 → 600¢.
  expect(estimateCostCents("claude-haiku-4-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  })).toBeCloseTo(600, 5);
  // Cache reads are cheap ($0.10/1M): 1M read = 10¢.
  expect(estimateCostCents("claude-haiku-4-5", {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
  })).toBeCloseTo(10, 5);
  // Unknown model falls back to the default rates (no throw).
  expect(estimateCostCents("some-future-model", {
    inputTokens: 1_000_000,
    outputTokens: 0,
  })).toBeCloseTo(100, 5);
});

// --- Integration: metering + surfaced balance --------------------------------

const provisionArgs = (name: string, slug: string, prefix: string) => ({
  name,
  slug,
  embedKeyPrefix: prefix,
  embedKeyHash: "h",
  embedKey: `ek_${prefix}.x`,
});

test("recordUsage accumulates tokens onto the conversation + account counter", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "cred@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    ...provisionArgs("Credly", "credly", "aaaaaa"),
    tier: "starter",
  });

  // Open a conversation, then meter two turns of token usage against it.
  await t.mutation(internal.conversations.record, {
    businessId,
    conversationKey: "sess-1",
  });
  await t.mutation(internal.conversations.recordUsage, {
    businessId,
    conversationKey: "sess-1",
    model: "claude-haiku-4-5",
    inputTokens: 400_000,
    outputTokens: 100_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 50_000,
  });
  await t.mutation(internal.conversations.recordUsage, {
    businessId,
    conversationKey: "sess-1",
    model: "claude-haiku-4-5",
    inputTokens: 100_000,
    outputTokens: 50_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
  });

  // Conversation row accumulates billable + cache tokens and a positive cost.
  const conv = await t.run((ctx) =>
    ctx.db
      .query("conversations")
      .withIndex("by_business_key", (q) =>
        q.eq("businessId", businessId).eq("conversationKey", "sess-1"),
      )
      .unique(),
  );
  expect(conv?.inputTokens).toBe(500_000);
  expect(conv?.outputTokens).toBe(150_000);
  expect(conv?.cacheReadTokens).toBe(3_000_000);
  expect((conv?.costCents ?? 0) > 0).toBe(true);

  // planUsage surfaces the credit balance: 650K billable tokens = $6.50 of $15.
  const usage = await as.query(api.tiers.planUsage, { slug: "credly" });
  expect(usage.aiCredits.usedTokens).toBe(650_000);
  expect(usage.aiCredits.grantedCents).toBe(1500);
  expect(usage.aiCredits.usedCents).toBe(650);
  expect(usage.aiCredits.remainingCents).toBe(850);
  expect(usage.aiCredits.overageCents).toBe(0);
  // Conversation count is retained as an activity metric.
  expect(usage.aiCredits.conversations).toBe(1);

  // myAccount exposes the same credit block for the billing view.
  const account = await as.query(api.accounts.myAccount, {});
  expect(account?.billing.aiCredits.usedCents).toBe(650);
  expect(account?.billing.aiCredits.remainingCents).toBe(850);
});

test("platform costMargin — per-tenant revenue, cost, and margin", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "cogs@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    ...provisionArgs("Cogs", "cogs", "cccccc"),
    tier: "starter",
  });

  // Meter a turn: 1M in + 0.5M out (billable 1.5M = exactly the Starter grant),
  // plus 2M cheap cache reads. Our cost = $1 + $2.50 + $0.20 = $3.70 → 370¢.
  await t.mutation(internal.conversations.record, {
    businessId,
    conversationKey: "s1",
  });
  await t.mutation(internal.conversations.recordUsage, {
    businessId,
    conversationKey: "s1",
    model: "claude-haiku-4-5",
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 0,
  });

  // The caller must be a platform operator to read cross-tenant COGS.
  await t.run((ctx) =>
    ctx.db.insert("platformAdmins", {
      userId: owner,
      role: "superadmin",
      createdAt: 0,
    }),
  );

  const data = await as.query(api.platform.costMargin, {});
  const row = data.rows.find((r) => r._id === businessId)!;
  expect(row.billableTokens).toBe(1_500_000);
  expect(row.revenueCents).toBe(1500); // full Starter grant consumed
  expect(row.ourCostCents).toBe(370);
  expect(row.marginCents).toBe(1130);
  expect(row.overageCents).toBe(0);

  expect(data.totals.revenueCents).toBe(1500);
  expect(data.totals.ourCostCents).toBe(370);
  expect(data.totals.marginCents).toBe(1130);
});

test("widget no longer hard-blocks; safety valve only trips far past allowance", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "safe@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    ...provisionArgs("Safe", "safe", "bbbbbb"),
    tier: "starter", // 1.5M-token allowance
  });
  const accountId = (await t.run((ctx) => ctx.db.get(businessId)))!.accountId!;
  const period = new Date().toISOString().slice(0, 7);

  // Just past the allowance → NOT blocked (usage keeps working, accrues overage).
  await t.run((ctx) =>
    ctx.db.insert("usageCounters", {
      accountId,
      period,
      conversations: 0,
      aiInputTokens: 1_400_000,
      aiOutputTokens: 300_000, // 1.7M total, over the 1.5M allowance
    }),
  );
  let status = await t.query(internal.tiers.creditSafetyStatus, {
    businessId,
    period,
  });
  expect(status.blocked).toBe(false);

  // Runaway usage (> 10× the allowance) trips the safety valve.
  const counterId = (await t.run((ctx) =>
    ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", accountId).eq("period", period),
      )
      .unique(),
  ))!._id;
  await t.run((ctx) =>
    ctx.db.patch(counterId, { aiInputTokens: 16_000_000 }), // 16.3M ≫ 15M (10×)
  );
  status = await t.query(internal.tiers.creditSafetyStatus, {
    businessId,
    period,
  });
  expect(status.blocked).toBe(true);
});
