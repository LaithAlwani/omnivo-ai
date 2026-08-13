"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "./lib/secretsNode";
import { kindValidator, providerValidator } from "./integrations";
import {
  availabilityRequest,
  parseSlots,
  bookingPayload,
  type WebhookBookingConfig,
} from "./lib/providers/webhook";
import {
  CALCOM_API,
  CALCOM_VERSION_SLOTS,
  CALCOM_VERSION_BOOKINGS,
  calcomSlotsUrl,
  parseCalcomSlots,
  calcomBookingBody,
  calcomBookingOk,
  type CalcomBookingConfig,
} from "./lib/providers/calcom";
import {
  ladigitalAvailabilityUrl,
  ladigitalBookingUrl,
  ladigitalBookingBody,
  ladigitalBookingOk,
  ladigitalLeadsUrl,
  ladigitalLeadBody,
  ladigitalContactsUrl,
  parseLadigitalSlots,
  type LadigitalConfig,
} from "./lib/providers/ladigital";

// -----------------------------------------------------------------------------
// Integrations (Node runtime) — encryption, connection tests, outbound event
// dispatch, inbound customer lookup, and webhook booking-provider calls. Reads
// storage via internal.integrations.*; never persists a plaintext secret.
// -----------------------------------------------------------------------------

const TIMEOUT_MS = 8000;

/** Sign a request body so the tenant's endpoint can verify it's from us. */
function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function fetchJson(
  url: string,
  init: RequestInit & { secret?: string | null; body?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.secret) {
      headers["Authorization"] = `Bearer ${init.secret}`;
      if (init.body) headers["X-Omnivo-Signature"] = sign(init.body, init.secret);
    }
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Classify a connection test/probe response into pass/fail + a readable line.
 *  A working connection answers 2xx. Auth failures (401/403) and a missing
 *  endpoint (404) are DOWN — the agent can't actually use the connection — not
 *  "reachable". 405 means the endpoint exists but doesn't take GET (e.g. a
 *  POST-only webhook), which still counts as reachable. Shared by the manual
 *  Test button and the health cron so they agree. */
function classifyStatus(status: number): { ok: boolean; detail: string } {
  if (status >= 200 && status < 300) {
    return { ok: true, detail: `Connected (HTTP ${status}).` };
  }
  if (status === 405) {
    return { ok: true, detail: `Reachable (HTTP ${status}).` };
  }
  if (status === 401 || status === 403) {
    return { ok: false, detail: `Unauthorized — check the API key (HTTP ${status}).` };
  }
  if (status === 404) {
    return { ok: false, detail: `Not found — check the URL (HTTP ${status}).` };
  }
  if (status >= 500) {
    return { ok: false, detail: `Server error (HTTP ${status}).` };
  }
  return { ok: false, detail: `HTTP ${status}.` };
}

// --- Save + test ------------------------------------------------------------

/** Save a connection (manager + Integrations module gated). The secret is
 *  encrypted here before it's stored; omit it to keep the existing one. */
export const save = action({
  args: {
    slug: v.string(),
    kind: kindValidator,
    provider: providerValidator,
    config: v.any(),
    secret: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  returns: v.id("integrations"),
  handler: async (ctx, args): Promise<Id<"integrations">> => {
    const secretEnc =
      args.secret && args.secret.trim()
        ? encryptSecret(args.secret.trim())
        : undefined;
    return await ctx.runMutation(internal.integrations.saveConnection, {
      slug: args.slug,
      kind: args.kind,
      provider: args.provider,
      config: args.config,
      secretEnc,
      active: args.active ?? true,
    });
  },
});

/** Test a connection by pinging its endpoint; flips `verified` on success. */
export const test = action({
  args: { slug: v.string(), integrationId: v.id("integrations") },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (
    ctx,
    { slug, integrationId },
  ): Promise<{ ok: boolean; detail: string }> => {
    const target = await ctx.runQuery(internal.integrations.testContext, {
      slug,
      integrationId,
    });
    if (!target || !target.url) {
      return { ok: false, detail: "No endpoint URL configured." };
    }
    const secret = target.secretEnc ? decryptSecret(target.secretEnc) : null;
    let ok = false;
    let detail = "";
    try {
      const res = await fetchJson(target.url, { method: "GET", secret });
      ({ ok, detail } = classifyStatus(res.status));
    } catch (e) {
      detail = e instanceof Error ? e.message : "Request failed.";
    }
    await ctx.runMutation(internal.integrations.markTested, {
      integrationId,
      ok,
    });
    return { ok, detail };
  },
});

// --- Health probe -----------------------------------------------------------

/** Ping one connection and record its health (scheduled by the health cron).
 *  Reachability only: any HTTP response < 500 = up; timeout/network/5xx = down.
 *  On a healthy→degraded transition, alert the owner. */
export const probeConnection = internalAction({
  args: { integrationId: v.id("integrations") },
  returns: v.null(),
  handler: async (ctx, { integrationId }): Promise<null> => {
    const target = await ctx.runQuery(internal.health.probeTarget, {
      integrationId,
    });
    if (!target || !target.url) return null;
    const secret = target.secretEnc ? decryptSecret(target.secretEnc) : null;

    const started = Date.now();
    let ok = false;
    let error: string | undefined;
    try {
      const res = await fetchJson(target.url, { method: "GET", secret });
      const c = classifyStatus(res.status);
      ok = c.ok;
      if (!ok) error = c.detail;
    } catch (e) {
      error = e instanceof Error ? e.message : "Request failed";
    }
    const latencyMs = Date.now() - started;

    const result = await ctx.runMutation(internal.health.recordCheck, {
      integrationId,
      ok,
      latencyMs,
      error,
    });
    if (result.transitionedToDegraded && result.ownerEmail) {
      await ctx.scheduler.runAfter(
        0,
        internal.emailNode.sendConnectionDegraded,
        {
          to: result.ownerEmail,
          businessName: result.businessName ?? "your business",
          kind: result.kind ?? "connection",
          error: error ?? "unreachable",
        },
      );
    }
    return null;
  },
});

// --- Outbound dispatch ------------------------------------------------------

/** Push a domain event to each active outbound CRM target. Best-effort: a
 *  failing target is logged and skipped, never blocking the caller. */
export const dispatch = internalAction({
  args: {
    businessId: v.id("businesses"),
    event: v.object({
      type: v.string(), // "lead.created" | "booking.created" | "review.responded"
      data: v.any(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { businessId, event }): Promise<null> => {
    const targets = await ctx.runQuery(internal.integrations.outboundTargets, {
      businessId,
    });
    for (const t of targets) {
      const secret = t.secretEnc ? decryptSecret(t.secretEnc) : null;

      // LA Digital's CRM ingests captured leads only, in a flat shape at
      // /api/agent/leads — translate rather than posting the generic envelope.
      if (t.provider === "ladigital") {
        if (event.type !== "lead.created") continue;
        const url = ladigitalLeadsUrl(t.config as LadigitalConfig);
        if (!url) continue;
        const body = JSON.stringify(ladigitalLeadBody(event.data));
        try {
          await fetchJson(url, { method: "POST", body, secret });
        } catch (e) {
          console.error(`[integrations] ladigital lead dispatch failed`, e);
        }
        continue;
      }

      const url = (t.config as { url?: string })?.url;
      if (!url) continue;
      const body = JSON.stringify({ event: event.type, data: event.data });
      try {
        await fetchJson(url, { method: "POST", body, secret });
      } catch (e) {
        console.error(`[integrations] dispatch to ${url} failed`, e);
      }
    }
    return null;
  },
});

// --- Inbound lookup ---------------------------------------------------------

/** Look a returning customer up in the tenant's own system by email/phone.
 *  Returns a compact profile the assistant can use to personalize. */
export const lookupCustomer = internalAction({
  args: {
    businessId: v.id("businesses"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { businessId, email, phone }): Promise<string | null> => {
    const conn = await ctx.runQuery(internal.integrations.getConfig, {
      businessId,
      kind: "crmInbound",
    });
    if (!conn || !conn.active) return null;
    // Named adapter (LA Digital) derives its lookup endpoint from the site URL;
    // the generic webhook takes an explicit `url`.
    const base =
      conn.provider === "ladigital"
        ? ladigitalContactsUrl(conn.config as LadigitalConfig)
        : (conn.config as { url?: string })?.url;
    if (!base) return null;
    const secret = conn.secretEnc ? decryptSecret(conn.secretEnc) : null;
    const url = new URL(base);
    if (email) url.searchParams.set("email", email);
    if (phone) url.searchParams.set("phone", phone);
    try {
      const { ok, json } = await fetchJson(url.toString(), {
        method: "GET",
        secret,
      });
      if (!ok || !json) return null;
      // Return a short JSON string; the model reads it as tool output.
      return JSON.stringify(json).slice(0, 800);
    } catch (e) {
      console.error("[integrations] lookupCustomer failed", e);
      return null;
    }
  },
});

// --- Booking providers (webhook + named adapters) --------------------------

/** Read availability through the tenant's connected booking provider. Returns
 *  handled=false when there's no usable provider (the caller then hands off). A
 *  new vendor is a new `provider` branch — the fetch/secret plumbing is shared. */
export const providerAvailability = internalAction({
  args: {
    businessId: v.id("businesses"),
    fromMs: v.number(),
    days: v.number(),
    serviceName: v.optional(v.string()),
    locationName: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ handled: v.literal(true), slots: v.array(v.number()) }),
    v.object({ handled: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const conn = await ctx.runQuery(internal.integrations.getConfig, {
      businessId: args.businessId,
      kind: "booking",
    });
    if (!conn || !conn.active) return { handled: false as const };
    const secret = conn.secretEnc ? decryptSecret(conn.secretEnc) : null;

    if (conn.provider === "webhook") {
      const url = availabilityRequest(conn.config as WebhookBookingConfig, {
        fromMs: args.fromMs,
        days: args.days,
        serviceName: args.serviceName,
        locationName: args.locationName,
      });
      if (!url) return { handled: false as const };
      try {
        const { ok, json } = await fetchJson(url, { method: "GET", secret });
        if (!ok) return { handled: true as const, slots: [] };
        return { handled: true as const, slots: parseSlots(json).map((s) => s.start) };
      } catch {
        return { handled: true as const, slots: [] };
      }
    }

    if (conn.provider === "calcom") {
      const url = calcomSlotsUrl(conn.config as CalcomBookingConfig, {
        fromMs: args.fromMs,
        days: args.days,
      });
      if (!url) return { handled: false as const };
      try {
        const { ok, json } = await fetchJson(url, {
          method: "GET",
          secret,
          headers: { "cal-api-version": CALCOM_VERSION_SLOTS },
        });
        if (!ok) return { handled: true as const, slots: [] };
        return { handled: true as const, slots: parseCalcomSlots(json) };
      } catch {
        return { handled: true as const, slots: [] };
      }
    }

    if (conn.provider === "ladigital") {
      const url = ladigitalAvailabilityUrl(conn.config as LadigitalConfig);
      if (!url) return { handled: false as const };
      try {
        const { ok, json } = await fetchJson(url, { method: "GET", secret });
        if (!ok) return { handled: true as const, slots: [] };
        return { handled: true as const, slots: parseLadigitalSlots(json) };
      } catch {
        return { handled: true as const, slots: [] };
      }
    }

    return { handled: false as const };
  },
});

/** Place a booking through the tenant's connected booking provider. Returns
 *  handled=false when there's no write-capable provider (caller hands off). */
export const providerCreateBooking = internalAction({
  args: {
    businessId: v.id("businesses"),
    startMs: v.number(),
    serviceName: v.optional(v.string()),
    staffName: v.optional(v.string()),
    locationName: v.optional(v.string()),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ handled: v.literal(true), ok: v.boolean() }),
    v.object({ handled: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const conn = await ctx.runQuery(internal.integrations.getConfig, {
      businessId: args.businessId,
      kind: "booking",
    });
    if (!conn || !conn.active) return { handled: false as const };
    const secret = conn.secretEnc ? decryptSecret(conn.secretEnc) : null;

    if (conn.provider === "webhook") {
      const config = conn.config as WebhookBookingConfig;
      if (!config.bookingUrl) return { handled: false as const };
      const body = JSON.stringify(bookingPayload(args));
      try {
        const { ok } = await fetchJson(config.bookingUrl, {
          method: "POST",
          body,
          secret,
        });
        return { handled: true as const, ok };
      } catch {
        return { handled: true as const, ok: false };
      }
    }

    if (conn.provider === "calcom") {
      const payload = calcomBookingBody(
        {
          startMs: args.startMs,
          customerName: args.customerName,
          customerEmail: args.customerEmail,
        },
        conn.config as CalcomBookingConfig,
      );
      if (!payload) return { handled: false as const };
      try {
        const { status, json } = await fetchJson(`${CALCOM_API}/bookings`, {
          method: "POST",
          body: JSON.stringify(payload),
          secret,
          headers: { "cal-api-version": CALCOM_VERSION_BOOKINGS },
        });
        return { handled: true as const, ok: calcomBookingOk(status, json) };
      } catch {
        return { handled: true as const, ok: false };
      }
    }

    if (conn.provider === "ladigital") {
      const url = ladigitalBookingUrl(conn.config as LadigitalConfig);
      if (!url) return { handled: false as const };
      const body = JSON.stringify(
        ladigitalBookingBody({
          startMs: args.startMs,
          customerName: args.customerName,
          customerEmail: args.customerEmail,
          customerPhone: args.customerPhone,
        }),
      );
      try {
        const { status, json } = await fetchJson(url, {
          method: "POST",
          body,
          secret,
        });
        return { handled: true as const, ok: ladigitalBookingOk(status, json) };
      } catch {
        return { handled: true as const, ok: false };
      }
    }

    return { handled: false as const };
  },
});
