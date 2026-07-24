/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3_600_000;
const START = Date.UTC(2030, 5, 3, 9, 0);

async function base() {
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
      slotMinutes: 60,
      week: Array.from({ length: 7 }, () => ({ intervals: [{ start: 540, end: 1020 }] })),
    },
  });
  return { t, as, owner, business: business!, staffId: staff!._id };
}

test("external link — normalizes and rejects a non-URL", async () => {
  const { as, staffId } = await base();
  await expect(
    as.mutation(api.staff.update, {
      slug: "clip",
      staffId,
      externalBookingUrl: "not a url",
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });

  await as.mutation(api.staff.update, {
    slug: "clip",
    staffId,
    externalBookingUrl: "https://calendly.com/jane",
  });
  const rows = await as.query(api.staff.list, { slug: "clip" });
  expect(rows[0].externalBookingUrl).toBe("https://calendly.com/jane");
});

test("external link — no internal slots and direct booking is rejected", async () => {
  const { as, staffId } = await base();
  await as.mutation(api.staff.update, {
    slug: "clip",
    staffId,
    externalBookingUrl: "https://calendly.com/jane",
  });

  const slots = await as.query(api.slots.getSlots, {
    slug: "clip",
    staffId,
    fromMs: START - HOUR,
    days: 1,
  });
  expect(slots).toHaveLength(0);

  await expect(
    as.mutation(internal.bookings.create, {
      slug: "clip",
      staffId,
      start: START,
      source: "dashboard",
      cancelToken: "t1",
      customerName: "Sam",
      customerEmail: "sam@x.com",
    }),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

test("external link — clearing it restores internal booking", async () => {
  const { as, staffId } = await base();
  await as.mutation(api.staff.update, {
    slug: "clip",
    staffId,
    externalBookingUrl: "https://calendly.com/jane",
  });
  await as.mutation(api.staff.update, {
    slug: "clip",
    staffId,
    externalBookingUrl: "",
  });
  const rows = await as.query(api.staff.list, { slug: "clip" });
  expect(rows[0].externalBookingUrl).toBeUndefined();

  const res = await as.mutation(internal.bookings.create, {
    slug: "clip",
    staffId,
    start: START,
    source: "dashboard",
    cancelToken: "t1",
    customerName: "Sam",
    customerEmail: "sam@x.com",
  });
  expect(res.staffId).toBe(staffId);
});

test("member↔staff link — link existing, move, unlink", async () => {
  const { t, as, owner, business, staffId } = await base();

  // The owner's own membership.
  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_business", (q) =>
        q.eq("userId", owner).eq("businessId", business._id),
      )
      .unique(),
  );

  // Link owner to the default "Main" staff row.
  await as.mutation(api.team.linkStaff, {
    slug: "clip",
    membershipId: membership!._id,
    target: staffId,
  });
  let members = await as.query(api.team.listMembers, { slug: "clip" });
  expect(members[0].linkedStaffId).toBe(staffId);

  // Create a second staff row and move the link to it — the first unlinks.
  const other = await as.mutation(api.staff.add, {
    slug: "clip",
    name: "Chair 2",
    bookable: true,
  });
  await as.mutation(api.team.linkStaff, {
    slug: "clip",
    membershipId: membership!._id,
    target: other,
  });
  members = await as.query(api.team.listMembers, { slug: "clip" });
  expect(members[0].linkedStaffId).toBe(other);
  const rows = await as.query(api.staff.list, { slug: "clip" });
  expect(rows.find((r) => r._id === staffId)!.userId).toBeUndefined();

  // Unlink entirely.
  await as.mutation(api.team.linkStaff, {
    slug: "clip",
    membershipId: membership!._id,
    target: "none",
  });
  members = await as.query(api.team.listMembers, { slug: "clip" });
  expect(members[0].linkedStaffId).toBeNull();
});

test("member↔staff link — create makes a bookable staff row for the login", async () => {
  const { t, as, owner, business } = await base();
  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_business", (q) =>
        q.eq("userId", owner).eq("businessId", business._id),
      )
      .unique(),
  );
  await as.mutation(api.team.linkStaff, {
    slug: "clip",
    membershipId: membership!._id,
    target: "create",
  });
  const rows = await as.query(api.staff.list, { slug: "clip" });
  const mine = rows.find((r) => r.userId === owner);
  expect(mine).toBeTruthy();
  expect(mine!.bookable).toBe(true);
});
