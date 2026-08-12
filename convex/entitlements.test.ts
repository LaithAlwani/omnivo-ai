/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  capabilitiesFor,
  toolsFor,
  DEFAULT_ENTITLEMENTS,
} from "./modules/registry";
import { entitlementsForPlan } from "./lib/tiers";

const modules = import.meta.glob("./**/*.ts");

async function project(t: ReturnType<typeof convexTest>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "professional",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { t, as, businessId };
}

// Tools = module permission ∩ live connection. A flag alone is not enough.
const NO_CONNS = { bookingRead: false, bookingWrite: false, lookup: false };
const FULL_BOOKING = { bookingRead: true, bookingWrite: true, lookup: false };

test("capability assembly — booking needs BOTH the flag and a connection", () => {
  // Nothing enabled → only the core tools (list_services, capture_lead,
  // request_contact).
  const none = toolsFor(
    capabilitiesFor(DEFAULT_ENTITLEMENTS, NO_CONNS),
  ).map((t) => t.name);
  expect(none.sort()).toEqual([
    "capture_lead",
    "list_services",
    "request_contact",
  ]);

  // Booking flag on but NO connection → still no booking tools.
  const flagOnly = toolsFor(
    capabilitiesFor({ ...DEFAULT_ENTITLEMENTS, bookingEnabled: true }, NO_CONNS),
  ).map((t) => t.name);
  expect(flagOnly).not.toContain("check_availability");
  expect(flagOnly).not.toContain("book_appointment");

  // Flag on AND a full booking connection → both booking tools appear.
  const booking = toolsFor(
    capabilitiesFor(
      { ...DEFAULT_ENTITLEMENTS, bookingEnabled: true },
      FULL_BOOKING,
    ),
  ).map((t) => t.name);
  expect(booking).toContain("check_availability");
  expect(booking).toContain("book_appointment");

  // Read-only connection → availability only, never the write tool.
  const readOnly = toolsFor(
    capabilitiesFor(
      { ...DEFAULT_ENTITLEMENTS, bookingEnabled: true },
      { bookingRead: true, bookingWrite: false, lookup: false },
    ),
  ).map((t) => t.name);
  expect(readOnly).toContain("check_availability");
  expect(readOnly).not.toContain("book_appointment");

  // Lead qualification is flag-only (native), no connection needed.
  const qual = capabilitiesFor(
    { ...DEFAULT_ENTITLEMENTS, leadQualificationEnabled: true },
    NO_CONNS,
  );
  expect(qual.has("qualification")).toBe(true);
  expect(qual.has("booking")).toBe(false);
});

// New businesses are seeded with exactly their plan's module bundle.
test("provision seeds entitlements from the plan bundle", async () => {
  const t = convexTest(schema, modules);
  const { as } = await project(t); // Professional
  const e = await as.query(api.entitlements.get, { slug: "clip" });
  // Professional bundles Booking + Lead Capture + Integrations.
  expect(e.bookingEnabled).toBe(true);
  expect(e.leadQualificationEnabled).toBe(true);
  expect(e.integrationsEnabled).toBe(true);
});

// The plan → module bundle mapping (pure).
test("entitlementsForPlan — bundles per tier", () => {
  const starter = entitlementsForPlan("starter");
  expect(starter.bookingEnabled).toBe(true);
  expect(starter.leadQualificationEnabled).toBe(true);
  expect(starter.integrationsEnabled).toBe(true); // Connections are base now

  const premium = entitlementsForPlan("premium");
  expect(
    Object.values(premium).every((v) => v === true),
  ).toBe(true); // all modules
});

// Toggling a module off removes the tool at execution time (defense in depth):
// the executor re-checks the capability even if the model calls the tool.
test("execution re-checks entitlement — booking refused when the module is off", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await project(t);

  // Disable booking for this project.
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "booking",
    enabled: false,
  });

  // The orchestrator would no longer offer the tool; if the model calls it
  // anyway (capabilities empty of "booking"), the executor refuses.
  const { result } = await t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: [], // no booking capability
    name: "book_appointment",
    input: {
      startMs: Date.now() + 86_400_000,
      customerName: "X",
      customerEmail: "x@x.com",
    },
  });
  expect(result.toLowerCase()).toContain("isn't something i can do");
});
