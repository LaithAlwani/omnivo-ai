/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
test("provision seeds a default location", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await makeProject(t, "professional");

  const locations = await asUser.query(api.locations.list, { slug: "co" });
  expect(locations).toHaveLength(1);
  expect(locations[0].active).toBe(true);
});

// Starter caps a project at one location; Professional allows up to three.
test("location limit is enforced per plan", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await makeProject(t, "starter");

  // The seeded default already fills the Starter allowance of 1.
  await expect(
    asUser.mutation(api.locations.add, { slug: "co", name: "Second" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // Professional includes 2 locations → one more, then blocked.
  await asUser.mutation(api.accounts.setPlan, { slug: "co", plan: "professional" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Second" });
  await expect(
    asUser.mutation(api.locations.add, { slug: "co", name: "Third" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // Premium includes 5 → up to five, then blocked.
  await asUser.mutation(api.accounts.setPlan, { slug: "co", plan: "premium" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Third" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Fourth" });
  await asUser.mutation(api.locations.add, { slug: "co", name: "Fifth" });
  await expect(
    asUser.mutation(api.locations.add, { slug: "co", name: "Sixth" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  const locations = await asUser.query(api.locations.list, { slug: "co" });
  expect(locations).toHaveLength(5);
});
