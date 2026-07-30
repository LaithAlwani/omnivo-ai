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

// The registry assembles the model's tools from the union of enabled modules.
test("capability assembly — booking tools appear only when a granting module is on", () => {
  // Nothing enabled → only the core tools (list_services, capture_lead).
  const none = toolsFor(capabilitiesFor(DEFAULT_ENTITLEMENTS)).map((t) => t.name);
  expect(none.sort()).toEqual(["capture_lead", "list_services"]);

  // Booking module → adds the availability + booking tools.
  const booking = toolsFor(
    capabilitiesFor({ ...DEFAULT_ENTITLEMENTS, bookingEnabled: true }),
  ).map((t) => t.name);
  expect(booking).toContain("check_availability");
  expect(booking).toContain("book_appointment");

  // Sales Assistant is self-contained: it grants booking without the add-on.
  const sales = capabilitiesFor({
    ...DEFAULT_ENTITLEMENTS,
    salesAssistantEnabled: true,
  });
  expect(sales.has("booking")).toBe(true);
  expect(sales.has("qualification")).toBe(true);
});

// New projects are seeded with Booking + Lead Qualification (widget parity).
test("provision seeds default entitlements", async () => {
  const t = convexTest(schema, modules);
  const { as } = await project(t);
  const e = await as.query(api.entitlements.get, { slug: "clip" });
  expect(e.bookingEnabled).toBe(true);
  expect(e.leadQualificationEnabled).toBe(true);
  expect(e.reviewManagementEnabled).toBe(false);
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

  // No booking was created.
  const rows = await t.run((ctx) => ctx.db.query("bookings").collect());
  expect(rows).toHaveLength(0);
});
