/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("calendar connect authz — employee-only for linked staff, owner for shared", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "owner@x.com" }));
  const emp = await t.run((ctx) => ctx.db.insert("users", { email: "emp@x.com" }));
  const asOwner = t.withIdentity({ subject: `${owner}|s` });
  const asEmp = t.withIdentity({ subject: `${emp}|s` });

  await asOwner.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: "p",
    embedKeyHash: "h",
    embedKey: "ek_p.x",
  });
  const business = await t.run((ctx) =>
    ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "clip")).unique(),
  );
  // The default login-less "Main" calendar.
  const mainStaff = await t.run((ctx) =>
    ctx.db.query("staff").withIndex("by_business", (q) => q.eq("businessId", business!._id)).unique(),
  );

  // emp is a staff-role member with their own staff row (login-linked).
  await asOwner.mutation(api.team.addMember, { slug: "clip", email: "emp@x.com", role: "staff" });
  const empStaff = await t.run((ctx) =>
    ctx.db.insert("staff", {
      businessId: business!._id,
      userId: emp,
      name: "Emp",
      bookable: true,
      active: true,
      order: 1,
    }),
  );

  // Owner CANNOT connect the employee's own (login-linked) calendar.
  await expect(
    asOwner.query(internal.calendar.assertAccess, { slug: "clip", staffId: empStaff }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // The employee CAN connect their own.
  expect(
    await asEmp.query(internal.calendar.assertAccess, { slug: "clip", staffId: empStaff }),
  ).toMatchObject({ businessId: business!._id });

  // Owner CAN connect the login-less shared "Main" calendar.
  expect(
    await asOwner.query(internal.calendar.assertAccess, { slug: "clip", staffId: mainStaff!._id }),
  ).toMatchObject({ businessId: business!._id });

  // A staff member CANNOT connect the shared calendar.
  await expect(
    asEmp.query(internal.calendar.assertAccess, { slug: "clip", staffId: mainStaff!._id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});
