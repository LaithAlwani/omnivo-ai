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
  return { t, as, owner };
}

test("leads — create lands as a 'new' dashboard lead", async () => {
  const { as } = await setup();
  await as.mutation(api.leads.create, {
    slug: "clip",
    name: "  Dana  ",
    email: "dana@x.com",
    message: "wants a quote",
  });
  const rows = await as.query(api.leads.list, { slug: "clip" });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: "Dana",
    email: "dana@x.com",
    status: "new",
    source: "dashboard",
  });
});

test("leads — status filter + counts", async () => {
  const { as } = await setup();
  const a = await as.mutation(api.leads.create, { slug: "clip", name: "A" });
  await as.mutation(api.leads.create, { slug: "clip", name: "B" });
  await as.mutation(api.leads.setStatus, { slug: "clip", leadId: a, status: "won" });

  const counts = await as.query(api.leads.counts, { slug: "clip" });
  expect(counts).toMatchObject({ total: 2, new: 1, won: 1 });

  const wonOnly = await as.query(api.leads.list, { slug: "clip", status: "won" });
  expect(wonOnly).toHaveLength(1);
  expect(wonOnly[0].name).toBe("A");
});

test("leads — capture (assistant/widget entry point)", async () => {
  const { as } = await setup();
  await as.mutation(internal.leads.capture, {
    slug: "clip",
    source: "assistant",
    name: "Web Visitor",
    message: "asked about pricing",
  });
  const rows = await as.query(api.leads.list, { slug: "clip" });
  expect(rows[0]).toMatchObject({ source: "assistant", status: "new" });
});

test("leads — assign to staff and edit notes", async () => {
  const { as } = await setup();
  const staffId = await as.mutation(api.staff.add, {
    slug: "clip",
    name: "Jo",
    bookable: true,
  });
  const lead = await as.mutation(api.leads.create, { slug: "clip", name: "Pat" });

  await as.mutation(api.leads.update, {
    slug: "clip",
    leadId: lead,
    assignedStaffId: staffId,
    notes: "left a voicemail",
  });
  let rows = await as.query(api.leads.list, { slug: "clip" });
  expect(rows[0]).toMatchObject({
    assignedStaffId: staffId,
    assignedStaffName: "Jo",
    notes: "left a voicemail",
  });

  // Unassign.
  await as.mutation(api.leads.update, {
    slug: "clip",
    leadId: lead,
    assignedStaffId: null,
  });
  rows = await as.query(api.leads.list, { slug: "clip" });
  expect(rows[0].assignedStaffId).toBeNull();
});

test("leads — only a manager can delete", async () => {
  const { t, as } = await setup();
  const lead = await as.mutation(api.leads.create, { slug: "clip", name: "Temp" });

  // A staff-role member can't delete.
  const emp = await t.run((ctx) => ctx.db.insert("users", { email: "emp@x.com" }));
  await as.mutation(api.team.addMember, { slug: "clip", email: "emp@x.com", role: "staff" });
  const asEmp = t.withIdentity({ subject: `${emp}|s` });
  await expect(
    asEmp.mutation(api.leads.remove, { slug: "clip", leadId: lead }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

  // ...but can still read + advance the pipeline.
  await asEmp.mutation(api.leads.setStatus, { slug: "clip", leadId: lead, status: "contacted" });

  await as.mutation(api.leads.remove, { slug: "clip", leadId: lead });
  expect(await as.query(api.leads.list, { slug: "clip" })).toHaveLength(0);
});

test("leads — a member of another business can't read them", async () => {
  const { t, as } = await setup();
  await as.mutation(api.leads.create, { slug: "clip", name: "Secret" });

  const outsider = await t.run((ctx) => ctx.db.insert("users", { email: "out@x.com" }));
  const asOut = t.withIdentity({ subject: `${outsider}|s` });
  await asOut.mutation(internal.businesses.provision, {
    name: "Other",
    slug: "other",
    tier: "starter",
    embedKeyPrefix: "qq",
    embedKeyHash: "hh",
    embedKey: "ek_qq.x",
  });
  await expect(
    asOut.query(api.leads.list, { slug: "clip" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});
