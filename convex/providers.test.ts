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

// The Phase A structural acceptance: a connected provider drives an
// agent-invocable capability end-to-end, with NO native code on the path.
test("webhook booking provider handles availability + booking; native untouched", async () => {
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

  // No native booking row was written — the provider owned the whole path.
  const rows = await t.run((ctx) => ctx.db.query("bookings").collect());
  expect(rows).toHaveLength(0);

  // Both webhook endpoints were actually hit.
  expect(calls.some((c) => c.includes("/avail"))).toBe(true);
  expect(
    calls.some((c) => c.startsWith("POST") && c.includes("/book")),
  ).toBe(true);
});

// With no provider connected, the resolver routes to the native engine and
// never touches a vendor endpoint. (Successful native booking end-to-end is
// covered by the wider suite, e.g. locations.test.ts.)
test("native fallback: no provider → native engine, no webhook IO", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  const soon = Date.now() + 2 * 86_400_000;

  const fetchSpy = vi.fn(async () => {
    throw new Error("no external call should happen on the native path");
  });
  vi.stubGlobal("fetch", fetchSpy);

  const res = await t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: ["availability", "booking"],
    name: "book_appointment",
    input: { startMs: soon, customerName: "Ada", customerEmail: "ada@x.com" },
  });

  // The native engine answered (it validates against real availability); a
  // vendor endpoint was never called.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(res.result.length).toBeGreaterThan(0);
});
