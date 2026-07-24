/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const MIN = 60_000;
const HOUR = 3_600_000;
const START = Date.UTC(2030, 5, 3, 9, 0); // 09:00 UTC, fixed future date

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
  const staff = await t.run((ctx) =>
    ctx.db.query("staff").withIndex("by_business", (q) => q.eq("businessId", business!._id)).unique(),
  );
  await as.mutation(api.availability.update, {
    slug: "clip",
    staffId: staff!._id,
    availability: {
      timezone: "UTC",
      slotMinutes: 30,
      week: Array.from({ length: 7 }, () => ({ intervals: [{ start: 540, end: 1020 }] })),
    },
  });
  return { t, as, business: business!, staffId: staff!._id };
}

// Set a policy directly (bypasses the setter's 1–365 window cap so the fixed
// 2030 fixtures still book while we exercise buffer/lead-time behavior).
async function setPolicy(
  t: Awaited<ReturnType<typeof convexTest>>,
  businessId: Id<"businesses">,
  policy: { minNoticeMinutes: number; maxAdvanceDays: number; bufferMinutes: number },
) {
  await t.run((ctx) => ctx.db.patch(businessId, { bookingPolicy: policy }));
}

const bookArgs = (staffId: string, start: number, token: string) => ({
  slug: "clip",
  staffId: staffId as never,
  start,
  source: "dashboard" as const,
  cancelToken: token,
  customerName: "Sam",
  customerEmail: "sam@x.com",
});

test("buffer — a gap is enforced around an existing appointment", async () => {
  const { t, as, business, staffId } = await setup();
  await setPolicy(t, business._id, {
    minNoticeMinutes: 0,
    maxAdvanceDays: 999_999,
    bufferMinutes: 30,
  });
  await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1"));

  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  // 09:00–09:30 booked; 30-min buffer pushes the next bookable start to 10:00.
  expect(starts).not.toContain(START + 30 * MIN); // 09:30 blocked by buffer
  expect(starts).toContain(START + 60 * MIN); // 10:00 free

  // Booking into the buffer is rejected too.
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START + 30 * MIN, "t2")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("lead time — slots inside the notice window are hidden", async () => {
  const { t, as, business, staffId } = await setup();
  await setPolicy(t, business._id, {
    minNoticeMinutes: 90,
    maxAdvanceDays: 999_999,
    bufferMinutes: 0,
  });
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START, // "now" = 09:00 → earliest bookable is 10:30
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  expect(starts).not.toContain(START); // 09:00 too soon
  expect(starts).not.toContain(START + 60 * MIN); // 10:00 too soon
  expect(starts).toContain(START + 90 * MIN); // 10:30 ok
});

test("lead time — booking too soon is rejected", async () => {
  const { t, as, business, staffId } = await setup();
  // Huge notice → every fixed-date slot is 'too soon' relative to real now.
  await setPolicy(t, business._id, {
    minNoticeMinutes: 999_999_999,
    maxAdvanceDays: 999_999,
    bufferMinutes: 0,
  });
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("booking window — booking beyond the horizon is rejected", async () => {
  const { t, as, business, staffId } = await setup();
  await setPolicy(t, business._id, {
    minNoticeMinutes: 0,
    maxAdvanceDays: 1, // 2030 is way beyond 1 day from now
    bufferMinutes: 0,
  });
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("blackout — time off blocks slots and booking", async () => {
  const { as, staffId } = await setup();
  // Staff off 09:00–10:00.
  await as.mutation(api.blackouts.add, {
    slug: "clip",
    staffId,
    start: START,
    end: START + HOUR,
    reason: "Dentist",
  });

  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  expect(starts).not.toContain(START); // 09:00 off
  expect(starts).not.toContain(START + 30 * MIN); // 09:30 off
  expect(starts).toContain(START + 60 * MIN); // 10:00 back open

  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("blackout — business-wide closure blocks all staff", async () => {
  const { as, staffId } = await setup();
  // No staffId = whole business closed.
  await as.mutation(api.blackouts.add, {
    slug: "clip",
    start: START,
    end: START + HOUR,
    reason: "Holiday",
  });
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots.map((s) => s.start)).not.toContain(START);
});

test("setBookingPolicy — rejects an out-of-range window", async () => {
  const { as } = await setup();
  await expect(
    as.mutation(api.businesses.setBookingPolicy, {
      slug: "clip",
      policy: { minNoticeMinutes: 0, maxAdvanceDays: 999, bufferMinutes: 0 },
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});
