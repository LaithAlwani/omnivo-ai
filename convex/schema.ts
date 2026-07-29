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
  v.literal("enterprise"),
);

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

  // A tenant. Every domain row points back here via `businessId`.
  businesses: defineTable({
    slug: v.string(), // unique, URL-safe
    name: v.string(),
    status: v.union(
      v.literal("trial"),
      v.literal("active"),
      v.literal("suspended"),
    ),
    tier: tierValidator,
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
    .index("by_embedKeyPrefix", ["embedKeyPrefix"]),

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

  // Widget chat sessions — metadata only (no transcripts, to avoid storing PII).
  // One row per client session (`conversationKey`); message turns bump the
  // counter. Powers the Conversations metric and, later, per-plan usage caps.
  conversations: defineTable({
    businessId: v.id("businesses"),
    conversationKey: v.string(), // opaque session id minted by the widget
    messageCount: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_key", ["businessId", "conversationKey"]),

  // Per-business monthly usage counters (one row per "YYYY-MM"). Incremented when
  // a new conversation opens; read to enforce plan caps in O(1) instead of
  // scanning the conversations table on every check.
  usageCounters: defineTable({
    businessId: v.id("businesses"),
    period: v.string(), // "YYYY-MM" (UTC)
    conversations: v.number(),
    sms: v.optional(v.number()),
  }).index("by_business_period", ["businessId", "period"]),

  // AI Employees — composable assistant roles (Receptionist, Sales, Reviews…)
  // built from the shared toolkit. The widget uses the business's default active
  // employee; when none exists it falls back to the base assistant (branding +
  // aiSettings). Professional+.
  aiEmployees: defineTable({
    businessId: v.id("businesses"),
    name: v.string(), // the assistant's display name
    role: v.string(), // preset label ("receptionist"…) or "custom"
    persona: v.string(), // system-prompt instructions for this role
    welcomeMsg: v.string(),
    canBook: v.boolean(), // may check availability + book
    canCaptureLeads: v.boolean(), // may capture leads
    active: v.boolean(),
    isDefault: v.boolean(), // the one the widget serves
    order: v.number(),
  }).index("by_business", ["businessId"]),

  // Per-business custom sending domain (bring-your-own SMTP), Professional+.
  // The password is stored AES-256-GCM encrypted (see emailNode.ts); `verified`
  // flips true after a successful test send. One row per business.
  emailSenders: defineTable({
    businessId: v.id("businesses"),
    fromName: v.string(),
    fromEmail: v.string(),
    host: v.string(),
    port: v.number(),
    username: v.string(),
    passwordEnc: v.string(), // "ivB64:tagB64:ciphertextB64"
    verified: v.boolean(),
    lastTestedAt: v.optional(v.number()),
  }).index("by_business", ["businessId"]),

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
