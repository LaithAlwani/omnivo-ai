/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { generateEmbedKey } from "./lib/keys";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const START = Date.UTC(2030, 5, 3, 9, 0);

async function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "owner@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });

  // Provision with a REAL embed key so the public path's verify actually passes.
  const { key, prefix, hash } = await generateEmbedKey();
  await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: prefix,
    embedKeyHash: hash,
    embedKey: key,
  });
  const business = await t.run((ctx) =>
    ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "clip")).unique(),
  );
  // The widget only serves a live business.
  await t.run((ctx) => ctx.db.patch(business!._id, { status: "live" as const }));
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
  const serviceId = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Color",
    durationMinutes: 90,
    priceCents: 12000,
  });

  return { t, as, key, business: business!, staffId, serviceId };
}

test("public — service menu + staff resolve by embed key", async () => {
  const { t, key } = await setup();
  const services = await t.action(api.public.services, { embedKey: key });
  expect(services).toHaveLength(1);
  expect(services[0]).toMatchObject({ name: "Color", durationMinutes: 90, priceCents: 12000 });

  const staff = await t.action(api.public.staff, { embedKey: key });
  expect(staff).toHaveLength(1);
  expect(staff[0].name).toBe("Main");
});

test("public — slots honor the service duration", async () => {
  const { t, key, serviceId, staffId } = await setup();
  const slots = await t.action(api.public.slots, {
    embedKey: key,
    staffId,
    serviceId,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots.length).toBeGreaterThan(0);
  for (const s of slots) expect(s.end - s.start).toBe(90 * 60_000);
});

test("public — book via embed key lands as a widget booking", async () => {
  const { t, as, key, serviceId, staffId } = await setup();
  const res = await t.action(api.public.book, {
    embedKey: key,
    staffId,
    serviceId,
    start: START,
    customerName: "Web Visitor",
    customerEmail: "visitor@x.com",
  });
  expect(res.end - res.start).toBe(90 * 60_000);
  expect(res.cancelToken).toHaveLength(32);

  // It shows up on the dashboard, tagged as a widget booking.
  const row = await t.run((ctx) => ctx.db.get(res.bookingId));
  expect(row).toMatchObject({ source: "widget", status: "confirmed" });

  // The slot is now taken — booking it again fails.
  await expect(
    t.action(api.public.book, {
      embedKey: key,
      staffId,
      serviceId,
      start: START,
      customerName: "Second",
      customerEmail: "second@x.com",
    }),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  void as;
});

test("public — capture a lead via embed key", async () => {
  const { t, as, key } = await setup();
  const { leadId } = await t.action(api.public.captureLead, {
    embedKey: key,
    name: "Curious",
    email: "curious@x.com",
    message: "do you do balayage?",
  });
  expect(leadId).toBeTruthy();
  const leads = await as.query(api.leads.list, { slug: "clip" });
  expect(leads[0]).toMatchObject({ name: "Curious", source: "widget", status: "new" });
});

test("public — a bad or forged key is rejected", async () => {
  const { t, key } = await setup();
  await expect(
    t.action(api.public.services, { embedKey: "not-a-key" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_CREDENTIALS" } });

  // Right prefix, wrong secret.
  const forged = key.replace(/\.[0-9a-f]+$/, ".deadbeef");
  await expect(
    t.action(api.public.services, { embedKey: forged }),
  ).rejects.toMatchObject({ data: { code: "INVALID_CREDENTIALS" } });
});

test("public — config returns branding for the widget", async () => {
  const { t, key } = await setup();
  const cfg = await t.action(api.public.config, { embedKey: key });
  expect(cfg).toMatchObject({
    name: "Clip",
    assistantName: "Assistant",
    position: "right",
  });
  expect(cfg.primaryColor).toMatch(/^#/);
});

test("public — origin allow-list blocks a foreign site", async () => {
  const { t, key, business } = await setup();
  await t.run((ctx) => ctx.db.patch(business._id, { domains: ["shop.example.com"] }));

  await expect(
    t.action(api.public.services, { embedKey: key, origin: "https://evil.example.com" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // The allowed origin passes.
  const ok = await t.action(api.public.services, {
    embedKey: key,
    origin: "https://shop.example.com",
  });
  expect(ok).toHaveLength(1);
});
