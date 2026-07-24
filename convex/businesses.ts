import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireMember } from "./lib/authz";
import { appError } from "./lib/errors";
import { generateEmbedKey } from "./lib/keys";
import { tierValidator } from "./schema";

// -----------------------------------------------------------------------------
// Businesses — the tenant lifecycle. Onboarding is the ONE path in: create a
// business → owner membership → default calendar slot → embed key.
// The first client comes through the same funnel as the hundredth.
// -----------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/**
 * Create a business for the signed-in user (who becomes its owner). Generates
 * the embed key here (needs Web Crypto), then provisions rows in one mutation.
 */
export const create = action({
  args: {
    name: v.string(),
    slug: v.string(),
    tier: v.optional(tierValidator),
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
  },
  returns: v.id("businesses"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) appError("UNAUTHENTICATED", "Please sign in to continue.");

    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) appError("CONFLICT", `The slug "${args.slug}" is already taken.`);

    const businessId = await ctx.db.insert("businesses", {
      name: args.name,
      slug: args.slug,
      status: "trial",
      tier: args.tier,
      domains: [],
      embedKeyPrefix: args.embedKeyPrefix,
      embedKeyHash: args.embedKeyHash,
      embedKey: args.embedKey,
      branding: {
        primaryColor: "#FF5C1A",
        accentColor: "#FFB347",
        position: "right",
        assistantName: "Assistant",
        welcomeMsg: "Hi! How can I help you today?",
        tone: "friendly, concise, professional",
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

    // Default shared calendar: a login-less resource named "Main" so booking
    // works before any employees are added. Renamed from the business name so
    // it reads as a calendar, not a person, on the Team page.
    await ctx.db.insert("staff", {
      businessId,
      name: "Main",
      bookable: true,
      active: true,
      order: 0,
    });

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
        return { ...safe, role: m.role };
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
    return safe;
  },
});

/** Update a business's white-label branding (manager only). */
export const updateBranding = mutation({
  args: {
    slug: v.string(),
    branding: v.object({
      primaryColor: v.string(),
      accentColor: v.string(),
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
      suspended: v.boolean(),
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
      suspended: business.status === "suspended",
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
      position: v.union(v.literal("left"), v.literal("right")),
      chatIcon: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return null;
    const b = business.branding;
    return {
      name: business.name,
      assistantName: b.assistantName,
      welcomeMsg: b.welcomeMsg,
      primaryColor: b.primaryColor,
      accentColor: b.accentColor,
      position: b.position,
      chatIcon: b.chatIcon ?? null,
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

/** Set the booking guardrails: lead time, booking window, buffer (manager). */
export const setBookingPolicy = mutation({
  args: {
    slug: v.string(),
    policy: v.object({
      minNoticeMinutes: v.number(),
      maxAdvanceDays: v.number(),
      bufferMinutes: v.number(),
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

    const { minNoticeMinutes, maxAdvanceDays, bufferMinutes } = args.policy;
    if (
      minNoticeMinutes < 0 ||
      bufferMinutes < 0 ||
      maxAdvanceDays < 1 ||
      maxAdvanceDays > 365
    ) {
      appError(
        "INVALID_INPUT",
        "Lead time and buffer can't be negative, and the window must be 1–365 days.",
      );
    }
    await ctx.db.patch(business._id, {
      bookingPolicy: { minNoticeMinutes, maxAdvanceDays, bufferMinutes },
    });
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
