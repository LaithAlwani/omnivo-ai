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
  price: number;
  blurb: string;
  grants: string;
}

export const MODULE_CATALOG: ModuleInfo[] = [
  {
    key: "booking",
    name: "Booking Assistant",
    price: 49,
    blurb: "Let the assistant check live availability and book appointments.",
    grants: "Availability + booking tools, Google Calendar, confirmations.",
  },
  {
    key: "leadQualification",
    name: "Lead Capture & Qualification",
    price: 15,
    blurb: "Ask qualifying questions and capture richer, scored leads.",
    grants: "Qualification questions, intent detection, owner notifications.",
  },
  {
    key: "integrations",
    name: "Integrations",
    price: 49,
    blurb: "Connect your own booking system or CRM.",
    grants: "Booking provider + CRM sync (outbound) + customer lookup (inbound).",
  },
];

// --- Capabilities -----------------------------------------------------------

export type Capability = "booking" | "qualification" | "lookup";

/** The union of capabilities the enabled modules grant. Self-contained modules
 *  (Sales Assistant) grant several without requiring the individual add-ons.
 *  The `lookup` capability is added by the orchestrator at runtime when the
 *  Integrations module has an active inbound source (not derivable from flags
 *  alone), so it isn't set here. */
export function capabilitiesFor(e: Entitlements): Set<Capability> {
  const caps = new Set<Capability>();
  if (e.bookingEnabled) caps.add("booking");
  if (e.leadQualificationEnabled) caps.add("qualification");
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
  check_availability: "booking",
  book_appointment: "booking",
  lookup_customer: "lookup",
};

/** The tools the model may use given the enabled capabilities. */
export function toolsFor(caps: Set<Capability>): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [LIST_SERVICES, CAPTURE_LEAD];
  if (caps.has("booking")) tools.push(CHECK_AVAILABILITY, BOOK_APPOINTMENT);
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
}

/** Instruction fragments appended to the base system prompt, one per active
 *  capability, so the model knows how to use the tools it's been given. */
export function promptFragments(
  caps: Set<Capability>,
  { timezone, nowIso }: PromptContext,
): string[] {
  const fragments: string[] = [];

  if (caps.has("booking")) {
    fragments.push(
      [
        "You can take bookings using your tools.",
        timezone
          ? `The business timezone is ${timezone}; read dates like "next Tuesday" in that zone.`
          : "Interpret times in UTC.",
        `The current time is ${nowIso}.`,
        "To book: call check_availability, offer the visitor the returned times, then call book_appointment with the exact startMs they pick plus their name and email. Only ever book a startMs that check_availability returned.",
        "If the business has more than one location, ask which they'd prefer and pass locationName so you offer times at the right site.",
      ].join(" "),
    );
  } else {
    // No booking capability — don't imply the assistant can schedule.
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
