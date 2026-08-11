/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

async function superadmin(t: TestConvex<typeof schema>) {
  const user = await t.run((ctx) =>
    ctx.db.insert("users", { email: "op@omnivo.ai" }),
  );
  await t.run((ctx) =>
    ctx.db.insert("platformAdmins", { userId: user, role: "superadmin", createdAt: 0 }),
  );
  return { user, as: t.withIdentity({ subject: `${user}|s` }) };
}

async function ownerMembership(t: TestConvex<typeof schema>, businessId: Id<"businesses">) {
  return await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first(),
  );
}

test("provisionForClient creates an installer tenant owned by a shell user", async () => {
  const t = convexTest(schema, modules);
  const sa = await superadmin(t);

  const { businessId }: { businessId: Id<"businesses"> } =
    await sa.as.action(api.platform.provisionForClient, {
      clientEmail: "client@acme.com",
      name: "Acme",
      slug: "acme",
      tier: "starter",
    });

  const business = (await t.run((ctx) => ctx.db.get(businessId)))!;
  expect(business.provisioning).toBe("installer");
  expect(business.installerId).toBe(sa.user);
  expect(business.status).toBe("installing");

  const owner = await ownerMembership(t, businessId);
  const shell = owner ? await t.run((ctx) => ctx.db.get(owner.userId)) : null;
  expect(shell?.email).toBe("client@acme.com");

  // Audit row written.
  const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
  expect(audits.some((a) => a.action === "platform.provisionForClient")).toBe(true);
});

test("accepting an invite claims the tenant — ownership transfers to the real user", async () => {
  const t = convexTest(schema, modules);
  const sa = await superadmin(t);

  const { businessId }: { businessId: Id<"businesses"> } =
    await sa.as.action(api.platform.provisionForClient, {
      clientEmail: "client@acme.com",
      name: "Acme",
      slug: "acme",
      tier: "starter",
    });
  const ownerBefore = await ownerMembership(t, businessId);
  const shellUserId = ownerBefore!.userId;
  const accountId = (await t.run((ctx) => ctx.db.get(businessId)))!.accountId!;

  // Installer issues an owner invite (store directly; the email action is wired
  // separately).
  await sa.as.mutation(internal.invitations.store, {
    businessId,
    email: "client@acme.com",
    role: "owner",
    tokenHash: "tok-1",
    expiresAt: Date.now() + 60_000,
  });

  // The real client signs up and accepts.
  const client = await t.run((ctx) =>
    ctx.db.insert("users", { email: "client@acme.com" }),
  );
  const slug = await t
    .withIdentity({ subject: `${client}|s` })
    .mutation(internal.invitations.consume, { tokenHash: "tok-1" });
  expect(slug).toBe("acme");

  // Ownership moved from the shell to the client; the shell is gone.
  const ownerAfter = await ownerMembership(t, businessId);
  expect(ownerAfter!.userId).toBe(client);
  expect(await t.run((ctx) => ctx.db.get(shellUserId))).toBe(null);
  const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
  expect(account.ownerUserId).toBe(client);

  // Invite consumed (single-use).
  const invites = await t.run((ctx) => ctx.db.query("invitations").collect());
  expect(invites).toHaveLength(0);
});

test("a teammate invite adds a membership (not a claim)", async () => {
  const t = convexTest(schema, modules);
  // A normal self-serve business with a real owner.
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "o@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "premium",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });

  await as.mutation(internal.invitations.store, {
    businessId,
    email: "staff@x.com",
    role: "staff",
    tokenHash: "tok-2",
    expiresAt: Date.now() + 60_000,
  });

  const staffUser = await t.run((ctx) =>
    ctx.db.insert("users", { email: "staff@x.com" }),
  );
  await t
    .withIdentity({ subject: `${staffUser}|s` })
    .mutation(internal.invitations.consume, { tokenHash: "tok-2" });

  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_business", (q) =>
        q.eq("userId", staffUser).eq("businessId", businessId),
      )
      .unique(),
  );
  expect(membership?.role).toBe("staff");
  // Owner unchanged.
  const owners = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .collect(),
  );
  expect(owners).toHaveLength(1);
  expect(owners[0].userId).toBe(owner);
});
