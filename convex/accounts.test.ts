/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const provisionArgs = (name: string, slug: string, prefix: string) => ({
  name,
  slug,
  embedKeyPrefix: prefix,
  embedKeyHash: `hash-${prefix}`,
  embedKey: `ek_${prefix}.x`,
});

// One account owns exactly one business — a second is rejected (locations, not
// projects, are the scalable unit).
test("one business per account — a second is rejected", async () => {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@x.com" }),
  );
  const asUser = t.withIdentity({ subject: `${user}|s` });

  // First business — allowed; creates the (Starter) account.
  await asUser.mutation(internal.businesses.provision, {
    ...provisionArgs("One", "proj-one", "aaaaaa"),
    tier: "starter",
  });

  // A second business on the same account — blocked.
  await expect(
    asUser.mutation(internal.businesses.provision, {
      ...provisionArgs("Two", "proj-two", "bbbbbb"),
      tier: "starter",
    }),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });

  const acct = await asUser.query(api.accounts.myAccount, {});
  expect(acct?.plan).toBe("starter");
  expect(acct?.projects).toEqual({ used: 1, max: 1 });
});

// Usage is pooled on the account counter and read back through the business.
test("pooled usage — conversations meter the account counter", async () => {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: "pro@x.com" }),
  );
  const asUser = t.withIdentity({ subject: `${user}|s` });

  const b1 = await asUser.mutation(internal.businesses.provision, {
    ...provisionArgs("Alpha", "alpha", "cccccc"),
    tier: "professional",
  });

  // Three conversations → the account's pooled counter reads 3.
  for (const key of ["k1", "k2", "k3"]) {
    await t.mutation(internal.conversations.record, {
      businessId: b1,
      conversationKey: key,
    });
  }

  const acct = await asUser.query(api.accounts.myAccount, {});
  expect(acct?.usage.conversations.used).toBe(3);
  // Conversations are now an uncapped activity metric (AI usage is governed by
  // the credit balance), so there is no conversation cap.
  expect(acct?.usage.conversations.cap).toBe(null);

  // The runaway safety valve stays open under normal usage.
  const period = new Date().toISOString().slice(0, 7);
  const { blocked } = await t.query(internal.tiers.creditSafetyStatus, {
    businessId: b1,
    period,
  });
  expect(blocked).toBe(false);
});

// The migration attaches pre-account data to a freshly created account and
// folds its per-business usage into the account pool.
test("backfill — legacy businesses gain an account and pooled counters", async () => {
  const t = convexTest(schema, modules);

  const { user, businessId } = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { email: "legacy@x.com" });
    // A pre-account business: no accountId, legacy per-business tier.
    const businessId = await ctx.db.insert("businesses", {
      slug: "legacy",
      name: "Legacy Co",
      status: "draft",
      tier: "professional",
      domains: [],
      embedKeyPrefix: "eeeeee",
      embedKeyHash: "h",
      embedKey: "ek_eeeeee.x",
      branding: {
        primaryColor: "#FF5C1A",
        accentColor: "#FFB347",
        position: "right" as const,
        assistantName: "Assistant",
        welcomeMsg: "Hi",
        tone: "friendly",
      },
      aiSettings: { persona: "helpful" },
    });
    await ctx.db.insert("memberships", {
      userId: user,
      businessId,
      role: "owner" as const,
    });
    // Legacy per-business usage counter.
    await ctx.db.insert("usageCounters", {
      businessId,
      period: "2026-07",
      conversations: 5,
      email: 2,
    });
    return { user, businessId };
  });

  const result = await t.mutation(internal.accounts.backfillAccounts, {});
  expect(result.accountsCreated).toBe(1);
  expect(result.businessesLinked).toBe(1);

  await t.run(async (ctx) => {
    const business = await ctx.db.get(businessId);
    expect(business?.accountId).toBeTruthy();

    const account = await ctx.db.get(business!.accountId!);
    expect(account?.plan).toBe("professional");
    expect(account?.ownerUserId).toBe(user);

    // The counter is re-keyed onto the account (businessId dropped).
    const counters = await ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", account!._id).eq("period", "2026-07"),
      )
      .collect();
    expect(counters).toHaveLength(1);
    expect(counters[0].conversations).toBe(5);
    expect(counters[0].email).toBe(2);
    expect(counters[0].businessId).toBeUndefined();
  });

  // Idempotent: a second run changes nothing.
  const again = await t.mutation(internal.accounts.backfillAccounts, {});
  expect(again).toEqual({
    accountsCreated: 0,
    businessesLinked: 0,
    countersRekeyed: 0,
  });
});
