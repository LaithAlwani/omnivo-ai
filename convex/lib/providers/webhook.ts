// -----------------------------------------------------------------------------
// Generic webhook booking provider (pure). The tenant points Omnivo at two of
// their own endpoints; we shape the availability request and the booking payload
// and parse the response. The actual fetch happens in integrationsNode.ts. This
// is the first provider a self-serve tenant can configure alone (no Omnivo-held
// secret). Named vendors (Square/Calendly/…) become sibling modules in Phase G.
// -----------------------------------------------------------------------------

export type ProviderSlot = { start: number; end?: number };

export interface WebhookBookingConfig {
  /** GET here for open times. Receives ?from=<ms>&days=<n>&service=<name>. */
  availabilityUrl?: string;
  /** POST here to create a booking (JSON body: the booking details). */
  bookingUrl?: string;
}

/** Build the availability request URL with query params. */
export function availabilityRequest(
  config: WebhookBookingConfig,
  params: { fromMs: number; days: number; serviceName?: string; locationName?: string },
): string | null {
  if (!config.availabilityUrl) return null;
  const url = new URL(config.availabilityUrl);
  url.searchParams.set("from", String(params.fromMs));
  url.searchParams.set("days", String(params.days));
  if (params.serviceName) url.searchParams.set("service", params.serviceName);
  if (params.locationName) url.searchParams.set("location", params.locationName);
  return url.toString();
}

/** Parse a provider's availability response into normalized slots. Accepts
 *  either `[{start,end}]` or `{slots:[...]}`; `start` may be ms or ISO. */
export function parseSlots(body: unknown): ProviderSlot[] {
  const arr = Array.isArray(body)
    ? body
    : Array.isArray((body as { slots?: unknown })?.slots)
      ? (body as { slots: unknown[] }).slots
      : [];
  const slots: ProviderSlot[] = [];
  for (const item of arr) {
    const raw = item as { start?: unknown; end?: unknown };
    const start = toMs(raw.start);
    if (start == null) continue;
    const end = toMs(raw.end);
    slots.push(end != null ? { start, end } : { start });
  }
  return slots.sort((a, b) => a.start - b.start);
}

function toMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** The JSON body posted to the tenant's booking endpoint. */
export function bookingPayload(input: {
  startMs: number;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}): Record<string, unknown> {
  return {
    start: input.startMs,
    startIso: new Date(input.startMs).toISOString(),
    service: input.serviceName ?? null,
    staff: input.staffName ?? null,
    location: input.locationName ?? null,
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone ?? null,
    },
  };
}
