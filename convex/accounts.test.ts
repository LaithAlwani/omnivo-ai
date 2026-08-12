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
