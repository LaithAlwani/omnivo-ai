// -----------------------------------------------------------------------------
// Provider contracts — the connector layer's spine. A booking capability the
// agent can invoke (availability, booking) resolves through a connected
// PROVIDER. Booking is connector-only: the generic `webhook` provider is the
// sole implementation (named vendors arrive as siblings later); there is no
// native fallback. These are pure types + capability sets; request shaping lives
// in the sibling pure modules (webhook.ts, …) and all external IO stays in
// `"use node"` actions, dispatched from index.ts.
// -----------------------------------------------------------------------------

/** What a booking provider can do. Partial vendors (link-only) omit `write`. */
export type BookingCapability = "read" | "write" | "cancel";

/** Which booking implementation is active for a tenant. */
export type BookingProviderId = "webhook" | "calcom" | "ladigital";

export interface BookingProviderDescriptor {
  id: BookingProviderId;
  caps: Set<BookingCapability>;
}

/** A normalized open time (ms since epoch). */
export interface Slot {
  start: number;
  end?: number;
}

/** Everything a provider needs to place a booking (webhook uses the names). */
export interface BookingInput {
  startMs: number;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}

export type BookingResult =
  | { ok: true; start: number }
  | { ok: false; reason: string };

/** Parameters for an availability read. */
export interface AvailabilityQuery {
  fromMs: number;
  days: number;
  serviceName?: string;
  locationName?: string;
}
