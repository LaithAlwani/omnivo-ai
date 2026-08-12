/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllGlobals());

async function selfTenant(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "premium",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  return { owner, as, businessId };
}

test("new self-serve business starts draft + self", async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await selfTenant(t);
  const b = (await t.run((ctx) => ctx.db.get(businessId)))!;
  expect(b.status).toBe("draft");
  expect(b.provisioning).toBe("self");
});

test("go-live requires knowledge + a domain, then serves the widget", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await selfTenant(t);

  // Not ready yet.
  let r = await as.query(api.businesses.readiness, { slug: "clip" });
  expect(r.ready).toBe(false);
  await expect(as.mutation(api.businesses.goLive, { slug: "clip" })).rejects.toMatchObject({
    data: { code: "FORBIDDEN" },
  });

  // Add knowledge + a domain.
  await as.mutation(api.knowledge.update, {
    slug: "clip",
    knowledge: {
      about: "A salon.",
      services: [],
      pricing: "",
      hours: "",
      locations: [],
      faq: [],
      policies: "",
    },
  });
  await as.mutation(api.businesses.setDomains, {
    slug: "clip",
    domains: ["https://clip.example.com/"],
  });
  r = await as.query(api.businesses.readiness, { slug: "clip" });
  expect(r.knowledgePresent).toBe(true);
  expect(r.domainsSet).toBe(true);
  expect(r.ready).toBe(true);

  await as.mutation(api.businesses.goLive, { slug: "clip" });
  const b = (await t.run((ctx) => ctx.db.get(businessId)))!;
  expect(b.status).toBe("live");
  // Domain was normalized to a bare host.
  expect(b.domains).toEqual(["clip.example.com"]);

  // The widget gate (byEmbedPrefix.serving) now reports serving.
  const gate = await t.run((ctx) =>
    ctx.runQuery(internal.businesses.byEmbedPrefix, { prefix: "pp" }),
  );
  expect(gate?.serving).toBe(true);

  // Pause takes it back offline.
  await as.mutation(api.businesses.pause, { slug: "clip" });
  expect((await t.run((ctx) => ctx.db.get(businessId)))!.status).toBe("paused");

  // Every lifecycle action wrote an audit row.
  const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(audits.some((a) => a.action === "business.goLive")).toBe(true);
  expect(audits.some((a) => a.action === "business.pause")).toBe(true);
});

test("draft business is not served by the widget", async () => {
  const t = convexTest(schema, modules);
  await selfTenant(t); // draft
  const gate = await t.run((ctx) =>
    ctx.runQuery(internal.businesses.byEmbedPrefix, { prefix: "pp" }),
  );
  expect(gate?.serving).toBe(false);
});

test("installer connection-edit gating: installer-managed → owner blocked", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await selfTenant(t);
  // Owner can save connections while self-managed.
  await as.action(api.integrationsNode.save, {
    slug: "clip",
    kind: "crmInbound",
    provider: "webhook",
    config: { url: "https://api.example.com/lookup" },
    active: true,
  });

  // Flip to installer-managed → the owner (member) can no longer edit.
  await t.run((ctx) =>
    ctx.db.patch(businessId, { provisioning: "installer" as const }),
  );
  await expect(
    as.action(api.integrationsNode.save, {
      slug: "clip",
      kind: "crmInbound",
      provider: "webhook",
      config: { url: "https://api.example.com/x" },
      active: true,
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});
