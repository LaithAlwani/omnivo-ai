/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllGlobals());

async function tenant(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "premium", // Premium bundles Integrations
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { as, businessId };
}

// A connected provider drives the booking capability end-to-end — it's the
// only booking path (there is no native engine).
test("webhook booking provider handles availability + booking", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);

  const soon = Date.now() + 2 * 86_400_000;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const json =
        method === "GET" ? [{ start: soon }] : { ok: true };
      return { ok: true, status: 200, json: async () => json } as Response;
    }),
  );

  // Self-serve connection: a generic webhook provider (no Omnivo-held secret).
  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "booking",
    provider: "webhook",
    config: {
      availabilityUrl: "https://api.example.com/avail",
      bookingUrl: "https://api.example.com/book",
    },
    active: true,
  });

  // check_availability → the provider's slot surfaces.
  const avail = await t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: ["availability", "booking"],
    name: "check_availability",
    input: {},
  });
  expect(avail.result).toContain(String(soon));

  // book_appointment → booked through the provider.
  const booked = await t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: ["availability", "booking"],
    name: "book_appointment",
    input: { startMs: soon, customerName: "Ada", customerEmail: "ada@x.com" },
  });
  expect(booked.result.toLowerCase()).toContain("booked");

  // Both webhook endpoints were actually hit.
  expect(calls.some((c) => c.includes("/avail"))).toBe(true);
  expect(
    calls.some((c) => c.startsWith("POST") && c.includes("/book")),
  ).toBe(true);
});

// With no scheduler connected, booking isn't possible — the agent captures the
// lead and hands off instead of booking.
test("no provider connected → book_appointment hands off + captures a lead", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  const soon = Date.now() + 2 * 86_400_000;

  const res = await t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: ["availability", "booking"],
    name: "book_appointment",
    input: { startMs: soon, customerName: "Ada", customerEmail: "ada@x.com" },
  });

  // Hand-off message, and the details landed as a lead for the team.
  expect(res.result.toLowerCase()).toContain("passed your details");
  const leads = await t.run((ctx) => ctx.db.query("leads").collect());
  expect(leads).toHaveLength(1);
  expect(leads[0].name).toBe("Ada");
});
