import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { randomHex } from "../keys";
import { NATIVE_BOOKING_CAPS } from "./native";
import type {
  AvailabilityQuery,
  BookingCapability,
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

/** Pure decision: which booking provider (if any) is CONNECTED for a tenant —
 *  a webhook with usable endpoints (read = availabilityUrl, write = bookingUrl)
 *  wins; else the native Managed engine when the tenant has a natively bookable
 *  staff member; else null (no booking connection → booking tools drop out). */
export function decideBookingProvider(input: {
  integration: { provider: string; active: boolean; config: unknown } | null;
  nativeBookableStaff: number;
}): BookingProviderDescriptor | null {
  const { integration, nativeBookableStaff } = input;
  if (integration?.active && integration.provider === "webhook") {
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
  if (nativeBookableStaff > 0) {
    return { id: "native", caps: new Set(NATIVE_BOOKING_CAPS) };
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
  const staff = await ctx.runQuery(internal.staff.listBookableForBusiness, {
    businessId,
  });
  // Link-only staff (their own booking URL) can't take a native slot booking.
  const nativeBookableStaff = staff.filter((s) => !s.externalBookingUrl).length;
  return decideBookingProvider({
    integration: conn
      ? { provider: conn.provider, active: conn.active, config: conn.config }
      : null,
    nativeBookableStaff,
  });
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
  // A read-only provider never falls back to booking natively behind the user.
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
