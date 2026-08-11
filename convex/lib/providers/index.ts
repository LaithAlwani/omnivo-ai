import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { randomHex } from "../keys";
import { NATIVE_BOOKING_CAPS } from "./native";
import { WEBHOOK_BOOKING_CAPS } from "./webhook";
import type {
  AvailabilityQuery,
  BookingInput,
  BookingProviderDescriptor,
  BookingResult,
  Slot,
} from "./types";

// -----------------------------------------------------------------------------
// Provider resolution + dispatch — the ONE place an agent-invocable capability
// reaches an external system or a domain table. Callers (assistantTools) resolve
// a provider descriptor, then invoke these helpers; the native-vs-connected
// decision and all IO routing live here. External IO (webhook/CRM fetch) is in
// `"use node"` actions; native reads/writes go through existing internal Convex
// functions. A misconfigured connected provider transparently falls back to
// native, preserving today's behaviour (Phase B tightens this).
// -----------------------------------------------------------------------------

/** Which booking provider is active for a tenant: a connected webhook, else the
 *  native Managed engine. */
export async function resolveBookingProvider(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
): Promise<BookingProviderDescriptor> {
  const conn = await ctx.runQuery(internal.integrations.getConfig, {
    businessId,
    kind: "booking",
  });
  if (conn?.active && conn.provider === "webhook") {
    return { id: "webhook", caps: WEBHOOK_BOOKING_CAPS };
  }
  return { id: "native", caps: NATIVE_BOOKING_CAPS };
}

/** Read open times through the resolved provider (falls back to native when a
 *  connected provider is present but can't answer). */
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
    // Provider active but unconfigured for availability → native.
  }
  return await ctx.runQuery(internal.slots.getSlotsForBusiness, {
    businessId,
    staffId: q.staffId ?? "any",
    fromMs: q.fromMs,
    days: q.days,
    serviceId: q.serviceId,
    locationId: q.locationId,
  });
}

/** Place a booking through the resolved provider (falls back to native when a
 *  connected provider can't take the write). */
export async function createBooking(
  ctx: ActionCtx,
  businessId: Id<"businesses">,
  provider: BookingProviderDescriptor,
  input: BookingInput,
): Promise<BookingResult> {
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
    // Provider active but unconfigured for booking → native.
  }
  const res = await ctx.runMutation(internal.bookings.createForBusiness, {
    businessId,
    staffId: input.staffId ?? "any",
    start: input.startMs,
    serviceId: input.serviceId,
    locationId: input.locationId,
    source: "assistant",
    cancelToken: randomHex(16),
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
  });
  return { ok: true, start: res.start, staffId: res.staffId };
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
