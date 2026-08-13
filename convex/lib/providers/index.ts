import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type {
  AvailabilityQuery,
  BookingCapability,
  BookingInput,
  BookingProviderDescriptor,
  BookingResult,
  Slot,
} from "./types";
import { ladigitalBase } from "./ladigital";

// -----------------------------------------------------------------------------
// Provider resolution + dispatch — the ONE place an agent-invocable booking
// capability reaches an external system. Booking is CONNECTOR-ONLY: the tenant
// connects their own scheduler (the generic `webhook` provider). There is no
// native Managed booking engine — when nothing is connected the agent has no
// booking tools and hands off (capture_lead). External IO lives in
// `"use node"` actions (integrationsNode); this module stays pure dispatch.
// -----------------------------------------------------------------------------

/** Pure decision: the connected booking provider for a tenant, or null. A
 *  webhook with usable endpoints (read = availabilityUrl, write = bookingUrl)
 *  or a Cal.com connection (read+write, needs an event type + API key) wins; a
 *  degraded connection, a hand-off "link", or an unconfigured one → null, so the
 *  agent's booking tools drop out and it hands off. Named vendors slot in here
 *  as new `provider` branches — nothing else changes. */
export function decideBookingProvider(input: {
  integration: {
    provider: string;
    active: boolean;
    config: unknown;
    health?: "healthy" | "degraded" | null;
    hasSecret?: boolean;
  } | null;
}): BookingProviderDescriptor | null {
  const { integration } = input;
  if (!integration?.active) return null;
  // A degraded connection drops booking entirely — the agent hands off.
  if (integration.health === "degraded") return null;

  if (integration.provider === "webhook") {
    const cfg = (integration.config ?? {}) as {
      availabilityUrl?: string;
      bookingUrl?: string;
    };
    const caps = new Set<BookingCapability>();
    if (cfg.availabilityUrl) caps.add("read");
    if (cfg.bookingUrl) caps.add("write");
    return caps.size > 0 ? { id: "webhook", caps } : null;
  }

  if (integration.provider === "calcom") {
    const cfg = (integration.config ?? {}) as { eventTypeId?: number | string };
    // Cal.com reads slots + places bookings, but only with an event type + key.
    if (cfg.eventTypeId && integration.hasSecret) {
      return { id: "calcom", caps: new Set<BookingCapability>(["read", "write"]) };
    }
    return null;
  }

  if (integration.provider === "ladigital") {
    const cfg = (integration.config ?? {}) as { baseUrl?: string };
    // LA Digital's agent API reads slots + books, but needs the site URL + key.
    if (ladigitalBase({ baseUrl: cfg.baseUrl }) && integration.hasSecret) {
      return { id: "ladigital", caps: new Set<BookingCapability>(["read", "write"]) };
    }
    return null;
  }

  // "link" (and any other provider) is not tool-capable — hand-off only. The
  // scheduling link is surfaced to the agent separately (see bookingLinkFor).
  return null;
}

/** Resolve the connected booking provider for a tenant (null = none). */
export async function resolveBookingProvider(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
): Promise<BookingProviderDescriptor | null> {
  const conn = await ctx.runQuery(internal.integrations.getConfig, {
    businessId,
    kind: "booking",
  });
  return decideBookingProvider({
    integration: conn
      ? {
          provider: conn.provider,
          active: conn.active,
          config: conn.config,
          health: conn.health,
          hasSecret: conn.secretEnc != null,
        }
      : null,
  });
}

/** The tenant's hand-off booking link, if they connected one (a "link" booking
 *  provider). Surfaced in the prompt so the agent shares it when it can't book. */
export async function bookingLinkFor(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
): Promise<string | null> {
  const conn = await ctx.runQuery(internal.integrations.getConfig, {
    businessId,
    kind: "booking",
  });
  if (!conn || !conn.active || conn.provider !== "link") return null;
  const link = (conn.config as { schedulingLink?: string } | null)?.schedulingLink;
  return link && link.trim() ? link.trim() : null;
}

/** Read open times through the connected provider (empty when it can't answer). */
export async function getAvailability(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  provider: BookingProviderDescriptor,
  q: AvailabilityQuery,
): Promise<Slot[]> {
  if (!provider.caps.has("read")) return [];
  const via = await ctx.runAction(internal.integrationsNode.providerAvailability, {
    businessId,
    fromMs: q.fromMs,
    days: q.days,
    serviceName: q.serviceName,
    locationName: q.locationName,
  });
  return via.handled ? via.slots.map((start) => ({ start })) : [];
}

/** Place a booking through the connected provider (fails when it can't write). */
export async function createBooking(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  provider: BookingProviderDescriptor,
  input: BookingInput,
): Promise<BookingResult> {
  // A read-only provider can't place the booking — the agent hands off.
  if (!provider.caps.has("write")) {
    return { ok: false, reason: "read-only" };
  }
  const via = await ctx.runAction(internal.integrationsNode.providerCreateBooking, {
    businessId,
    startMs: input.startMs,
    serviceName: input.serviceName,
    staffName: input.staffName,
    locationName: input.locationName,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
  });
  if (via.handled) {
    return via.ok
      ? { ok: true, start: input.startMs }
      : { ok: false, reason: "scheduling-system" };
  }
  return { ok: false, reason: "scheduling-system" };
}

/** Capture a lead — always the native CRM write today (external CRM push is a
 *  fire-and-forget side effect inside captureForBusiness). */
export async function captureLead(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  input: { name: string; email?: string; phone?: string; message?: string },
): Promise<void> {
  await ctx.runMutation(internal.leads.captureForBusiness, {
    businessId,
    source: "assistant",
    name: input.name,
    email: input.email,
    phone: input.phone,
    message: input.message,
  });
}

/** Whether a returning-customer lookup is available (an active inbound CRM
 *  connection). This is a capability GRANTED by a live connection, not a flag. */
export async function lookupAvailable(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
): Promise<boolean> {
  return await ctx.runQuery(internal.integrations.hasActiveInbound, {
    businessId,
  });
}

/** Look a returning customer up through the connected inbound CRM. */
export async function lookupCustomer(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  by: { email?: string; phone?: string },
): Promise<string | null> {
  return await ctx.runAction(internal.integrationsNode.lookupCustomer, {
    businessId,
    email: by.email,
    phone: by.phone,
  });
}
