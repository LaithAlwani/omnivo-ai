/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const START = Date.UTC(2030, 5, 3, 9, 0); // 09:00 UTC on a fixed date

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });

  await as.mutation(internal.businesses.provision, {
    name: "Clip Co",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  const business = await t.run((ctx) =>
    ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", "clip"))
      .unique(),
  );
  const staff = await t.run((ctx) =>
    ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", business!._id))
      .unique(),
  );

  // Available 09:00–17:00 every day, 60-min slots, UTC.
  await as.mutation(api.availability.update, {
    slug: "clip",
    staffId: staff!._id,
    availability: {
      timezone: "UTC",
      slotMinutes: 60,
      week: Array.from({ length: 7 }, () => ({
        intervals: [{ start: 540, end: 1020 }],
      })),
    },
  });

  return { t, as, staffId: staff!._id };
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

test("booking — creates a confirmed appointment on an open slot", async () => {
  const { as, staffId } = await setup();
  const res = await as.mutation(
    internal.bookings.create,
    bookArgs(staffId, START, "t1"),
  );
  expect(res.staffId).toBe(staffId);
  expect(res.end).toBe(START + HOUR);
});

test("booking — double-booking the same slot is rejected", async () => {
  const { as, staffId } = await setup();
  await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1"));
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t2")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("booking — a booked slot disappears from getSlots", async () => {
  const { as, staffId } = await setup();
  await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1"));
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  expect(starts).not.toContain(START); // 09:00 taken
  expect(starts).toContain(START + HOUR); // 10:00 still open
});

test("booking — 'any' assigns an available staff member", async () => {
  const { as, staffId } = await setup();
  const res = await as.mutation(
    internal.bookings.create,
    bookArgs("any", START, "t1"),
  );
  expect(res.staffId).toBe(staffId);
});

test("booking — a slot outside availability is rejected", async () => {
  const { as, staffId } = await setup();
  const midnight = Date.UTC(2030, 5, 3, 0, 0); // 00:00, outside 09:00–17:00
  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, midnight, "t1")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("cancel — frees the slot again", async () => {
  const { as, staffId } = await setup();
  const res = await as.mutation(
    internal.bookings.create,
    bookArgs(staffId, START, "t1"),
  );
  await as.mutation(api.bookings.cancel, {
    slug: "clip",
    bookingId: res.bookingId,
  });
  // Slot re-opens after cancel.
  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots.map((s) => s.start)).toContain(START);
});

test("reschedule — moves the booking and frees the old slot", async () => {
  const { as, staffId } = await setup();
  const res = await as.mutation(
    internal.bookings.create,
    bookArgs(staffId, START, "t1"),
  );
  const moved = await as.mutation(api.bookings.reschedule, {
    slug: "clip",
    bookingId: res.bookingId,
    newStart: START + HOUR, // 10:00
  });
  expect(moved.start).toBe(START + HOUR);

  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  const starts = slots.map((s) => s.start);
  expect(starts).toContain(START); // 09:00 freed
  expect(starts).not.toContain(START + HOUR); // 10:00 now taken
});

test("calendar busy — an external busy span blocks the slot", async () => {
  const { t, as, staffId } = await setup();
  await t.run(async (ctx) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", "clip"))
      .unique();
    await ctx.db.insert("calendarBusy", {
      businessId: business!._id,
      staffId,
      start: START,
      end: START + HOUR,
    });
  });

  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots.map((s) => s.start)).not.toContain(START);

  await expect(
    as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1")),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("reschedule — onto an already-booked slot is rejected", async () => {
  const { as, staffId } = await setup();
  const a = await as.mutation(internal.bookings.create, bookArgs(staffId, START, "t1"));
  await as.mutation(internal.bookings.create, bookArgs(staffId, START + HOUR, "t2"));
  await expect(
    as.mutation(api.bookings.reschedule, {
      slug: "clip",
      bookingId: a.bookingId,
      newStart: START + HOUR, // taken by the second booking
    }),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});
