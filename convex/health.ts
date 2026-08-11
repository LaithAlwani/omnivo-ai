import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// -----------------------------------------------------------------------------
// Connection health — the failure-first spine. A cron pings each active booking
// / inbound-CRM connection; N consecutive failures flip it to "degraded", which
// the provider layer reads to drop that connection's agent tools until it
// recovers (so the assistant hands off instead of hallucinating). The Node ping
// lives in integrationsNode.probeConnection; the DB writes live here.
// -----------------------------------------------------------------------------

/** Consecutive failed pings before a connection is marked degraded. */
export const HEALTH_FAILURE_THRESHOLD = 3;

/** Which connection kinds the agent actively depends on (and we probe). */
const PROBED_KINDS = ["booking", "crmInbound"] as const;

// --- Cron fan-out ------------------------------------------------------------

/** Tick: fan out to each business to probe its connections. */
export const enqueueChecks = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(1000);
    for (const b of businesses) {
      await ctx.scheduler.runAfter(0, internal.health.checkBusinessConnections, {
        businessId: b._id,
      });
    }
    return null;
  },
});

/** Per-business: probe each active booking / inbound connection. */
export const checkBusinessConnections = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    for (const row of rows) {
      if (!row.active) continue;
      if (!PROBED_KINDS.includes(row.kind as (typeof PROBED_KINDS)[number])) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.integrationsNode.probeConnection, {
        integrationId: row._id,
      });
    }
    return null;
  },
});

// --- Probe target + result ---------------------------------------------------

/** The endpoint + secret the Node probe needs (auth-free; cron is trusted). */
export const probeTarget = internalQuery({
  args: { integrationId: v.id("integrations") },
  returns: v.union(
    v.object({
      businessId: v.id("businesses"),
      kind: v.string(),
      url: v.union(v.string(), v.null()),
      secretEnc: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { integrationId }) => {
    const row = await ctx.db.get(integrationId);
    if (!row || !row.active) return null;
    const cfg = row.config as {
      url?: string;
      availabilityUrl?: string;
      bookingUrl?: string;
    };
    return {
      businessId: row.businessId,
      kind: row.kind,
      url: cfg.availabilityUrl ?? cfg.url ?? cfg.bookingUrl ?? null,
      secretEnc: row.secretEnc ?? null,
    };
  },
});

/** Record a probe result: append a check row, update the integration's health /
 *  streak, and report whether it *just* transitioned into "degraded" (so the
 *  caller can notify the owner exactly once). */
export const recordCheck = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    ok: v.boolean(),
    latencyMs: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.object({
    transitionedToDegraded: v.boolean(),
    businessName: v.optional(v.string()),
    kind: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
  }),
  handler: async (ctx, { integrationId, ok, latencyMs, error }) => {
    const now = Date.now();
    const integration = await ctx.db.get(integrationId);
    if (!integration) return { transitionedToDegraded: false };

    await ctx.db.insert("connectionChecks", {
      businessId: integration.businessId,
      integrationId,
      ts: now,
      ok,
      latencyMs,
      error,
    });

    const prevHealth = integration.health ?? "healthy";
    const streak = ok ? 0 : (integration.failureStreak ?? 0) + 1;
    const health: "healthy" | "degraded" =
      ok ? "healthy" : streak >= HEALTH_FAILURE_THRESHOLD ? "degraded" : prevHealth;

    await ctx.db.patch(integrationId, {
      health,
      failureStreak: streak,
      lastCheckedAt: now,
    });

    const transitionedToDegraded =
      prevHealth !== "degraded" && health === "degraded";
    if (!transitionedToDegraded) return { transitionedToDegraded: false };

    // Alert the responsible party: the installer for installer-managed tenants,
    // otherwise the business owner.
    const business = await ctx.db.get(integration.businessId);
    let alertUserId: Id<"users"> | null = null;
    if (business?.provisioning === "installer" && business.installerId) {
      alertUserId = business.installerId;
    } else {
      const owner = await ctx.db
        .query("memberships")
        .withIndex("by_business", (q) =>
          q.eq("businessId", integration.businessId),
        )
        .filter((q) => q.eq(q.field("role"), "owner"))
        .first();
      alertUserId = owner ? owner.userId : null;
    }
    const alertUser = alertUserId ? await ctx.db.get(alertUserId) : null;

    return {
      transitionedToDegraded: true,
      businessName: business?.name,
      kind: integration.kind,
      ownerEmail: alertUser?.email ?? undefined,
    };
  },
});
