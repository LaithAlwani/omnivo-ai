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
  const staffId = (await t.run((ctx) =>
    ctx.db.query("staff").withIndex("by_business", (q) => q.eq("businessId", business!._id)).unique(),
  ))!._id;
  await as.mutation(api.availability.update, {
    slug: "clip",
    staffId,
    availability: {
      timezone: "UTC",
      slotMinutes: 30,
      week: Array.from({ length: 7 }, () => ({ intervals: [{ start: 540, end: 1020 }] })),
    },
  });
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
    name,
    input,
  });

// A valid upcoming slot: 09:00 UTC three days out, aligned to the 30-min step.
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

test("tool check_availability — returns bookable startMs values", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "check_availability", {
    serviceName: "Color",
    daysAhead: 7,
  });
  expect(result).toContain("startMs:");
});

test("tool check_availability — unknown service is reported, not invented", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "check_availability", {
    serviceName: "Spaceflight",
  });
  expect(result.toLowerCase()).toContain("couldn't find");
});

test("tool book_appointment — books and tags the source assistant", async () => {
  const { t, businessId } = await setup();
  const start = futureSlot();
  const { result } = await call(t, businessId, "book_appointment", {
    startMs: start,
    serviceName: "Color",
    customerName: "Web Visitor",
    customerEmail: "visitor@x.com",
  });
  expect(result).toContain("Booked");

  const rows = await t.run((ctx) => ctx.db.query("bookings").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: "assistant", start, status: "confirmed" });
  expect(rows[0].end - rows[0].start).toBe(90 * 60_000);
});

test("tool book_appointment — refuses without name + email (no booking made)", async () => {
  const { t, businessId } = await setup();
  const { result } = await call(t, businessId, "book_appointment", {
    startMs: futureSlot(),
    serviceName: "Color",
  });
  expect(result.toLowerCase()).toContain("need");
  const rows = await t.run((ctx) => ctx.db.query("bookings").collect());
  expect(rows).toHaveLength(0);
});

test("tool book_appointment — a taken slot surfaces the conflict, not a crash", async () => {
  const { t, businessId } = await setup();
  const start = futureSlot();
  await call(t, businessId, "book_appointment", {
    startMs: start,
    serviceName: "Color",
    customerName: "First",
    customerEmail: "first@x.com",
  });
  const { result } = await call(t, businessId, "book_appointment", {
    startMs: start,
    serviceName: "Color",
    customerName: "Second",
    customerEmail: "second@x.com",
  });
  expect(result.toLowerCase()).toContain("couldn't book");
});

test("tool capture_lead — saves an assistant-sourced lead", async () => {
  const { t, as, businessId } = await setup();
  const { result } = await call(t, businessId, "capture_lead", {
    name: "Curious",
    email: "curious@x.com",
    message: "pricing?",
  });
  expect(result.toLowerCase()).toContain("passed your details");
  const leads = await as.query(api.leads.list, { slug: "clip" });
  expect(leads[0]).toMatchObject({ name: "Curious", source: "assistant" });
});
