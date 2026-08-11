/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllGlobals());

async function tenant(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "premium",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { as, businessId, ownerEmail: "owner@x.com" };
}

async function bookingIntegration(
  t: TestConvex<typeof schema>,
  businessId: Id<"businesses">,
) {
  return await t.run((ctx) =>
    ctx.db.insert("integrations", {
      businessId,
      kind: "booking",
      provider: "webhook",
      config: { availabilityUrl: "https://api.example.com/avail" },
      active: true,
      verified: true,
    }),
  );
}

test("recordCheck degrades after 3 consecutive failures, resets on success", async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerEmail } = await tenant(t);
  const integrationId = await bookingIntegration(t, businessId);

  const rec = (ok: boolean) =>
    t.mutation(internal.health.recordCheck, { integrationId, ok, latencyMs: 5 });

  expect((await rec(false)).transitionedToDegraded).toBe(false); // streak 1
  expect((await rec(false)).transitionedToDegraded).toBe(false); // streak 2
  const third = await rec(false); // streak 3 → degraded
  expect(third.transitionedToDegraded).toBe(true);
  expect(third.ownerEmail).toBe(ownerEmail);
  expect(third.kind).toBe("booking");

  let row = (await t.run((ctx) => ctx.db.get(integrationId)))!;
  expect(row.health).toBe("degraded");
  expect(row.failureStreak).toBe(3);

  // A single success resets both the streak and the health.
  const recovered = await rec(true);
  expect(recovered.transitionedToDegraded).toBe(false);
  row = (await t.run((ctx) => ctx.db.get(integrationId)))!;
  expect(row.health).toBe("healthy");
  expect(row.failureStreak).toBe(0);

  // Every probe left a check row (audit trail).
  const checks = await t.run((ctx) =>
    ctx.db.query("connectionChecks").collect(),
  );
  expect(checks).toHaveLength(4);
});

test("recordCheck reports the degrade transition only once", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  const integrationId = await bookingIntegration(t, businessId);
  const rec = (ok: boolean) =>
    t.mutation(internal.health.recordCheck, { integrationId, ok, latencyMs: 1 });

  await rec(false);
  await rec(false);
  expect((await rec(false)).transitionedToDegraded).toBe(true);
  // Still failing, already degraded → no repeat alert.
  expect((await rec(false)).transitionedToDegraded).toBe(false);
});

test("probeConnection pings the endpoint and records the result", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  const integrationId = await bookingIntegration(t, businessId);

  // Dead endpoint: fetch throws.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }),
  );
  await t.action(internal.integrationsNode.probeConnection, { integrationId });

  const checks = await t.run((ctx) =>
    ctx.db.query("connectionChecks").collect(),
  );
  expect(checks).toHaveLength(1);
  expect(checks[0].ok).toBe(false);
  const row = (await t.run((ctx) => ctx.db.get(integrationId)))!;
  expect(row.failureStreak).toBe(1);
});
