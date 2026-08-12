/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

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
    tier: "premium", // bundles booking + leadQualification + integrations
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { as, businessId };
}

const plan = (t: TestConvex<typeof schema>, businessId: Id<"businesses">) =>
  t.action(internal.agentPlan.capabilityPlan, { businessId });

// A flag alone is not enough — with no booking connection, booking tools are
// simply absent (FAQ-only), not present-and-failing.
test("no connection → booking tools absent (FAQ-only)", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t); // no scheduler connected

  const p = await plan(t, businessId);
  expect(p.toolNames.sort()).toEqual(["capture_lead", "list_services"]);
  expect(p.bookingSystem).toBe(null);
  expect(p.capabilities).not.toContain("availability");
  expect(p.capabilities).not.toContain("booking");
});

// Connecting a full webhook provider makes booking tools appear (no redeploy),
// and it's reported as the external system.
test("full webhook connection → external booking tools", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);

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

  const p = await plan(t, businessId);
  expect(p.toolNames).toContain("check_availability");
  expect(p.toolNames).toContain("book_appointment");
  expect(p.bookingSystem).toBe("external");
});

// A named adapter (Cal.com) is a full provider — booking tools appear from a
// key + event-type id, no code change beyond the adapter itself.
test("cal.com connection → full booking tools (external)", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  await t.run((ctx) =>
    ctx.db.insert("integrations", {
      businessId,
      kind: "booking" as const,
      provider: "calcom" as const,
      config: { eventTypeId: 123 },
      secretEnc: "enc",
      active: true,
      verified: false,
    }),
  );

  const p = await plan(t, businessId);
  expect(p.toolNames).toContain("check_availability");
  expect(p.toolNames).toContain("book_appointment");
  expect(p.bookingSystem).toBe("external");
});

// A "link" provider isn't tool-capable — no booking tools, but the scheduling
// link is surfaced so the agent hands it off.
test("booking link → hand-off link surfaced, no booking tools", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  await t.run((ctx) =>
    ctx.db.insert("integrations", {
      businessId,
      kind: "booking" as const,
      provider: "link" as const,
      config: { schedulingLink: "https://calendly.com/acme" },
      active: true,
      verified: false,
    }),
  );

  const p = await plan(t, businessId);
  expect(p.toolNames).not.toContain("book_appointment");
  expect(p.toolNames).not.toContain("check_availability");
  expect(p.bookingLink).toBe("https://calendly.com/acme");
});

// A read-only provider (availability endpoint only) exposes check_availability
// but NEVER the write tool.
test("read-only webhook → availability tool only, no write tool", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);

  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "booking",
    provider: "webhook",
    config: { availabilityUrl: "https://api.example.com/avail" }, // no bookingUrl
    active: true,
  });

  const p = await plan(t, businessId);
  expect(p.toolNames).toContain("check_availability");
  expect(p.toolNames).not.toContain("book_appointment");
  expect(p.capabilities).toContain("availability");
  expect(p.capabilities).not.toContain("booking");
});

/** Mark a business's integration of a given kind degraded (health cron effect). */
async function degrade(
  t: TestConvex<typeof schema>,
  businessId: Id<"businesses">,
  kind: "booking" | "crmInbound",
) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_business_kind", (q) =>
        q.eq("businessId", businessId).eq("kind", kind),
      )
      .first();
    if (row) await ctx.db.patch(row._id, { health: "degraded", failureStreak: 3 });
  });
}

// A degraded booking connection drops booking entirely (hand-off) — the agent
// captures a lead instead.
test("degraded booking webhook → booking tools dropped", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);

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
  // Healthy first → booking present.
  expect((await plan(t, businessId)).toolNames).toContain("book_appointment");

  await degrade(t, businessId, "booking");
  const p = await plan(t, businessId);
  expect(p.toolNames).not.toContain("check_availability");
  expect(p.toolNames).not.toContain("book_appointment"); // no native fallback
  expect(p.bookingSystem).toBe(null);
});

// A degraded inbound CRM drops the lookup tool.
test("degraded inbound CRM → lookup dropped", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);
  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "crmInbound",
    provider: "webhook",
    config: { url: "https://api.example.com/lookup" },
    active: true,
  });
  expect((await plan(t, businessId)).toolNames).toContain("lookup_customer");

  await degrade(t, businessId, "crmInbound");
  expect((await plan(t, businessId)).toolNames).not.toContain("lookup_customer");
});

// Lookup is granted only by a live inbound CRM connection.
test("inbound CRM connection → lookup tool appears", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);

  let p = await plan(t, businessId);
  expect(p.toolNames).not.toContain("lookup_customer");

  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "crmInbound",
    provider: "webhook",
    config: { url: "https://api.example.com/lookup" },
    active: true,
  });

  p = await plan(t, businessId);
  expect(p.toolNames).toContain("lookup_customer");
});
