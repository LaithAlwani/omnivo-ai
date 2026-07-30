/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeProject(
  t: ReturnType<typeof convexTest>,
  plan: "starter" | "professional",
) {
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: `${plan}@x.com` }),
  );
  const asUser = t.withIdentity({ subject: `${user}|s` });
  await asUser.mutation(internal.businesses.provision, {
    name: "Co",
    slug: "co",
    tier: plan,
    embedKeyPrefix: "aaaaaa",
    embedKeyHash: "h",
    embedKey: "ek_aaaaaa.x",
  });
  return { asUser };
}

// A project is seeded with one default location on creation.
test("provision seeds a default location and assigns the default staff to it", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await makeProject(t, "professional");

  const locations = await asUser.query(api.locations.list, { slug: "co" });
  expect(locations).toHaveLength(1);
  expect(locations[0].active).toBe(true);

  const staff = await asUser.query(api.staff.list, { slug: "co" });
  expect(staff[0].locationId).toBe(locations[0]._id);
});

// Starter caps a project at one location; Professional allows up to three.
test("location limit is enforced per plan", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await makeProject(t, "starter");

  // The seeded default already fills the Starter allowance of 1.
  await expect(
    asUser.mutation(api.locations.add, { slug: "co", name: "Second" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // Bumping the account to Professional lifts the ceiling to 3.
  await asUser.mutation(api.accounts.setPlan, { slug: "co", plan: "professional" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Second" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Third" });
  await expect(
    asUser.mutation(api.locations.add, { slug: "co", name: "Fourth" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  const locations = await asUser.query(api.locations.list, { slug: "co" });
  expect(locations).toHaveLength(3);
});

// Slot generation only considers staff at the requested location.
test("slots are scoped to a location", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await makeProject(t, "professional");

  // Two locations, each with one bookable staff + a simple weekday rule.
  const locB = await asUser.mutation(api.locations.add, {
    slug: "co",
    name: "Location B",
  });
  const { slug, locA, staffA, staffB } = await t.run(async (ctx) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", "co"))
      .unique();
    const locs = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", business!._id))
      .collect();
    const locA = locs.find((l) => l._id !== locB)!._id;

    // The seeded "Main" staff sits at location A.
    const staffA = (
      await ctx.db
        .query("staff")
        .withIndex("by_business", (q) => q.eq("businessId", business!._id))
        .collect()
    )[0]._id;
    const staffB = await ctx.db.insert("staff", {
      businessId: business!._id,
      locationId: locB,
      name: "B-person",
      bookable: true,
      active: true,
      order: 1,
    });

    // Both staff: open every day 09:00–17:00, 60-min slots.
    const fullWeek = Array.from({ length: 7 }, () => ({
      intervals: [{ start: 9 * 60, end: 17 * 60 }],
    }));
    for (const staffId of [staffA, staffB]) {
      await ctx.db.insert("availabilityRules", {
        businessId: business!._id,
        staffId,
        timezone: "UTC",
        slotMinutes: 60,
        week: fullWeek,
      });
    }
    return {
      slug: "co",
      locA,
      staffA,
      staffB: staffB as Id<"staff">,
    };
  });
  void staffA;
  void staffB;

  const from = Date.UTC(2026, 7, 3, 0, 0, 0); // a Monday
  const atA = await asUser.query(api.slots.getSlots, {
    slug,
    staffId: "any",
    fromMs: from,
    days: 1,
    locationId: locA,
  });
  const atB = await asUser.query(api.slots.getSlots, {
    slug,
    staffId: "any",
    fromMs: from,
    days: 1,
    locationId: locB,
  });

  // Each location yields slots from only its own staff.
  expect(atA.length).toBeGreaterThan(0);
  expect(atB.length).toBeGreaterThan(0);
  expect(atA.every((s) => s.staffId === staffA)).toBe(true);
  expect(atB.every((s) => s.staffId === staffB)).toBe(true);
});
