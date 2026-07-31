/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { generateEmbedKey } from "./lib/keys";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "o@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  const { key, prefix, hash } = await generateEmbedKey();
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: prefix,
    embedKeyHash: hash,
    embedKey: key,
  });
  // Seed a couple of child rows beyond what provision creates (staff, location,
  // tenantFeatures).
  await t.run(async (ctx) => {
    await ctx.db.insert("leads", {
      businessId,
      name: "Lead",
      status: "new",
      source: "widget",
      updatedAt: 0,
    });
    await ctx.db.insert("conversations", {
      businessId,
      conversationKey: "k1",
      messageCount: 2,
      lastMessageAt: 0,
    });
  });
  return { t, as, businessId };
}

const childCount = async (
  t: Awaited<ReturnType<typeof setup>>["t"],
  businessId: Awaited<ReturnType<typeof setup>>["businessId"],
) =>
  await t.run(async (ctx) => {
    const tables = [
      "leads",
      "conversations",
      "staff",
      "locations",
      "tenantFeatures",
      "memberships",
    ] as const;
    let total = 0;
    for (const table of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect();
      total += rows.length;
    }
    return total;
  });

test("owner deletion removes the business and cascades all its data", async () => {
  const { t, as, businessId } = await setup();

  // Provisioning + seeds gave us child rows across several tables.
  expect(await childCount(t, businessId)).toBeGreaterThan(0);
  expect(await t.run((ctx) => ctx.db.get(businessId))).not.toBeNull();

  await as.mutation(api.businesses.deleteBusiness, { slug: "clip" });

  // The business row and memberships are gone synchronously.
  expect(await t.run((ctx) => ctx.db.get(businessId))).toBeNull();

  // deleteBusiness scheduled the batched purge; run it directly to drain the
  // remaining child rows deterministically (one batch clears this small tenant).
  await t.mutation(internal.businesses.purgeBusinessData, { businessId });
  expect(await childCount(t, businessId)).toBe(0);

  // The account survives (it's the subscription) — its project slot is freed.
  const account = await as.query(api.accounts.myAccount);
  expect(account?.projects.used).toBe(0);
});

test("a non-owner cannot delete the business", async () => {
  const { t, businessId } = await setup();

  // A second user added as an admin (not owner).
  const admin = await t.run((ctx) => ctx.db.insert("users", { email: "a@x.com" }));
  await t.run((ctx) =>
    ctx.db.insert("memberships", { userId: admin, businessId, role: "admin" }),
  );
  const asAdmin = t.withIdentity({ subject: `${admin}|s` });

  await expect(
    asAdmin.mutation(api.businesses.deleteBusiness, { slug: "clip" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // Still there.
  expect(await t.run((ctx) => ctx.db.get(businessId))).not.toBeNull();
});
