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

// -----------------------------------------------------------------------------
// Provider resolution + dispatch — the ONE place an agent-invocable booking
// capability reaches an external system. Booking is CONNECTOR-ONLY: the tenant
// connects their own scheduler (the generic `webhook` provider). There is no
// native Managed booking engine — when nothing is connected the agent has no
// booking tools and hands off (capture_lead). External IO lives in
// `"use node"` actions (integrationsNode); this module stays pure dispatch.
// -----------------------------------------------------------------------------

/** Pure decision: the connected booking provider for a tenant, or null. A
 *  webhook with usable endpoints wins (read = availabilityUrl, write =
 *  bookingUrl); a degraded connection or one with no usable endpoints → null,
 *  so the agent's booking tools drop out and it hands off. */
export function decideBookingProvider(input: {
  integration: {
    provider: string;
    active: boolean;
    config: unknown;
    health?: "healthy" | "degraded" | null;
  } | null;
}): BookingProviderDescriptor | null {
  const { integration } = input;
  if (integration?.active && integration.provider === "webhook") {
    // A degraded connection drops booking entirely — the agent hands off.
    if (integration.health === "degraded") return null;
    const cfg = (integration.config ?? {}) as {
      availabilityUrl?: string;
      bookingUrl?: string;
    };
    const caps = new Set<BookingCapability>();
    if (cfg.availabilityUrl) caps.add("read");
    if (cfg.bookingUrl) caps.add("write");
    if (caps.size > 0) return { id: "webhook", caps };
    // Connected but no usable endpoints → treat as not connected.
  }
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
        }
      : null,
  });
}

/** Read open times through the connected provider (empty when it can't answer). */
export async function getAvailability(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  provider: BookingProviderDescriptor,
  q: AvailabilityQuery,
): Promise<Slot[]> {
  if (provider.id === "webhook") {
    const via = await ctx.runAction(internal.integrationsNode.webhookAvailability, {
      businessId,
      fromMs: q.fromMs,
      days: q.days,
      serviceName: q.serviceName,
      locationName: q.locationName,
    });
    if (via.handled) return via.slots.map((start) => ({ start }));
  }
  return [];
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
  if (provider.id === "webhook") {
    const via = await ctx.runAction(
      internal.integrationsNode.webhookCreateBooking,
      {
        businessId,
        startMs: input.startMs,
        serviceName: input.serviceName,
        staffName: input.staffName,
        locationName: input.locationName,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
      },
    );
    if (via.handled) {
      return via.ok
        ? { ok: true, start: input.startMs }
        : { ok: false, reason: "scheduling-system" };
    }
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
