/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  availabilityRequest,
  parseSlots,
  bookingPayload,
} from "./lib/providers/webhook";

const modules = import.meta.glob("./**/*.ts");

async function project(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter", // Integrations is off on Starter — the module gate is testable
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { as, businessId };
}

// Pure booking-provider adapter logic (generic webhook).
test("booking provider — availability request + slot parsing", () => {
  const url = availabilityRequest(
    { availabilityUrl: "https://api.example.com/slots" },
    { fromMs: 1000, days: 7, serviceName: "Color", locationName: "Downtown" },
  );
  expect(url).toContain("from=1000");
  expect(url).toContain("days=7");
  expect(url).toContain("service=Color");
  expect(url).toContain("location=Downtown");

  // Accepts ms numbers, ISO strings, and a { slots: [...] } envelope.
  expect(parseSlots([{ start: 3000 }, { start: 1000 }])).toEqual([
    { start: 1000 },
    { start: 3000 },
  ]);
  const iso = parseSlots({ slots: [{ start: "2026-07-01T09:00:00Z" }] });
  expect(iso[0].start).toBe(Date.parse("2026-07-01T09:00:00Z"));

  const payload = bookingPayload({
    startMs: 1000,
    customerName: "A",
    customerEmail: "a@x.com",
  });
  expect(payload.start).toBe(1000);
  expect((payload.customer as { email: string }).email).toBe("a@x.com");
});

// Save is gated on the Integrations module; the tool is gated on an active
// inbound source.
test("integrations — save requires the module; inbound gates the lookup tool", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await project(t);

  // Connections are base, so turn the module OFF to prove save is gated on it.
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "integrations",
    enabled: false,
  });
  await expect(
    as.action(api.integrationsNode.save, {
      slug: "clip",
      kind: "crmInbound",
      provider: "webhook",
      config: { url: "https://api.example.com/lookup" },
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // No inbound source yet.
  expect(
    await t.query(internal.integrations.hasActiveInbound, { businessId }),
  ).toBe(false);

  // Re-enable the module, then save an inbound source.
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "integrations",
    enabled: true,
  });
  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "crmInbound",
    provider: "webhook",
    config: { url: "https://api.example.com/lookup" },
    active: true,
  });

  expect(
    await t.query(internal.integrations.hasActiveInbound, { businessId }),
  ).toBe(true);

  // The saved connection is listed (never leaking the secret).
  const list = await as.query(api.integrations.list, { slug: "clip" });
  expect(list.enabled).toBe(true);
  expect(list.integrations).toHaveLength(1);
  expect(list.integrations[0].kind).toBe("crmInbound");
});

// Outbound dispatch is a no-op when no target is configured (doesn't throw).
test("integrations — dispatch with no targets is a safe no-op", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await project(t);
  await expect(
    t.action(internal.integrationsNode.dispatch, {
      businessId,
      event: { type: "lead.created", data: { name: "X" } },
    }),
  ).resolves.toBeNull();
});

/** Names of functions currently on the scheduler queue (runAfter targets). */
async function scheduledNames(t: TestConvex<typeof schema>): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.map((r) => r.name);
}

// No CRM connected → the captured lead is emailed to the owner as a fallback.
test("lead capture — no CRM connected emails the owner the lead", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await project(t);

  await t.mutation(internal.leads.captureForBusiness, {
    businessId,
    source: "assistant",
    name: "Dana Lead",
    email: "dana@x.com",
  });

  const names = await scheduledNames(t);
  expect(names.some((n) => n.includes("sendLeadFallback"))).toBe(true);
  expect(names.some((n) => n.includes("dispatch"))).toBe(false);
});

// An active outbound CRM → dispatch to it, no fallback email (no double-send).
test("lead capture — connected CRM dispatches, no fallback email", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await project(t);
  await t.run((ctx) =>
    ctx.db.insert("integrations", {
      businessId,
      kind: "crmOutbound" as const,
      provider: "webhook" as const,
      config: { url: "https://crm.example/hook" },
      active: true,
      verified: false,
    }),
  );

  await t.mutation(internal.leads.captureForBusiness, {
    businessId,
    source: "assistant",
    name: "Dana Lead",
    email: "dana@x.com",
  });

  const names = await scheduledNames(t);
  expect(names.some((n) => n.includes("dispatch"))).toBe(true);
  expect(names.some((n) => n.includes("sendLeadFallback"))).toBe(false);
});
