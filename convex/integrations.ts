import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireInstallerAccess } from "./lib/authz";
import { appError } from "./lib/errors";
import { entitlementsFor } from "./entitlements";

/** Resolve a business by slug or throw. */
async function businessBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<"businesses">> {
  const business = await ctx.db
    .query("businesses")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!business) appError("NOT_FOUND", "That business doesn't exist.");
  return business;
}

// -----------------------------------------------------------------------------
// Integrations (default runtime) — storage + reads for the client's external
// systems. Encryption, outbound dispatch, inbound lookup, and connection tests
// live in integrationsNode.ts (Node runtime). This file never returns a secret.
// -----------------------------------------------------------------------------

export const kindValidator = v.union(
  v.literal("booking"),
  v.literal("crmOutbound"),
  v.literal("crmInbound"),
);
export const providerValidator = v.union(
  v.literal("webhook"),
  v.literal("calendly"),
  v.literal("acuity"),
  v.literal("square"),
  v.literal("hubspot"),
  v.literal("salesforce"),
  v.literal("zapier"),
);

/** The project's integrations (safe subset — never the secret). Managers only,
 *  and only meaningful when the Integrations module is on. */
export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const business = await businessBySlug(ctx, slug);
    await requireInstallerAccess(ctx, business);
    const enabled = (await entitlementsFor(ctx, business._id)).integrationsEnabled;
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    return {
      enabled,
      integrations: rows.map((r) => ({
        _id: r._id,
        kind: r.kind,
        provider: r.provider,
        config: r.config,
        active: r.active,
        verified: r.verified,
        hasSecret: !!r.secretEnc,
        lastTestedAt: r.lastTestedAt ?? null,
      })),
    };
  },
});

/** Internal: full config incl. secret cipher, for Node actions. */
export const getConfig = internalQuery({
  args: { businessId: v.id("businesses"), kind: kindValidator },
  returns: v.union(
    v.object({
      _id: v.id("integrations"),
      provider: providerValidator,
      config: v.any(),
      secretEnc: v.union(v.string(), v.null()),
      active: v.boolean(),
      health: v.union(v.literal("healthy"), v.literal("degraded"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { businessId, kind }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_business_kind", (q) =>
        q.eq("businessId", businessId).eq("kind", kind),
      )
      .first();
    if (!row) return null;
    return {
      _id: row._id,
      provider: row.provider,
      config: row.config,
      secretEnc: row.secretEnc ?? null,
      active: row.active,
      health: row.health ?? null,
    };
  },
});

/** Internal: active outbound CRM targets (for event dispatch). */
export const outboundTargets = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.array(
    v.object({
      _id: v.id("integrations"),
      provider: providerValidator,
      config: v.any(),
      secretEnc: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { businessId }) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_business_kind", (q) =>
        q.eq("businessId", businessId).eq("kind", "crmOutbound"),
      )
      .collect();
    return rows
      .filter((r) => r.active)
      .map((r) => ({
        _id: r._id,
        provider: r.provider,
        config: r.config,
        secretEnc: r.secretEnc ?? null,
      }));
  },
});

/** Internal: does the project have an active inbound lookup source? Gates the
 *  `lookup_customer` tool. */
export const hasActiveInbound = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.boolean(),
  handler: async (ctx, { businessId }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_business_kind", (q) =>
        q.eq("businessId", businessId).eq("kind", "crmInbound"),
      )
      .first();
    // A degraded inbound source can't answer lookups → treat as unavailable.
    return !!row && row.active && row.health !== "degraded";
  },
});

/** Internal: authorize (manager + module on) then upsert. Called by the Node
 *  `save` action with the secret already encrypted. Identity is forwarded from
 *  the action, so membership resolves here. */
export const saveConnection = internalMutation({
  args: {
    slug: v.string(),
    kind: kindValidator,
    provider: providerValidator,
    config: v.any(),
    secretEnc: v.optional(v.string()),
    active: v.boolean(),
  },
  returns: v.id("integrations"),
  handler: async (ctx, args) => {
    const business = await businessBySlug(ctx, args.slug);
    await requireInstallerAccess(ctx, business);
    const enabled = (await entitlementsFor(ctx, business._id)).integrationsEnabled;
    if (!enabled) {
      appError(
        "FORBIDDEN",
        "Enable the Integrations module to connect external systems.",
      );
    }
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_business_kind", (q) =>
        q.eq("businessId", business._id).eq("kind", args.kind),
      )
      .first();
    const fields = {
      businessId: business._id,
      kind: args.kind,
      provider: args.provider,
      config: args.config,
      active: args.active,
      verified: false,
      secretEnc: args.secretEnc ?? (existing ? existing.secretEnc : undefined),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("integrations", fields);
  },
});

/** Internal: authorize + resolve a connection's test target (endpoint + secret
 *  cipher) by id. Identity forwarded from the Node `test` action. */
export const testContext = internalQuery({
  args: { slug: v.string(), integrationId: v.id("integrations") },
  returns: v.union(
    v.object({
      url: v.union(v.string(), v.null()),
      secretEnc: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { slug, integrationId }) => {
    const business = await businessBySlug(ctx, slug);
    await requireInstallerAccess(ctx, business);
    const row = await ctx.db.get(integrationId);
    if (!row || row.businessId !== business._id) {
      appError("NOT_FOUND", "That integration no longer exists.");
    }
    const cfg = row.config as {
      url?: string;
      availabilityUrl?: string;
      bookingUrl?: string;
    };
    return {
      url: cfg.url ?? cfg.availabilityUrl ?? cfg.bookingUrl ?? null,
      secretEnc: row.secretEnc ?? null,
    };
  },
});

/** Internal: flip verified after a successful connection test. */
export const markTested = internalMutation({
  args: { integrationId: v.id("integrations"), ok: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { integrationId, ok }) => {
    await ctx.db.patch(integrationId, {
      verified: ok,
      lastTestedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { slug: v.string(), integrationId: v.id("integrations") },
  returns: v.null(),
  handler: async (ctx, { slug, integrationId }) => {
    const business = await businessBySlug(ctx, slug);
    await requireInstallerAccess(ctx, business);
    const row = await ctx.db.get(integrationId);
    if (!row || row.businessId !== business._id) {
      appError("NOT_FOUND", "That integration no longer exists.");
    }
    await ctx.db.delete(integrationId);
    return null;
  },
});
