// -----------------------------------------------------------------------------
// LA Digital booking + CRM provider (pure). LA Digital client sites ship a
// shared agent API (@ladigital/agent-api) served at `/api/agent/*` on the
// client's own domain, guarded by that client's AGENT_API_KEY. The assistant
// reads real open slots, places bookings, and pushes captured leads into the
// client's CRM — all with one setup: the site URL + the agent key.
//
// Contract (times are epoch ms, UTC; auth = Bearer <AGENT_API_KEY>):
//   GET  {base}/api/agent/availability -> { ok, days:[{ slots:[{ startUtc }] }] }
//   POST {base}/api/agent/bookings      body { name, email, startUtc, phone? }
//   POST {base}/api/agent/leads         body { name, email?, phone?, notes? }
//
// This is a named adapter (like calcom.ts): request shaping + response parsing
// live here; the fetch happens in integrationsNode.ts. Because every LA Digital
// client exposes the same contract, this one file connects them all.
// -----------------------------------------------------------------------------

export interface LadigitalConfig {
  /** The client's site origin (e.g. https://acme.ladigital.ca). Endpoints are
   *  derived from it; the agent key is the connection secret. */
  baseUrl?: string;
}

/** Normalize the configured site URL to an origin(+path) with no trailing slash,
 *  or null when it's missing/invalid. */
export function ladigitalBase(config: LadigitalConfig): string | null {
  const raw = config.baseUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

export function ladigitalAvailabilityUrl(config: LadigitalConfig): string | null {
  const base = ladigitalBase(config);
  return base ? `${base}/api/agent/availability` : null;
}

export function ladigitalBookingUrl(config: LadigitalConfig): string | null {
  const base = ladigitalBase(config);
  return base ? `${base}/api/agent/bookings` : null;
}

export function ladigitalLeadsUrl(config: LadigitalConfig): string | null {
  const base = ladigitalBase(config);
  return base ? `${base}/api/agent/leads` : null;
}

/** Flatten the `{ days:[{ slots:[{ startUtc }] }] }` availability response into
 *  sorted start-ms values. Defensive across shapes: also accepts a top-level
 *  `slots` array, a bare array of days, and `start`/`time` on a slot. */
export function parseLadigitalSlots(json: unknown): number[] {
  const root = (json ?? {}) as { days?: unknown; slots?: unknown };
  const out: number[] = [];

  const pushSlot = (s: unknown) => {
    if (typeof s === "number") {
      if (Number.isFinite(s)) out.push(s);
      return;
    }
    if (s && typeof s === "object") {
      const o = s as { startUtc?: unknown; start?: unknown; time?: unknown };
      const v = o.startUtc ?? o.start ?? o.time;
      const ms =
        typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
      if (Number.isFinite(ms)) out.push(ms);
    }
  };
  const pushDay = (d: unknown) => {
    if (Array.isArray(d)) {
      d.forEach(pushSlot);
      return;
    }
    if (d && typeof d === "object") {
      const slots = (d as { slots?: unknown }).slots;
      if (Array.isArray(slots)) slots.forEach(pushSlot);
    }
  };

  if (Array.isArray(root.days)) root.days.forEach(pushDay);
  else if (Array.isArray(root.slots)) root.slots.forEach(pushSlot);
  else if (Array.isArray(json)) (json as unknown[]).forEach(pushDay);
  return out.sort((a, b) => a - b);
}

/** The JSON body posted to POST /api/agent/bookings (flat name/email/startUtc). */
export function ladigitalBookingBody(input: {
  startMs: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}): Record<string, unknown> {
  return {
    name: input.customerName,
    email: input.customerEmail,
    startUtc: input.startMs,
    phone: input.customerPhone ?? undefined,
  };
}

/** Whether a create-booking response indicates success (2xx + not { ok:false }). */
export function ladigitalBookingOk(status: number, json: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  const ok = (json as { ok?: unknown } | null)?.ok;
  return ok !== false;
}

/** Map an internal `lead.created` event's data to the flat body POST
 *  /api/agent/leads expects (`name` is required there; message → notes). */
export function ladigitalLeadBody(data: unknown): Record<string, unknown> {
  const d = (data ?? {}) as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    company?: unknown;
    message?: unknown;
  };
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    name: str(d.name) ?? "Unknown",
    email: str(d.email),
    phone: str(d.phone),
    company: str(d.company),
    notes: str(d.message),
  };
}
