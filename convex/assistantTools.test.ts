/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "owner@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  const business = await t.run((ctx) =>
    ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "clip")).unique(),
  );
  await as.mutation(api.services.add, {
    slug: "clip",
    name: "Color",
    durationMinutes: 90,
    priceCents: 12000,
  });
  return { t, as, businessId: business!._id as Id<"businesses"> };
}

const call = (
  t: Awaited<ReturnType<typeof convexTest>>,
  businessId: Id<"businesses">,
  name: string,
  input: Record<string, unknown>,
) =>
  t.action(internal.assistantTools.execute, {
    businessId,
    timezone: "UTC",
    nowMs: Date.now(),
    capabilities: ["availability", "booking", "qualification"],
    name,
    input,
  });

function futureSlot(): number {
  const d = new Date();
  d.setUTCHours(9, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.getTime();
}

test("tool list_services — formats the menu", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "list_services", {});
  expect(result).toContain("Color");
  expect(result).toContain("90 min");
  expect(result).toContain("$120.00");
});

test("tool check_availability — unknown service is reported, not invented", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "check_availability", {
    serviceName: "Spaceflight",
  });
  expect(result.toLowerCase()).toContain("couldn't find");
});

test("tool check_availability — no scheduler connected → can't check", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "check_availability", {
    serviceName: "Color",
  });
  expect(result.toLowerCase()).toContain("can't check");
});

test("tool book_appointment — refuses without name + email", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "book_appointment", {
    startMs: futureSlot(),
    serviceName: "Color",
  });
  expect(result.toLowerCase()).toContain("need");
});

/** Names of functions currently on the scheduler queue. */
async function scheduledNames(
  t: Awaited<ReturnType<typeof convexTest>>,
): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.map((r) => r.name);
}

test("tool book_appointment — no scheduler connected → hands off + routes the contact", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "book_appointment", {
    startMs: futureSlot(),
    serviceName: "Color",
    customerName: "Web Visitor",
    customerEmail: "visitor@x.com",
  });
  expect(result.toLowerCase()).toContain("passed your details");
  // No CRM connected → the contact is routed to the fallback email.
  expect((await scheduledNames(t)).some((n) => n.includes("sendLeadFallback"))).toBe(true);
});

test("tool capture_lead — captures an assistant-sourced contact", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "capture_lead", {
    name: "Curious",
    email: "curious@x.com",
    message: "pricing?",
  });
  expect(result.toLowerCase()).toContain("passed your details");
  expect((await scheduledNames(t)).some((n) => n.includes("sendLeadFallback"))).toBe(true);
});
