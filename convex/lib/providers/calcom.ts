// -----------------------------------------------------------------------------
// Cal.com booking provider (pure). Cal.com is a full booking system: the tenant
// connects an API key + an event-type id, and the assistant reads real open
// slots and places bookings in-chat. Request shaping + response parsing live
// here; the fetch happens in integrationsNode.ts. This is the reference "named
// adapter" — a new vendor is just a sibling module with these same functions.
//
// API: https://api.cal.com/v2 · auth = Bearer <apiKey> · every call needs a
// pinned `cal-api-version` header (versioned per endpoint by date).
// -----------------------------------------------------------------------------

export const CALCOM_API = "https://api.cal.com/v2";
// Pinned per-endpoint versions. Bump if Cal.com deprecates (they warn first).
export const CALCOM_VERSION_SLOTS = "2024-09-04";
export const CALCOM_VERSION_BOOKINGS = "2024-08-13";

export interface CalcomBookingConfig {
  /** The Cal.com event type to read/book against (a number; forms may store a
   *  string, so callers coerce). */
  eventTypeId?: number | string;
  /** Timezone reported for slots + the attendee (defaults to UTC). */
  timeZone?: string;
}

const DAY_MS = 86_400_000;

/** GET /v2/slots URL for a window, or null when the event type isn't set. */
export function calcomSlotsUrl(
  config: CalcomBookingConfig,
  q: { fromMs: number; days: number },
): string | null {
  if (!config.eventTypeId) return null;
  const params = new URLSearchParams({
    eventTypeId: String(config.eventTypeId),
    start: new Date(q.fromMs).toISOString(),
    end: new Date(q.fromMs + q.days * DAY_MS).toISOString(),
    timeZone: config.timeZone || "UTC",
  });
  return `${CALCOM_API}/slots?${params.toString()}`;
}

/** Normalize the slots response to sorted start-ms values. Defensive across API
 *  versions: `data` may be an object keyed by date or a flat array, and each
 *  entry may be `{ start }`, `{ time }`, or a bare ISO string. */
export function parseCalcomSlots(json: unknown): number[] {
  const root = json as { data?: unknown } | null;
  const data = root && typeof root === "object" && "data" in root ? root.data : json;
  const out: number[] = [];

  const push = (item: unknown) => {
    let raw: string | number | undefined;
    if (typeof item === "string" || typeof item === "number") raw = item;
    else if (item && typeof item === "object") {
      const o = item as { start?: unknown; time?: unknown };
      const v = o.start ?? o.time;
      if (typeof v === "string" || typeof v === "number") raw = v;
    }
    if (raw === undefined) return;
    const ms = typeof raw === "number" ? raw : Date.parse(raw);
    if (Number.isFinite(ms)) out.push(ms);
  };

  if (Array.isArray(data)) {
    data.forEach(push);
  } else if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    }
  }
  return out.sort((a, b) => a - b);
}

/** POST /v2/bookings body, or null when the event type isn't set. */
export function calcomBookingBody(
  input: { startMs: number; customerName: string; customerEmail: string },
  config: CalcomBookingConfig,
): Record<string, unknown> | null {
  if (!config.eventTypeId) return null;
  return {
    eventTypeId: Number(config.eventTypeId),
    start: new Date(input.startMs).toISOString(),
    attendee: {
      name: input.customerName,
      email: input.customerEmail,
      timeZone: config.timeZone || "UTC",
    },
  };
}

/** Whether a create-booking response indicates success (2xx + status ok). */
export function calcomBookingOk(status: number, json: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  const s = (json as { status?: unknown } | null)?.status;
  return s === undefined || s === "success";
}
