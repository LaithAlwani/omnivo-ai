import type { BookingCapability } from "./types";

// -----------------------------------------------------------------------------
// The "native" (Managed) booking provider — Omnivo's own slots/bookings engine,
// the fallback for tenants with no external system of record. It's the smallest
// booking implementation that works: read availability, write a booking, cancel.
// The pure descriptor lives here; the IO delegates to the existing internal
// Convex functions (slots.getSlotsForBusiness / bookings.createForBusiness) via
// index.ts, so this stays a pure module.
// -----------------------------------------------------------------------------

export const NATIVE_BOOKING_CAPS: Set<BookingCapability> = new Set([
  "read",
  "write",
  "cancel",
]);
