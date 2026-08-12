import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// -----------------------------------------------------------------------------
// Omnivo AI — multi-tenant schema, partitioned by businessId from row zero.
// Phase 0 defines the tenancy core + Convex-Auth-managed tables. Each domain
// tool (booking, leads, knowledge, …) adds its own tables in its own phase,
// always carrying a required `businessId` (+ `staffId` where relevant).
// -----------------------------------------------------------------------------

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("staff"),
);

export const tierValidator = v.union(
  v.literal("starter"),
  v.literal("professional"),
  v.literal("premium"),
  v.literal("enterprise"),
);

// The base subscription plan lives on the ACCOUNT (the owner), not the business.
// Same three levels as the legacy per-business tier; aliased so call sites read
// as "plan" going forward.
export const planValidator = tierValidator;

// Lead pipeline stages, in order. `won`/`lost` are terminal.
export const leadStatusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("qualified"),
  v.literal("won"),
  v.literal("lost"),
);

export const contactSourceValidator = v.union(
  v.literal("dashboard"),
  v.literal("assistant"),
  v.literal("widget"),
);

export default defineSchema({
  // Convex Auth managed tables (users, authAccounts, authSessions, …).
  ...authTables,

  // The billing/subscription entity — one per owner. Holds the base plan and
  // its allowances (pooled usage + project/location limits). Businesses (=
  // projects) belong to an account and share its usage pool. Numeric limits are
  // derived from `plan` (see lib/tiers.ts); the optional overrides let an
  // Enterprise account carry bespoke caps.
  accounts: defineTable({
    ownerUserId: v.id("users"),
    plan: planValidator,
    locationLimitOverride: v.optional(v.union(v.number(), v.null())),
    // Extra locations bought beyond the plan's included count (a paid Stripe
    // subscription add-on). Effective cap = plan's locationLimit + paidLocations.
    paidLocations: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    // Mirror of the Stripe subscription lifecycle for the billing UI:
    // "active" | "trialing" | "past_due" | "canceled" (unset before checkout).
    subscriptionStatus: v.optional(v.string()),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // A tenant / project. Every domain row points back here via `businessId`.
  businesses: defineTable({
    slug: v.string(), // unique, URL-safe
    name: v.string(),
    // The owning account (the subscription this project counts against). Pooled
    // usage + plan limits resolve through here. Optional only during the account
    // backfill migration; treated as required by code.
    accountId: v.optional(v.id("accounts")),
    // Install lifecycle. The widget/public chat only serves when `live`.
    // draft → being set up (self) · installing → installer setting up ·
    // live → serving traffic · paused → suspended (e.g. billing lapsed).
    status: v.union(
      v.literal("draft"),
      v.literal("installing"),
      v.literal("live"),
      v.literal("paused"),
    ),
    // Who configures this tenant. "self" → the client manages it; "installer" →
    // an operator provisions/connects on their behalf (edited via the platform
    // console). The flag changes only who may act, never the data model.
    provisioning: v.optional(
      v.union(v.literal("self"), v.literal("installer")),
    ),
    // The installer (a platform-admin user) attributed to this tenant, if any.
    installerId: v.optional(v.id("users")),
    // Installer commercial terms (set by the operator; modeled, not yet charged).
    // One-time install/setup fee; and a quoted monthly override (unset → the
    // published tier price).
    installFeeCents: v.optional(v.number()),
    monthlyOverrideCents: v.optional(v.number()),
    // Legacy per-business plan. Superseded by the owning account's `plan`; kept
    // (optional) as the migration source and removed in a later cleanup.
    tier: v.optional(tierValidator),
    // IANA timezone the business operates in (e.g. "America/New_York"). The
    // assistant anchors relative dates ("next Tuesday") to this; per-staff
    // availability can still override with its own timezone.
    timezone: v.optional(v.string()),
    // Widget security: origin allow-list + hashed embed key (never stored raw).
    domains: v.array(v.string()),
    embedKeyHash: v.string(),
    embedKeyPrefix: v.string(), // fast lookup; the secret half is hashed
    embedKey: v.optional(v.string()), // full publishable key, revealed behind a password gate
    branding: v.object({
      logoStorageId: v.optional(v.id("_storage")),
      primaryColor: v.string(),
      accentColor: v.string(),
      chatIcon: v.optional(v.string()),
      position: v.union(v.literal("left"), v.literal("right")),
      assistantName: v.string(),
      welcomeMsg: v.string(),
      tone: v.string(),
    }),
    aiSettings: v.object({
      persona: v.string(),
      model: v.optional(v.string()),
      guardrails: v.optional(v.string()),
    }),
    // Booking guardrails. Absent fields fall back to sane defaults (see
    // lib/bookingRules.ts): no minimum notice, 60-day window, no buffer.
    bookingPolicy: v.optional(
      v.object({
        minNoticeMinutes: v.number(), // can't book within this many minutes
        maxAdvanceDays: v.number(), // can't book further out than this
        bufferMinutes: v.number(), // enforced gap around every appointment
      }),
    ),
    templateId: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_account", ["accountId"])
    .index("by_embedKeyPrefix", ["embedKeyPrefix"]),

  // A physical/bookable site within a project. Every project has at least one
  // (seeded on creation); the plan's `locationLimit` caps how many. Staff and
  // bookings are scoped to a location, so the assistant books at the right site.
  locations: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    address: v.optional(v.string()),
    timezone: v.optional(v.string()),
    phone: v.optional(v.string()),
    active: v.boolean(),
    order: v.number(),
  }).index("by_business", ["businessId"]),

  // A user's role within a business. A user may belong to many businesses.
  // owner/admin = manager (sees all staff); staff = employee (sees own).
  memberships: defineTable({
    userId: v.id("users"),
    businessId: v.id("businesses"),
    role: roleValidator,
  })
    .index("by_user", ["userId"])
    .index("by_business", ["businessId"])
    .index("by_user_business", ["userId", "businessId"]),

  // A bookable resource. `userId` optional — a login-less staff member is a
  // manager-managed calendar with no account.
  staff: defineTable({
    businessId: v.id("businesses"),
    userId: v.optional(v.id("users")),
    // The location this resource works at. Optional only during the location
    // backfill migration; treated as set afterward.
    locationId: v.optional(v.id("locations")),
    name: v.string(),
    email: v.optional(v.string()),
    title: v.optional(v.string()),
    bookable: v.boolean(),
    // Calendly-style hand-off: when set, this person books through an external
    // link — the assistant hands the client off instead of offering internal
    // slots, and no calendar/availability is managed here.
    externalBookingUrl: v.optional(v.string()),
    active: v.boolean(),
    order: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_active", ["businessId", "active"])
    .index("by_user", ["userId"]),

  // Operators allowed into the cross-tenant support portal. Kept tiny.
  platformAdmins: defineTable({
    userId: v.id("users"),
    role: v.union(v.literal("support"), v.literal("superadmin")),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Appointments. `start`/`end` are UTC ms. Double-booking is prevented in the
  // booking mutation (a transaction) via an overlap check on by_staff_start.
  bookings: defineTable({
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    // The location the appointment is at (derived from the booked staff).
    // Optional only during the location backfill migration.
    locationId: v.optional(v.id("locations")),
    start: v.number(),
    end: v.number(),
    status: v.union(v.literal("confirmed"), v.literal("cancelled")),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
    note: v.optional(v.string()),
    cancelToken: v.string(),
    calendarEventId: v.optional(v.string()), // event created on the staff's calendar
    // Set when the SMS reminder is dispatched, so the reminder cron sends exactly
    // once per booking (idempotency guard — patched before the send is scheduled).
    reminderSentAt: v.optional(v.number()),
    // Set when a post-service review request is dispatched (same idempotency
    // pattern) so the Review Management cron asks exactly once per booking.
    reviewRequestSentAt: v.optional(v.number()),
    source: v.union(
      v.literal("dashboard"),
      v.literal("assistant"),
      v.literal("widget"),
    ),
  })
    .index("by_staff_start", ["staffId", "start"])
    .index("by_business_start", ["businessId", "start"])
    .index("by_cancelToken", ["cancelToken"]),

  // Per-staff external calendar connection (Google or Microsoft). One per staff.
  calendarConnections: defineTable({
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    provider: v.union(v.literal("google"), v.literal("microsoft")),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiryMs: v.number(),
    email: v.optional(v.string()),
    calendarId: v.string(), // "primary" (Google) / "primary" placeholder (Graph /me)
  })
    .index("by_staff", ["staffId"])
    .index("by_business", ["businessId"]),

  // Time off / holidays. `staffId` absent = the whole business is closed for
  // the span. Blocks slot generation and booking, like a busy span.
  blackouts: defineTable({
    businessId: v.id("businesses"),
    staffId: v.optional(v.id("staff")),
    start: v.number(),
    end: v.number(),
    reason: v.optional(v.string()),
  })
    .index("by_business_start", ["businessId", "start"])
    .index("by_staff_start", ["staffId", "start"]),

  // Cached free/busy spans per staff — subtracted from open slots.
  calendarBusy: defineTable({
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    start: v.number(),
    end: v.number(),
  })
    .index("by_staff_start", ["staffId", "start"])
    .index("by_business", ["businessId"]),

  // Bookable services — what a customer books (a haircut, a color, a consult).
  // `durationMinutes` drives the slot length; `priceCents` is optional (call-for-
  // price / free). `staffIds` limits who performs it — empty/absent = anyone
  // bookable. The assistant offers these by name and books the right duration.
  services: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    durationMinutes: v.number(),
    priceCents: v.optional(v.number()),
    description: v.optional(v.string()),
    staffIds: v.optional(v.array(v.id("staff"))),
    active: v.boolean(),
    order: v.number(),
  }).index("by_business", ["businessId"]),

  // Per-staff weekly availability. One row per staff. `week` has 7 entries
  // (index 0 = Sunday); each holds open time intervals in minutes-from-midnight,
  // interpreted in `timezone`. `slotMinutes` is the appointment/slot length.
  availabilityRules: defineTable({
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    timezone: v.string(),
    slotMinutes: v.number(),
    week: v.array(
      v.object({
        intervals: v.array(
          v.object({ start: v.number(), end: v.number() }),
        ),
      }),
    ),
  })
    .index("by_business", ["businessId"])
    .index("by_staff", ["staffId"]),

  // Leads — captured interest (from the assistant, widget, or entered by hand).
  // A simple pipeline: new → contacted → qualified → won/lost. `notes` is a
  // free-text internal scratchpad; `assignedStaffId` optionally routes ownership.
  leads: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()), // what the lead asked about
    serviceId: v.optional(v.id("services")), // service they showed interest in
    assignedStaffId: v.optional(v.id("staff")),
    status: leadStatusValidator,
    source: contactSourceValidator,
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_status", ["businessId", "status"]),

  // Per-tenant business knowledge — the assistant's source of truth. One row
  // per business; edited in the dashboard, injected into the Leo system prompt.
  knowledge: defineTable({
    businessId: v.id("businesses"),
    about: v.string(),
    services: v.array(
      v.object({ name: v.string(), description: v.optional(v.string()) }),
    ),
    pricing: v.string(),
    hours: v.string(),
    locations: v.array(
      v.object({
        name: v.optional(v.string()),
        address: v.string(),
        phone: v.optional(v.string()),
      }),
    ),
    faq: v.array(v.object({ q: v.string(), a: v.string() })),
    policies: v.string(),
  }).index("by_business", ["businessId"]),

  // Single-use, hashed password-reset tokens (custom flow so the reset LINK
  // works cross-device — the built-in flow binds the code to the requesting
  // browser via a verifier, which an email link can't carry).
  passwordResetTokens: defineTable({
    userId: v.id("users"),
    email: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // Pending membership invitations (installer- or owner-issued). The plaintext
  // token lives only in the emailed link; the hash is stored. Accepting adds the
  // caller as a member (or, for an installer "claim", transfers ownership from
  // the placeholder shell user to the real one).
  invitations: defineTable({
    businessId: v.id("businesses"),
    email: v.string(),
    role: roleValidator,
    tokenHash: v.string(),
    expiresAt: v.number(),
    invitedByUserId: v.id("users"),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_business", ["businessId"]),

  // Widget chat sessions — metadata only (no transcripts, to avoid storing PII).
  // One row per client session (`conversationKey`); message turns bump the
  // counter. Powers the Conversations metric and, later, per-plan usage caps.
  conversations: defineTable({
    businessId: v.id("businesses"),
    conversationKey: v.string(), // opaque session id minted by the widget
    messageCount: v.number(),
    lastMessageAt: v.number(),
    // Token accounting (accumulated across the conversation's turns). Billable
    // credits are input+output; cache reads are our-cost-only. `costCents` is our
    // estimated Anthropic cost (filled once model pricing is wired).
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    costCents: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_key", ["businessId", "conversationKey"]),

  // Per-ACCOUNT monthly usage counters (one row per "YYYY-MM"). Usage is pooled
  // across all of an account's projects, so counters key on `accountId`.
  // Incremented when a new conversation opens / an SMS or email is sent; read to
  // enforce plan caps in O(1). `businessId` is retained (optional) only for the
  // account backfill migration and dropped in a later cleanup.
  usageCounters: defineTable({
    accountId: v.optional(v.id("accounts")),
    businessId: v.optional(v.id("businesses")),
    period: v.string(), // "YYYY-MM" (UTC)
    conversations: v.number(),
    sms: v.optional(v.number()),
    email: v.optional(v.number()),
    // AI token usage this period — the driver for AI credits (billable =
    // input+output) and our cost/margin (`aiCostCents`, incl. cheap cache reads).
    aiInputTokens: v.optional(v.number()),
    aiOutputTokens: v.optional(v.number()),
    aiCacheReadTokens: v.optional(v.number()),
    aiCostCents: v.optional(v.number()),
  })
    .index("by_account_period", ["accountId", "period"])
    .index("by_business_period", ["businessId", "period"]),

  // Stripe object ids created by the one-time bootstrap (`billing.bootstrapStripe`),
  // so runtime never hard-codes them. Keyed by a logical name, e.g.
  // "sub_premium_monthly", "pack_credits", "addon_location", "coupon_founding".
  billingConfig: defineTable({
    key: v.string(),
    stripeId: v.string(),
  }).index("by_key", ["key"]),

  // Per-project module entitlements — the source of truth for which add-on
  // capabilities the single AI Employee has. One row per business; each boolean
  // gates a module (its tools + prompt fragments + workflows). Synced from the
  // account's plan on subscription changes (Stripe webhook → syncEntitlementsToPlan)
  // and toggleable from the platform. The base assistant (chat, knowledge, basic
  // lead capture) needs no entitlement.
  tenantFeatures: defineTable({
    businessId: v.id("businesses"),
    bookingEnabled: v.boolean(),
    leadQualificationEnabled: v.boolean(),
    integrationsEnabled: v.boolean(),
  }).index("by_business", ["businessId"]),

  // Per-business custom sending domain (Professional+), verified through Resend.
  // The tenant adds DNS records (SPF/DKIM) to authenticate their domain; once
  // Resend reports it verified, their booking/review/follow-up emails send from
  // it via our Resend account. No credentials are stored — only Resend's domain
  // id + the DNS records to display. One row per business.
  emailDomains: defineTable({
    businessId: v.id("businesses"),
    domain: v.string(), // e.g. "mail.acme.com"
    fromName: v.string(),
    fromEmail: v.string(), // must be at `domain`
    resendDomainId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
    ),
    // DNS records the tenant must add, cached from Resend for the dashboard.
    records: v.array(
      v.object({
        type: v.string(), // "TXT" | "MX" | "CNAME"
        name: v.string(),
        value: v.string(),
        priority: v.optional(v.number()),
      }),
    ),
    lastCheckedAt: v.optional(v.number()),
  }).index("by_business", ["businessId"]),

  // Integrations — connections to a project's own external systems (the
  // Integrations module). `kind` says what it does; `provider` how. `config`
  // holds endpoints/field-maps as JSON; `secretEnc` an AES-GCM API key/token
  // (see lib/secretsNode.ts). Generic `webhook` ships first; named connectors
  // (Calendly/Acuity/Square/HubSpot/Salesforce/Zapier) arrive in a later slice.
  integrations: defineTable({
    businessId: v.id("businesses"),
    kind: v.union(
      v.literal("booking"), // the AI books through the client's system
      v.literal("crmOutbound"), // push new leads/bookings/reviews out
      v.literal("crmInbound"), // read returning customers in
    ),
    provider: v.union(
      v.literal("webhook"),
      v.literal("calendly"),
      v.literal("acuity"),
      v.literal("square"),
      v.literal("hubspot"),
      v.literal("salesforce"),
      v.literal("zapier"),
    ),
    config: v.any(), // endpoints + field mappings (provider-specific JSON)
    secretEnc: v.optional(v.string()), // "ivB64:tagB64:ctB64"
    active: v.boolean(),
    verified: v.boolean(),
    lastTestedAt: v.optional(v.number()),
    // Automated connection health (health cron). "degraded" after N consecutive
    // failed pings; the agent drops the connection's tools until it recovers.
    health: v.optional(v.union(v.literal("healthy"), v.literal("degraded"))),
    failureStreak: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_kind", ["businessId", "kind"]),

  // Rolling log of connection health pings (one row per probe). Powers the
  // platform health view + the degraded-after-N-failures decision.
  connectionChecks: defineTable({
    businessId: v.id("businesses"),
    integrationId: v.id("integrations"),
    ts: v.number(),
    ok: v.boolean(),
    latencyMs: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_integration_ts", ["integrationId", "ts"])
    .index("by_business_ts", ["businessId", "ts"]),

  // Audit trail for platform-admin cross-tenant actions + sensitive business ops.
  auditLog: defineTable({
    actorUserId: v.id("users"),
    scope: v.union(v.literal("platform"), v.literal("business")),
    businessId: v.optional(v.id("businesses")),
    action: v.string(),
    targetId: v.optional(v.string()),
    meta: v.optional(v.any()),
    ts: v.number(),
  })
    .index("by_business_ts", ["businessId", "ts"])
    .index("by_actor_ts", ["actorUserId", "ts"]),
});
