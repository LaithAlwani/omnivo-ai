import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, TableNames } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  requireMember,
  requireOwnerOrPlatform,
  platformAdminIdOrNull,
} from "./lib/authz";
import { recordAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { whiteLabelEnabled } from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";
import { getOrCreateAccount, projectCount } from "./accounts";
import { ensureDefaultLocation } from "./locations";
import { syncEntitlementsToPlan } from "./entitlements";
import { generateEmbedKey } from "./lib/keys";
import { tierValidator } from "./schema";

// -----------------------------------------------------------------------------
// Businesses — the tenant lifecycle. Onboarding is the ONE path in: create a
// business → owner membership → default calendar slot → embed key.
// The first client comes through the same funnel as the hundredth.
// -----------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

// Optional onboarding profile from the create wizard — pre-configures the
// assistant (branding) and seeds its knowledge so the bot can answer from day
// one. Everything is optional; sensible defaults fill any gaps.
const profileValidator = v.optional(
  v.object({
    assistantName: v.optional(v.string()),
    welcomeMsg: v.optional(v.string()),
    tone: v.optional(v.string()),
    about: v.optional(v.string()),
    hours: v.optional(v.string()),
    services: v.optional(
      v.array(
        v.object({
          name: v.string(),
          description: v.optional(v.string()),
        }),
      ),
    ),
    pricing: v.optional(v.string()),
    faq: v.optional(
      v.array(v.object({ q: v.string(), a: v.string() })),
    ),
  }),
);

/**
 * Create a business for the signed-in user (who becomes its owner). Generates
 * the embed key here (needs Web Crypto), then provisions rows in one mutation.
 */
export const create = action({
  args: {
    name: v.string(),
    slug: v.string(),
    tier: v.optional(tierValidator),
    profile: profileValidator,
  },
  returns: v.object({
    businessId: v.id("businesses"),
    slug: v.string(),
    embedKey: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) appError("UNAUTHENTICATED", "Please sign in to continue.");

    const slug = args.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      appError(
        "INVALID_INPUT",
        "Slug must be 2–40 characters: lowercase letters, numbers, and hyphens.",
      );
    }

    const { key: embedKey, prefix, hash } = await generateEmbedKey();

    const businessId: import("./_generated/dataModel").Id<"businesses"> =
      await ctx.runMutation(internal.businesses.provision, {
        name: args.name.trim(),
        slug,
        tier: args.tier ?? "starter",
        embedKeyPrefix: prefix,
        embedKeyHash: hash,
        embedKey,
        profile: args.profile,
      });

    return { businessId, slug, embedKey };
  },
});

/** Internal: the transactional part of onboarding. Identity flows through ctx. */
export const provision = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    tier: tierValidator,
    embedKeyPrefix: v.string(),
    embedKeyHash: v.string(),
    embedKey: v.string(),
    profile: profileValidator,
    // Install-first extras. Self-serve (the wizard) leaves these unset →
    // owner = caller, provisioning "self", status "draft". The installer path
    // (platform.provisionForClient) passes an explicit shell owner + installerId.
    ownerUserId: v.optional(v.id("users")),
    provisioning: v.optional(v.union(v.literal("self"), v.literal("installer"))),
    installerId: v.optional(v.id("users")),
    installFeeCents: v.optional(v.number()),
    monthlyOverrideCents: v.optional(v.number()),
  },
  returns: v.id("businesses"),
  handler: async (ctx, args) => {
    const caller = await getAuthUserId(ctx);
    if (!caller) appError("UNAUTHENTICATED", "Please sign in to continue.");
    const userId = args.ownerUserId ?? caller;

    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) appError("CONFLICT", `The slug "${args.slug}" is already taken.`);

    // Resolve (or lazily create) the owner's account. An account owns exactly
    // one business — reject a second (locations, not projects, are the unit).
    const accountId = await getOrCreateAccount(ctx, userId, args.tier);
    const account = await ctx.db.get(accountId);
    if ((await projectCount(ctx, accountId)) >= 1) {
      appError(
        "CONFLICT",
        "Your account already has a business. Add locations to grow it.",
      );
    }
    const plan = account?.plan ?? args.tier;

    const provisioning = args.provisioning ?? "self";
    const p = args.profile;
    const businessId = await ctx.db.insert("businesses", {
      name: args.name,
      slug: args.slug,
      accountId,
      // Every business starts pre-live and goes live via the go-live checklist.
      status: provisioning === "installer" ? "installing" : "draft",
      provisioning,
      installerId: args.installerId,
      installFeeCents: args.installFeeCents,
      monthlyOverrideCents: args.monthlyOverrideCents,
      domains: [],
      embedKeyPrefix: args.embedKeyPrefix,
      embedKeyHash: args.embedKeyHash,
      embedKey: args.embedKey,
      branding: {
        primaryColor: "#FF5C1A",
        accentColor: "#FFB347",
        position: "right",
        // Wizard values override the defaults when provided.
        assistantName: p?.assistantName?.trim() || "Assistant",
        welcomeMsg: p?.welcomeMsg?.trim() || "Hi! How can I help you today?",
        tone: p?.tone?.trim() || "friendly, concise, professional",
      },
      aiSettings: {
        persona: `A helpful assistant for ${args.name}.`,
      },
    });

    // Creator is the owner.
    await ctx.db.insert("memberships", {
      userId,
      businessId,
      role: "owner",
    });

    // Every project starts with one location (the billable unit).
    await ensureDefaultLocation(ctx, businessId);

    // Seed module entitlements from the plan's bundle (all tiers include the
    // connector modules). Re-synced whenever the plan changes.
    await syncEntitlementsToPlan(ctx, businessId, plan);

    // Seed the assistant's knowledge from the wizard so it can answer right
    // away. Only written when the wizard actually supplied something — otherwise
    // the overview's onboarding checklist still nudges them to add it.
    const services = (p?.services ?? [])
      .map((s) => ({
        name: s.name.trim(),
        description: s.description?.trim() || undefined,
      }))
      .filter((s) => s.name.length > 0);
    const about = p?.about?.trim() ?? "";
    const hours = p?.hours?.trim() ?? "";
    const pricing = p?.pricing?.trim() ?? "";
    const faq = (p?.faq ?? [])
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q && f.a);
    if (about || hours || pricing || services.length > 0 || faq.length > 0) {
      await ctx.db.insert("knowledge", {
        businessId,
        about,
        services,
        pricing,
        hours,
        locations: [],
        faq,
        policies: "",
      });
    }

    return businessId;
  },
});

/** Businesses the signed-in user belongs to (for the dashboard switcher). */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const rows = await Promise.all(
      memberships.map(async (m) => {
        const business = await ctx.db.get(m.businessId);
        if (!business) return null;
        // Never ship the raw key or its hash to the client — the prefix (for a
        // masked display) is fine; the full key comes only via revealEmbedKey.
        const { embedKey, embedKeyHash, ...safe } = business;
        void embedKey;
        void embedKeyHash;
        // `tier` reflects the owning account's plan (the per-business tier is
        // legacy and being retired).
        const plan = await planForBusiness(ctx, business._id);
        return { ...safe, tier: plan, role: m.role };
      }),
    );
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/** A single business, gated by membership — the isolation boundary in action. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) return null;

    // Throws unless the caller is a member — cross-tenant reads are refused here.
    await requireMember(ctx, business._id);
    const { embedKey, embedKeyHash, ...safe } = business;
    void embedKey;
    void embedKeyHash;
    const plan = await planForBusiness(ctx, business._id);
    return { ...safe, tier: plan };
  },
});

/** Update a business's white-label branding (manager only). */
export const updateBranding = mutation({
  args: {
    slug: v.string(),
    branding: v.object({
      primaryColor: v.string(),
      accentColor: v.string(),
      textColor: v.optional(v.string()),
      position: v.union(v.literal("left"), v.literal("right")),
      assistantName: v.string(),
      welcomeMsg: v.string(),
      tone: v.string(),
      chatIcon: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await requireMember(ctx, business._id, "admin");

    // Spread existing first so fields not edited here (e.g. logoStorageId) survive.
    await ctx.db.patch(business._id, {
      branding: { ...business.branding, ...args.branding },
    });
    return null;
  },
});

/** Normalize a user-entered domain to the host the widget origin check compares
 *  against (strip scheme/path, lowercase; KEEP the port so dev hosts like
 *  `localhost:3001` match `new URL(origin).host`). Returns null if unusable. */
function normalizeDomain(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const host = t.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Sanity on the hostname (port aside): a real domain or localhost.
  const hostname = host.replace(/:\d+$/, "");
  if (!hostname || (!hostname.includes(".") && hostname !== "localhost")) {
    return null;
  }
  return host;
}

/** Set the widget's allowed origins (manager only). The widget only mounts on
 *  these hosts; also a go-live requirement. */
export const setDomains = mutation({
  args: { slug: v.string(), domains: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { slug, domains }) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await requireMember(ctx, business._id, "admin");
    const clean = Array.from(
      new Set(domains.map(normalizeDomain).filter((d): d is string => !!d)),
    );
    await ctx.db.patch(business._id, { domains: clean });
    return clean;
  },
});

// --- Go-live lifecycle -------------------------------------------------------

async function bySlugOrThrow(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<"businesses">> {
  const business = await ctx.db
    .query("businesses")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!business) appError("NOT_FOUND", "That business doesn't exist.");
  return business;
}

/** Whether a business meets the go-live checklist (knowledge + ≥1 domain). A
 *  member (or platform admin) may read it; it powers the go-live UI. */
export const readiness = query({
  args: { slug: v.string() },
  returns: v.object({
    status: v.string(),
    knowledgePresent: v.boolean(),
    domainsSet: v.boolean(),
    ready: v.boolean(),
  }),
  handler: async (ctx, { slug }) => {
    const business = await bySlugOrThrow(ctx, slug);
    if (!(await platformAdminIdOrNull(ctx))) {
      await requireMember(ctx, business._id, "staff");
    }
    const knowledge = await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
    const knowledgePresent = knowledge !== null;
    const domainsSet = business.domains.length > 0;
    return {
      status: business.status,
      knowledgePresent,
      domainsSet,
      ready: knowledgePresent && domainsSet,
    };
  },
});

/** Flip a business live once the checklist passes (owner or platform admin). */
export const goLive = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug }) => {
    const business = await bySlugOrThrow(ctx, slug);
    const actorUserId = await requireOwnerOrPlatform(ctx, business);
    if (business.status === "live") return null;

    const knowledge = await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
    if (!knowledge) {
      appError("FORBIDDEN", "Add your business knowledge before going live.");
    }
    if (business.domains.length === 0) {
      appError("FORBIDDEN", "Allow-list at least one website domain before going live.");
    }

    await ctx.db.patch(business._id, { status: "live" });
    await recordAudit(ctx, {
      actorUserId,
      scope: "business",
      businessId: business._id,
      action: "business.goLive",
    });
    return null;
  },
});

/** Take a live business offline (owner or platform admin). */
export const pause = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug }) => {
    const business = await bySlugOrThrow(ctx, slug);
    const actorUserId = await requireOwnerOrPlatform(ctx, business);
    if (business.status !== "live") return null;
    await ctx.db.patch(business._id, { status: "paused" });
    await recordAudit(ctx, {
      actorUserId,
      scope: "business",
      businessId: business._id,
      action: "business.pause",
    });
    return null;
  },
});

/**
 * Internal: resolve a business by an embed-key prefix for the public widget.
 * Returns the stored secret hash + origin allow-list so the calling action can
 * verify the key (hashing needs Web Crypto, only available in actions).
 */
export const byEmbedPrefix = internalQuery({
  args: { prefix: v.string() },
  returns: v.union(
    v.object({
      businessId: v.id("businesses"),
      slug: v.string(),
      embedKeyHash: v.string(),
      domains: v.array(v.string()),
      // The widget only serves when the business is live.
      serving: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_embedKeyPrefix", (q) =>
        q.eq("embedKeyPrefix", args.prefix),
      )
      .unique();
    if (!business) return null;
    return {
      businessId: business._id,
      slug: business.slug,
      embedKeyHash: business.embedKeyHash,
      domains: business.domains,
      serving: business.status === "live",
    };
  },
});

/** Internal: public branding for the widget (safe subset — no storage ids). */
export const configForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.union(
    v.object({
      name: v.string(),
      assistantName: v.string(),
      welcomeMsg: v.string(),
      primaryColor: v.string(),
      accentColor: v.string(),
      textColor: v.string(),
      position: v.union(v.literal("left"), v.literal("right")),
      chatIcon: v.union(v.string(), v.null()),
      whiteLabel: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return null;
    const b = business.branding;
    // The single AI Employee is the business's own branding. Professional+
    // removes the "Powered by Omnivo AI" attribution (from the account plan).
    const plan = await planForBusiness(ctx, business._id);
    return {
      name: business.name,
      assistantName: b.assistantName,
      welcomeMsg: b.welcomeMsg,
      primaryColor: b.primaryColor,
      accentColor: b.accentColor,
      textColor: b.textColor ?? "#ffffff",
      position: b.position,
      chatIcon: b.chatIcon ?? null,
      whiteLabel: whiteLabelEnabled(plan),
    };
  },
});

/** Set the business's operating timezone (manager only). Validated via Intl. */
export const setTimezone = mutation({
  args: { slug: v.string(), timezone: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await requireMember(ctx, business._id, "admin");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: args.timezone });
    } catch {
      appError("INVALID_INPUT", "That timezone isn't recognized.");
    }
    await ctx.db.patch(business._id, { timezone: args.timezone });
    return null;
  },
});

/**
 * Internal: data the embed-key reveal/rotate actions need — the caller's stored
 * password hash (for verification) + the current key. Never exposed to clients.
 */
export const revealData = internalQuery({
  args: { slug: v.string() },
  returns: v.object({
    businessId: v.id("businesses"),
    embedKey: v.union(v.string(), v.null()),
    storedHash: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) appError("UNAUTHENTICATED", "Please sign in to continue.");

    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await requireMember(ctx, business._id);

    const user = await ctx.db.get(userId);
    let storedHash: string | null = null;
    if (user?.email) {
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", user.email!),
        )
        .unique();
      storedHash = account?.secret ?? null;
    }

    return {
      businessId: business._id,
      embedKey: business.embedKey ?? null,
      storedHash,
    };
  },
});

// --- Deletion (owner only) ---------------------------------------------------

/**
 * Permanently delete a business and everything scoped to it. Only the owner may
 * do this. Access is revoked and the business row dropped synchronously (so it
 * vanishes from the dashboard and its embed key stops resolving immediately);
 * the bulk tenant data is reclaimed by a scheduled, batched purge because a
 * busy tenant can exceed a single transaction's document/byte limits.
 *
 * The owning ACCOUNT is intentionally kept — it's the subscription, shared with
 * the owner's other projects, and its pooled usage counters (keyed by account,
 * not business) are left untouched. Rate-limiter component state keyed by this
 * business isn't deleted here; it lives in a separate component and self-expires.
 */
export const deleteBusiness = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await requireMember(ctx, business._id, "owner");

    // Its only stored asset is the widget logo — remove it from file storage.
    const logo = business.branding.logoStorageId;
    if (logo) await ctx.storage.delete(logo);

    // Revoke access first, then drop the business row itself.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    await ctx.db.delete(business._id);

    // Cascade-delete the rest in the background, in batches.
    await ctx.scheduler.runAfter(0, internal.businesses.purgeBusinessData, {
      businessId: business._id,
    });
    return null;
  },
});

// Per-invocation delete budget. Small enough to stay well within a mutation's
// write limits; the job reschedules itself until the tenant is fully drained.
const PURGE_BATCH = 300;

/**
 * Internal: delete every remaining row scoped to a (now-removed) business, a
 * bounded number per call, rescheduling until nothing is left. Covers every
 * business-linked table. `usageCounters`/`auditLog` match only rows that carry
 * this `businessId` — account-pooled counters and platform-level audit rows
 * (no businessId) are left alone.
 */
export const purgeBusinessData = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }): Promise<null> => {
    let budget = PURGE_BATCH;
    const drain = async <T extends TableNames>(
      rows: Doc<T>[],
    ): Promise<void> => {
      for (const r of rows) {
        await ctx.db.delete(r._id);
        budget--;
      }
    };

    // High-volume tables first, then the small configuration/child tables. Every
    // index below has businessId as its first field, so the eq range is valid.
    if (budget > 0)
      await drain(
        await ctx.db
          .query("conversations")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("usageCounters")
          .withIndex("by_business_period", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("auditLog")
          .withIndex("by_business_ts", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("services")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("locations")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("tenantFeatures")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("emailDomains")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("integrations")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );
    if (budget > 0)
      await drain(
        await ctx.db
          .query("knowledge")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .take(budget),
      );

    // Hit the cap → there may be more; come back in a fresh transaction.
    if (budget <= 0) {
      await ctx.scheduler.runAfter(0, internal.businesses.purgeBusinessData, {
        businessId,
      });
    }
    return null;
  },
});

/** Internal: swap in a freshly generated key (manager only). */
export const applyEmbedKeyRotation = internalMutation({
  args: {
    businessId: v.id("businesses"),
    embedKey: v.string(),
    embedKeyPrefix: v.string(),
    embedKeyHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.businessId, "admin");
    await ctx.db.patch(args.businessId, {
      embedKey: args.embedKey,
      embedKeyPrefix: args.embedKeyPrefix,
      embedKeyHash: args.embedKeyHash,
    });
    return null;
  },
});
