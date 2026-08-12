/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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
  return { t, as };
}

test("services — add, list, update, and remove", async () => {
  const { as } = await setup();
  const svc = await as.mutation(api.services.add, {
    slug: "clip",
    name: "Color",
    durationMinutes: 90,
    priceCents: 12000,
  });
  let list = await as.query(api.services.list, { slug: "clip" });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    name: "Color",
    durationMinutes: 90,
    priceCents: 12000,
  });

  await as.mutation(api.services.update, {
    slug: "clip",
    serviceId: svc,
    name: "Full Color",
  });
  list = await as.query(api.services.list, { slug: "clip" });
  expect(list[0].name).toBe("Full Color");

  await as.mutation(api.services.remove, { slug: "clip", serviceId: svc });
  list = await as.query(api.services.list, { slug: "clip" });
  expect(list).toHaveLength(0);
});

test("services — the public menu lists active services only", async () => {
  const { t, as } = await setup();
  await as.mutation(api.services.add, { slug: "clip", name: "Cut", durationMinutes: 30 });
  await as.mutation(api.services.add, { slug: "clip", name: "Hidden", durationMinutes: 30 });
  const all = await as.query(api.services.list, { slug: "clip" });
  const hidden = all.find((s) => s.name === "Hidden")!;
  await as.mutation(api.services.update, {
    slug: "clip",
    serviceId: hidden._id,
    active: false,
  });

  const business = await t.run((ctx) =>
    ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "clip")).unique(),
  );
  const menu = await t.query(internal.services.listForBusiness, {
    businessId: business!._id,
  });
  expect(menu.map((s) => s.name)).toEqual(["Cut"]);
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
