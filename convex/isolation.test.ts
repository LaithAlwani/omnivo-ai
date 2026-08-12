/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Phase 0's load-bearing guarantee: businessId partitions everything, and a
// member of one tenant can never touch another's data.
test("tenant isolation — a member of one business cannot read another's", async () => {
  const t = convexTest(schema, modules);

  const userA = await t.run((ctx) =>
    ctx.db.insert("users", { email: "a@example.com" }),
  );
  const userB = await t.run((ctx) =>
    ctx.db.insert("users", { email: "b@example.com" }),
  );

  const asA = t.withIdentity({ subject: `${userA}|s1` });
  const asB = t.withIdentity({ subject: `${userB}|s2` });

  // Each user provisions their own business (identity flows through the call).
  await asA.mutation(internal.businesses.provision, {
    name: "Alpha Co",
    slug: "alpha",
    tier: "starter",
    embedKeyPrefix: "aaaaaa",
    embedKeyHash: "hash-a",
    embedKey: "ek_aaaaaa.a",
  });
  await asB.mutation(internal.businesses.provision, {
    name: "Beta Co",
    slug: "beta",
    tier: "starter",
    embedKeyPrefix: "bbbbbb",
    embedKeyHash: "hash-b",
    embedKey: "ek_bbbbbb.b",
  });

  // The switcher shows each user ONLY their own business.
  const aList = await asA.query(api.businesses.listMine, {});
  const bList = await asB.query(api.businesses.listMine, {});
  expect(aList.map((b) => b.slug)).toEqual(["alpha"]);
  expect(bList.map((b) => b.slug)).toEqual(["beta"]);

  // A reads its own business fine.
  const alpha = await asA.query(api.businesses.getBySlug, { slug: "alpha" });
  expect(alpha?.name).toBe("Alpha Co");

  // THE BOUNDARY: B cannot read A's business.
  await expect(
    asB.query(api.businesses.getBySlug, { slug: "alpha" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // And an unauthenticated caller cannot read it either.
  await expect(
    t.query(api.businesses.getBySlug, { slug: "alpha" }),
  ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
});

// Onboarding creates the owner membership + a default location in one shot.
test("onboarding — creator becomes owner with a default location", async () => {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@example.com" }),
  );
  const asUser = t.withIdentity({ subject: `${user}|s` });

  const businessId = await asUser.mutation(internal.businesses.provision, {
    name: "Solo Salon",
    slug: "solo-salon",
    tier: "starter",
    embedKeyPrefix: "cccccc",
    embedKeyHash: "hash-c",
    embedKey: "ek_cccccc.c",
  });

  const { membership, locations } = await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_business", (q) =>
        q.eq("userId", user).eq("businessId", businessId),
      )
      .unique();
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    return { membership, locations };
  });

  expect(membership?.role).toBe("owner");
  expect(locations).toHaveLength(1);
  expect(locations[0].active).toBe(true);
});

// Slug collisions are rejected — one namespace, first come first served.
test("onboarding — duplicate slug is rejected", async () => {
  const t = convexTest(schema, modules);
  const u1 = await t.run((ctx) => ctx.db.insert("users", { email: "1@x.com" }));
  const u2 = await t.run((ctx) => ctx.db.insert("users", { email: "2@x.com" }));

  await t.withIdentity({ subject: `${u1}|s` }).mutation(
    internal.businesses.provision,
    { name: "First", slug: "taken", tier: "starter", embedKeyPrefix: "p1", embedKeyHash: "h1", embedKey: "ek_p1.a" },
  );
  await expect(
    t.withIdentity({ subject: `${u2}|s` }).mutation(internal.businesses.provision, {
      name: "Second",
      slug: "taken",
      tier: "starter",
      embedKeyPrefix: "p2",
      embedKeyHash: "h2",
      embedKey: "ek_p2.b",
    }),
  ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
});

// The platform plane is gated: ordinary users can't run cross-tenant reads.
test("platform gate — a non-admin cannot list all businesses", async () => {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: "nobody@example.com" }),
  );
  await expect(
    t.withIdentity({ subject: `${user}|s` }).query(api.platform.listBusinesses, {}),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});

// Owners outrank admins: an admin can manage staff/admins but not owners.
test("owner protection — an admin cannot remove or re-role an owner", async () => {
  const t = convexTest(schema, modules);
  const ownerU = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@x.com" }),
  );
  await t.run((ctx) => ctx.db.insert("users", { email: "admin@x.com" }));
  const asOwner = t.withIdentity({ subject: `${ownerU}|s` });

  await asOwner.mutation(internal.businesses.provision, {
    name: "Acme",
    slug: "acme",
    tier: "starter",
    embedKeyPrefix: "zz",
    embedKeyHash: "h",
    embedKey: "ek_zz.z",
  });
  await asOwner.mutation(api.team.addMember, {
    slug: "acme",
    email: "admin@x.com",
    role: "admin",
  });

  const members = await asOwner.query(api.team.listMembers, { slug: "acme" });
  const ownerM = members.find((m) => m.role === "owner")!;
  const adminM = members.find((m) => m.role === "admin")!;

  const adminUser = await t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", "admin@x.com"))
      .unique(),
  );
  const admin = t.withIdentity({ subject: `${adminUser!._id}|s` });

  // Admin can't remove the owner…
  await expect(
    admin.mutation(api.team.removeMember, {
      slug: "acme",
      membershipId: ownerM.membershipId,
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // …can't demote the owner…
  await expect(
    admin.mutation(api.team.updateMemberRole, {
      slug: "acme",
      membershipId: ownerM.membershipId,
      role: "staff",
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // …and can't promote anyone to owner.
  await expect(
    admin.mutation(api.team.updateMemberRole, {
      slug: "acme",
      membershipId: adminM.membershipId,
      role: "owner",
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});
