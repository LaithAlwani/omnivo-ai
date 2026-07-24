/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const START = Date.UTC(2030, 5, 3, 9, 0); // 09:00 UTC, fixed date

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
  // 09:00–17:00 daily, 30-min step.
  await as.mutation(api.availability.update, {
    slug: "clip",
    staffId: staff!._id,
    availability: {
      timezone: "UTC",
      slotMinutes: 30,
      week: Array.from({ length: 7 }, () => ({ intervals: [{ start: 540, end: 1020 }] })),
    },
  });
  return { t, as, owner, business: business!, staffId: staff!._id };
}

const bookArgs = (
  staffId: string,
  start: number,
  token: string,
  serviceId?: Id<"services">,
) => ({
  slug: "clip",
  staffId: staffId as never,
  start,
  serviceId,
  source: "dashboard" as const,
  cancelToken: token,
  customerName: "Sam",
  customerEmail: "sam@x.com",
});

test("service duration — a 90-min service books a 90-min appointment", async () => {
  const { as, staffId } = await setup();
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Color",
    durationMinutes: 90,
  });

  const res = await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1", svc));
  expect(res.end - res.start).toBe(90 * 60_000);
});

test("service duration — a longer service removes overlapping start times", async () => {
  const { as, staffId } = await setup();
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Color",
    durationMinutes: 90,
  });

  // Book a 90-min color at 09:00 → 10:30.
  await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1", svc));

  // The 09:30 and 10:00 starts can no longer host another 90-min service.
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    serviceId: svc,
    fromMs: START - HOUR,
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  expect(starts).not.toContain(START + 30 * 60_000); // 09:30
  expect(starts).not.toContain(START + 60 * 60_000); // 10:00
  expect(starts).toContain(START + 90 * 60_000); // 10:30 is free
  // Each offered slot is 90 minutes long.
  for (const s of slots) expect(s.end - s.start).toBe(90 * 60_000);
});

test("service duration — one that won't fit before close is not offered", async () => {
  const { as, staffId } = await setup();
  // 8-hour service can never fit an 8-hour day starting after 09:00.
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "All day",
    durationMinutes: 481, // > 480 minutes (09:00–17:00)
  });
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    serviceId: svc,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots).toHaveLength(0);
});

test("service staff filter — only assigned staff perform it", async () => {
  const { as, t, business, staffId } = await setup();
  // A second bookable staff with the same availability.
  const other = await as.mutation(api.staff.add, { slug: "clip", name: "Jo", bookable: true });
  await as.mutation(api.availability.update, {
    slug: "clip",
    staffId: other,
    availability: {
      timezone: "UTC",
      slotMinutes: 30,
      week: Array.from({ length: 7 }, () => ({ intervals: [{ start: 540, end: 1020 }] })),
    },
  });

  // Service performed only by `other`.
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Special",
    durationMinutes: 30,
    staffIds: [other],
  });

  // Booking it against the un-assigned default staff is rejected.
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1", svc)),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });

  // "any" assigns to the one who performs it.
  const res = await as.mutation(internal.bookings.create, bookArgs("any", START, "t2", svc));
  expect(res.staffId).toBe(other);
  void t;
  void business;
});

test("service — inactive service can't be booked", async () => {
  const { as, staffId } = await setup();
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Retired",
    durationMinutes: 30,
  });
  await as.mutation(api.services.update, { slug: "clip", serviceId: svc, active: false });
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1", svc)),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
});

test("service validation — rejects a bad duration", async () => {
  const { as } = await setup();
  await expect(
    as.mutation(api.services.add, { slug: "clip", name: "Bad", durationMinutes: 0 }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});

test("business timezone — set and read back, invalid rejected", async () => {
  const { as } = await setup();
  await as.mutation(api.businesses.setTimezone, {
    slug: "clip",
    timezone: "America/New_York",
  });
  const biz = await as.query(api.businesses.getBySlug, { slug: "clip" });
  expect(biz!.timezone).toBe("America/New_York");

  await expect(
    as.mutation(api.businesses.setTimezone, { slug: "clip", timezone: "Mars/Phobos" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});
