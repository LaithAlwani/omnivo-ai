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

/** Remove the default seeded staff so the tenant has no native booking. */
async function removeStaff(t: TestConvex<typeof schema>, businessId: Id<"businesses">) {
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  });
}

const plan = (t: TestConvex<typeof schema>, businessId: Id<"businesses">) =>
  t.action(internal.agentPlan.capabilityPlan, { businessId });

// A flag alone is not enough — with no booking connection, booking tools are
// simply absent (FAQ-only), not present-and-failing.
test("no connection → booking tools absent (FAQ-only)", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t);
  await removeStaff(t, businessId); // no native booking, no webhook

  const p = await plan(t, businessId);
  expect(p.toolNames.sort()).toEqual(["capture_lead", "list_services"]);
  expect(p.bookingSystem).toBe(null);
  expect(p.capabilities).not.toContain("availability");
  expect(p.capabilities).not.toContain("booking");
});

// The native (Managed) engine counts as a connection once a bookable staff
// exists — appears with no code change, just data.
test("native bookable staff → full booking tools", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await tenant(t); // provision seeds a bookable "Main" staff

  const p = await plan(t, businessId);
  expect(p.toolNames).toContain("check_availability");
  expect(p.toolNames).toContain("book_appointment");
  expect(p.bookingSystem).toBe("native");
});

// Connecting a full webhook provider makes booking tools appear (no redeploy),
// and it's reported as the external system.
test("full webhook connection → external booking tools", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);
  await removeStaff(t, businessId);

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

// A read-only provider (availability endpoint only) exposes check_availability
// but NEVER the write tool.
test("read-only webhook → availability tool only, no write tool", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await tenant(t);
  await removeStaff(t, businessId);

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
