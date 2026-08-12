import type Anthropic from "@anthropic-ai/sdk";

// -----------------------------------------------------------------------------
// Capability registry — the modular skill system for the single AI Employee.
//
// A project enables MODULES (entitlements); each module grants CAPABILITIES; the
// orchestrator assembles the model's tools + prompt fragments from the union of
// enabled capabilities. Nothing about features is hardcoded into the agent — it
// only ever sees the tools/instructions the tenant has activated.
//
// Pure module (types + data only, no Convex/Node imports) so it's shared by the
// Node chat action, the default-runtime tool executor, entitlements, and the
// dashboard alike. The Anthropic import is type-only (erased at build).
// -----------------------------------------------------------------------------

// Connector-era modules. `integrations` (connect the client's own booking/CRM)
// is the spine; `booking`/`leadQualification` cover the Managed/native fallback
// and lead capture. Reviews/Sales/SMS-automation were native-only and removed —
// they'll return as provider adapters if a real install needs them.
export const MODULE_KEYS = [
  "booking",
  "leadQualification",
  "integrations",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type Entitlements = Record<`${ModuleKey}Enabled`, boolean>;

export const DEFAULT_ENTITLEMENTS: Entitlements = {
  bookingEnabled: false,
  leadQualificationEnabled: false,
  integrationsEnabled: false,
};

/** Marketing/dashboard metadata for each add-on module. `price` is USD/mo. */
export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  blurb: string;
  grants: string;
}

// Capabilities are framed around CONNECTIONS: connecting the client's booking
// system / CRM is the product; the native engine is the "Managed" fallback.
export const MODULE_CATALOG: ModuleInfo[] = [
  {
    key: "booking",
    name: "Booking",
    blurb: "Book into the client's own scheduler, or Omnivo's Managed calendar.",
    grants: "Availability + booking tools (connected provider or Managed).",
  },
  {
    key: "leadQualification",
    name: "Lead Capture & Qualification",
    blurb: "Ask qualifying questions and capture richer, scored leads.",
    grants: "Qualification questions, intent detection, owner notifications.",
  },
  {
    key: "integrations",
    name: "Connections",
    blurb: "Connect the client's booking system, CRM, and calendar.",
    grants: "Booking provider + CRM sync (outbound) + customer lookup (inbound).",
  },
];

// --- Capabilities -----------------------------------------------------------

// `availability` = read open times; `booking` = place a booking (write). A
// read-only provider (e.g. a link-only calendar) grants `availability` but not
// `booking`, so the agent offers times + a hand-off, never a write tool.
export type Capability = "availability" | "booking" | "qualification" | "lookup";

/** Live-connection summary for a tenant: a module flag is *permission*, these
 *  are the *grants*. Both are required for a capability. */
export interface AgentConnections {
  /** A booking provider that can read availability is connected. */
  bookingRead: boolean;
  /** A booking provider that can place bookings is connected. */
  bookingWrite: boolean;
  /** An inbound CRM the agent can look customers up in is connected. */
  lookup: boolean;
}

/** The capabilities a tenant's agent actually has: the intersection of its
 *  module permissions (flags) and its live connections (grants). */
export function capabilitiesFor(
  e: Entitlements,
  conns: AgentConnections,
): Set<Capability> {
  const caps = new Set<Capability>();
  if (e.bookingEnabled && conns.bookingRead) caps.add("availability");
  if (e.bookingEnabled && conns.bookingWrite) caps.add("booking");
  // Lead capture/qualification is native and always available with the flag.
  if (e.leadQualificationEnabled) caps.add("qualification");
  if (e.integrationsEnabled && conns.lookup) caps.add("lookup");
  return caps;
}

// --- Tools ------------------------------------------------------------------

const LIST_SERVICES: Anthropic.Tool = {
  name: "list_services",
  description: "List the bookable services with their durations and prices.",
  input_schema: { type: "object", properties: {} },
};

const CAPTURE_LEAD: Anthropic.Tool = {
  name: "capture_lead",
  description:
    "Save a visitor's contact details so the team can follow up when they aren't ready to book.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      message: { type: "string" },
    },
    required: ["name"],
  },
};

const CHECK_AVAILABILITY: Anthropic.Tool = {
  name: "check_availability",
  description:
    "Find open appointment times. Optionally narrow by service, staff name, and/or location. Returns times with a startMs value to book.",
  input_schema: {
    type: "object",
    properties: {
      serviceName: { type: "string" },
      staffName: { type: "string" },
      locationName: { type: "string" },
      daysAhead: {
        type: "number",
        description: "How many days ahead to search (default 14).",
      },
    },
  },
};

const BOOK_APPOINTMENT: Anthropic.Tool = {
  name: "book_appointment",
  description:
    "Book an appointment. Use a startMs value returned by check_availability — never invent one. Requires the customer's name and email.",
  input_schema: {
    type: "object",
    properties: {
      startMs: { type: "number" },
      serviceName: { type: "string" },
      staffName: { type: "string" },
      locationName: { type: "string" },
      customerName: { type: "string" },
      customerEmail: { type: "string" },
      customerPhone: { type: "string" },
    },
    required: ["startMs", "customerName", "customerEmail"],
  },
};

const LOOKUP_CUSTOMER: Anthropic.Tool = {
  name: "lookup_customer",
  description:
    "Look up a returning customer in the business's own records by email or phone, to personalize the conversation. Only use when the visitor has given a contact detail.",
  input_schema: {
    type: "object",
    properties: {
      email: { type: "string" },
      phone: { type: "string" },
    },
  },
};

/** Every tool → the capability it requires (null = core, always available). */
export const TOOL_CAPABILITY: Record<string, Capability | null> = {
  list_services: null,
  capture_lead: null,
  check_availability: "availability",
  book_appointment: "booking",
  lookup_customer: "lookup",
};

/** The tools the model may use given the enabled capabilities. */
export function toolsFor(caps: Set<Capability>): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [LIST_SERVICES, CAPTURE_LEAD];
  if (caps.has("availability")) tools.push(CHECK_AVAILABILITY);
  if (caps.has("booking")) tools.push(BOOK_APPOINTMENT);
  if (caps.has("lookup")) tools.push(LOOKUP_CUSTOMER);
  return tools;
}

/** True when a tool may run under the given capabilities (execution re-check). */
export function toolAllowed(name: string, caps: Set<Capability>): boolean {
  const required = TOOL_CAPABILITY[name];
  if (required === undefined) return false; // unknown tool
  if (required === null) return true; // core
  return caps.has(required);
}

// --- Prompt fragments -------------------------------------------------------

export interface PromptContext {
  timezone?: string | null;
  nowIso: string;
  /** Where bookings land, so the assistant can say so honestly. */
  bookingSystem?: "external" | "native" | null;
}

/** Instruction fragments appended to the base system prompt, one per active
 *  capability, so the model knows how to use the tools it's been given. */
export function promptFragments(
  caps: Set<Capability>,
  { timezone, nowIso, bookingSystem }: PromptContext,
): string[] {
  const fragments: string[] = [];

  const tzLine = timezone
    ? `The business timezone is ${timezone}; read dates like "next Tuesday" in that zone.`
    : "Interpret times in UTC.";
  const wherePlaced =
    bookingSystem === "external"
      ? "Bookings are placed directly in the business's own scheduling system."
      : "Bookings are placed in the business's Omnivo calendar.";

  if (caps.has("booking")) {
    // Full booking: read availability + place the booking.
    fragments.push(
      [
        "You can take bookings using your tools.",
        wherePlaced,
        tzLine,
        `The current time is ${nowIso}.`,
        "To book: call check_availability, offer the visitor the returned times, then call book_appointment with the exact startMs they pick plus their name and email. Only ever book a startMs that check_availability returned.",
        "If the business has more than one location, ask which they'd prefer and pass locationName so you offer times at the right site.",
      ].join(" "),
    );
  } else if (caps.has("availability")) {
    // Read-only provider: show times, then hand off — you can't place the booking.
    fragments.push(
      [
        "You can show open appointment times with check_availability, but you cannot place the booking yourself.",
        tzLine,
        `The current time is ${nowIso}.`,
        "Offer the returned times, then capture the visitor's name and contact with capture_lead (or share the business's booking link if given) so the team confirms it. Never claim you've booked anything.",
      ].join(" "),
    );
  } else {
    // No booking capability at all — don't imply the assistant can schedule.
    fragments.push(
      "You cannot book appointments directly. If a visitor wants to book, capture their details with capture_lead so the team can arrange it.",
    );
  }

  if (caps.has("qualification")) {
    fragments.push(
      "When a visitor shows interest, ask a couple of brief qualifying questions (what they need, timeframe, budget if relevant) before capturing the lead, so the team can prioritize. Always capture the lead with capture_lead once you have their name and a way to reach them.",
    );
  } else {
    fragments.push(
      "If a visitor wants a follow-up, capture their details with capture_lead.",
    );
  }

  if (caps.has("lookup")) {
    fragments.push(
      "If a visitor gives an email or phone and mentions they've been here before, you may call lookup_customer to fetch their record and personalize your help. Never claim to recognize someone you haven't looked up.",
    );
  }

  return fragments;
}
