/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function salesProject(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "professional",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "salesAssistant",
    enabled: true,
  });
  return { as, businessId };
}

// A captured lead with intent + contact flags the owner (hot lead).
test("hot-lead alert — a promising captured lead is flagged and logged", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await salesProject(t);

  const leadId = await t.mutation(internal.leads.captureForBusiness, {
    businessId,
    source: "assistant",
    name: "Jordan",
    email: "jordan@x.com",
    message: "Looking to book a full color next week",
  });
  // Capture schedules onLeadCaptured (runAfter 0); run the alert step directly.
  await t.mutation(internal.sales.onLeadCaptured, { leadId: leadId as Id<"leads"> });

  const lead = await t.run((ctx) => ctx.db.get(leadId as Id<"leads">));
  expect(lead?.qualified).toBe(true);

  const alerts = await t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_business_ts", (q) => q.eq("businessId", businessId))
      .collect(),
  );
  expect(alerts.some((a) => a.action === "sales.hot_lead")).toBe(true);
});

// The nurture cron follows up open leads once per interval, bounded + idempotent.
test("nurture — an open lead is followed up and re-marked, not spammed", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await salesProject(t);

  // A plain lead (no strong intent) captured a while ago.
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", {
      businessId,
      name: "Sam",
      email: "sam@x.com",
      status: "new" as const,
      source: "assistant" as const,
      updatedAt: Date.now(),
    }),
  );

  await t.mutation(internal.sales.followupForBusiness, { businessId });
  let lead = await t.run((ctx) => ctx.db.get(leadId as Id<"leads">));
  expect(lead?.followupCount).toBe(1);
  expect(lead?.status).toBe("contacted");
  expect(lead?.lastFollowupAt).toBeTruthy();

  // A second immediate tick is within the interval → no new follow-up.
  await t.mutation(internal.sales.followupForBusiness, { businessId });
  lead = await t.run((ctx) => ctx.db.get(leadId as Id<"leads">));
  expect(lead?.followupCount).toBe(1);
});

// With the module off, the nurture cron does nothing.
test("nurture — disabled module produces no follow-ups", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await salesProject(t);
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "salesAssistant",
    enabled: false,
  });
  await t.run((ctx) =>
    ctx.db.insert("leads", {
      businessId,
      name: "Sam",
      email: "sam@x.com",
      status: "new" as const,
      source: "assistant" as const,
      updatedAt: Date.now(),
    }),
  );

  await t.mutation(internal.sales.enqueueFollowups, {});
  await t.finishInProgressScheduledFunctions();

  const leads = await t.run((ctx) =>
    ctx.db
      .query("leads")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect(),
  );
  expect(leads[0].followupCount ?? 0).toBe(0);
});
