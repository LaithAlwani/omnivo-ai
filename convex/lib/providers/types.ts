import type { Id } from "../../_generated/dataModel";

// -----------------------------------------------------------------------------
// Provider contracts — the connector layer's spine. A capability the agent can
// invoke (availability, booking, lookup) resolves through a PROVIDER, of which
// `native` (the Managed fallback) is one implementation among several. These are
// pure types + capability sets; request shaping lives in the sibling pure
// modules (webhook.ts, …) and all external IO stays in `"use node"` actions,
// dispatched from index.ts. No call site outside this folder should reach a
// domain table or a vendor API for an agent-invocable capability.
// -----------------------------------------------------------------------------

/** What a booking provider can do. Partial vendors (link-only) omit `write`. */
export type BookingCapability = "read" | "write" | "cancel";

/** Which booking implementation is active for a tenant. */
export type BookingProviderId = "native" | "webhook";

export interface BookingProviderDescriptor {
  id: BookingProviderId;
  caps: Set<BookingCapability>;
}

/** A normalized open time (ms since epoch). */
export interface Slot {
  start: number;
  end?: number;
}

/** Everything a provider needs to place a booking. Native uses the resolved ids;
 *  webhook uses the human-readable names. */
export interface BookingInput {
  startMs: number;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
  serviceId?: Id<"services">;
  staffId?: Id<"staff">;
  locationId?: Id<"locations">;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}

export type BookingResult =
  | { ok: true; start: number; staffId?: Id<"staff"> }
  | { ok: false; reason: string };

/** Parameters for an availability read. */
export interface AvailabilityQuery {
  fromMs: number;
  days: number;
  serviceName?: string;
  locationName?: string;
  serviceId?: Id<"services">;
  staffId?: Id<"staff"> | "any";
  locationId?: Id<"locations">;
}
