import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requirePlatformAdmin } from "./lib/authz";
import { recordAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { planForBusiness } from "./lib/accounts";
import { creditStatus, usagePeriod } from "./lib/tiers";
import { planValidator } from "./schema";
import { generateEmbedKey } from "./lib/keys";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

// -----------------------------------------------------------------------------
// Platform plane — cross-tenant, operators only. Every read starts with
// requirePlatformAdmin; this is the only place cross-tenant reads are allowed.
// -----------------------------------------------------------------------------

/**
 * Seed the first operator. Chicken-and-egg: the first platform admin can't be
 * created by a platform admin, so this is an INTERNAL mutation run once from the
 * CLI after the owner signs up:
 *   npx convex run platform:seedAdmin '{"email":"you@domain.com"}'
 */
export const seedAdmin = internalMutation({
  args: {
    email: v.string(),
    role: v.optional(v.union(v.literal("support"), v.literal("superadmin"))),
  },
  returns: v.id("platformAdmins"),
  handler: async (ctx, args) => {
    const role = args.role ?? "superadmin";
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) {
      appError("NOT_FOUND", `No user with email ${args.email} — sign up first.`);
    }

    const existing = await ctx.db
      .query("platformAdmins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role });
      return existing._id;
    }
    return await ctx.db.insert("platformAdmins", {
      userId: user._id,
      role,
      createdAt: Date.now(),
    });
  },
});

/**
 * Is the caller a platform operator? Non-throwing (returns null for everyone
 * else) so the UI can render an access screen instead of erroring, and the
 * dashboard can decide whether to surface the portal link.
 */
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ role: v.union(v.literal("support"), v.literal("superadmin")) }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const admin = await ctx.db
      .query("platformAdmins")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return admin ? { role: admin.role } : null;
  },
});

/** Every business on the platform — the support-portal index. Never leaks the
 *  embed-key hash; newest first. */
export const listBusinesses = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("businesses").collect();
    const sorted = rows.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      sorted.map(async (b) => ({
        _id: b._id,
        name: b.name,
        slug: b.slug,
        tier: await planForBusiness(ctx, b._id),
        status: b.status,
        createdAt: b._creationTime,
      })),
    );
  },
});

/** AI cost & margin per business for a month — the COGS view. For each tenant:
 *  conversations, billable tokens, the credit revenue we've attributed to AI
 *  (included credits consumed + accrued overage), our estimated Anthropic spend,
 *  and the margin between them. Spot unprofitable clients + validate the $/token
 *  rate. Cross-tenant read — operators only. */
export const costMargin = query({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, { period }) => {
    await requirePlatformAdmin(ctx);
    const p = period ?? usagePeriod(Date.now());
    const businesses = await ctx.db.query("businesses").collect();

    const rows = await Promise.all(
      businesses.map(async (b) => {
        const plan = await planForBusiness(ctx, b._id);
        const counter = b.accountId
          ? await ctx.db
              .query("usageCounters")
              .withIndex("by_account_period", (q) =>
                q.eq("accountId", b.accountId!).eq("period", p),
              )
              .unique()
          : null;

        const billableTokens =
          (counter?.aiInputTokens ?? 0) + (counter?.aiOutputTokens ?? 0);
        const credit = creditStatus(plan, billableTokens);
        // Revenue attributed to AI: the included credits consumed (a slice of
        // their subscription) plus any overage that accrues on top.
        const revenueCents = credit.usedCents + credit.overageCents;
        const ourCostCents = Math.round(counter?.aiCostCents ?? 0);

        return {
          _id: b._id,
          name: b.name,
          slug: b.slug,
          tier: plan,
          conversations: counter?.conversations ?? 0,
          billableTokens,
          cacheReadTokens: counter?.aiCacheReadTokens ?? 0,
          revenueCents,
          overageCents: credit.overageCents,
          ourCostCents,
          marginCents: revenueCents - ourCostCents,
        };
      }),
    );

    // Busiest (by our spend) first; idle tenants sink to the bottom.
    rows.sort((a, b) => b.ourCostCents - a.ourCostCents);

    const totals = rows.reduce(
      (acc, r) => ({
        billableTokens: acc.billableTokens + r.billableTokens,
        revenueCents: acc.revenueCents + r.revenueCents,
        ourCostCents: acc.ourCostCents + r.ourCostCents,
        marginCents: acc.marginCents + r.marginCents,
      }),
      { billableTokens: 0, revenueCents: 0, ourCostCents: 0, marginCents: 0 },
    );

    return { period: p, rows, totals };
  },
});

/** One tenant, drilled in: profile + a recent slice of its bookings, leads,
 *  staff, and team. Cross-tenant read — operators only. Read-only. */
export const businessDetail = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    await requirePlatformAdmin(ctx);
    const business = await ctx.db.get(businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");

    const staff = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(100);
    const staffName = new Map<Id<"staff">, string>(
      staff.map((s) => [s._id, s.name]),
    );

    const now = Date.now();
    const bookingRows = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) =>
        q.eq("businessId", businessId).gte("start", now),
      )
      .take(25);
    const upcoming = bookingRows
      .filter((b) => b.status === "confirmed")
      .map((b) => ({
        _id: b._id,
        start: b.start,
        end: b.end,
        customerName: b.customerName,
        customerEmail: b.customerEmail,
        staffName: staffName.get(b.staffId) ?? "—",
        source: b.source,
      }));

    const leadRows = await ctx.db
      .query("leads")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .order("desc")
      .take(25);
    const leads = leadRows.map((l) => ({
      _id: l._id,
      name: l.name,
      email: l.email ?? null,
      phone: l.phone ?? null,
      status: l.status,
      source: l.source,
      createdAt: l._creationTime,
    }));

    const memberRows = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(100);
    const members = await Promise.all(
      memberRows.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { _id: m._id, email: user?.email ?? "—", role: m.role };
      }),
    );

    const integrationRows = await ctx.db
      .query("integrations")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const connections = integrationRows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      provider: r.provider,
      active: r.active,
      verified: r.verified,
      health: r.health ?? "healthy",
      failureStreak: r.failureStreak ?? 0,
      lastCheckedAt: r.lastCheckedAt ?? null,
    }));

    return {
      business: {
        _id: business._id,
        name: business.name,
        slug: business.slug,
        tier: await planForBusiness(ctx, business._id),
        status: business.status,
        provisioning: business.provisioning ?? "self",
        timezone: business.timezone ?? null,
        domains: business.domains,
        createdAt: business._creationTime,
      },
      staff: staff.map((s) => ({
        _id: s._id,
        name: s.name,
        title: s.title ?? null,
        active: s.active,
        bookable: s.bookable,
      })),
      upcoming,
      leads,
      members,
      connections,
    };
  },
});

/** Cross-tenant list of degraded connections — the operator's "what's broken
 *  right now" view. Operators only. */
export const connectionHealth = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("integrations").collect();
    const degraded = rows.filter((r) => r.active && r.health === "degraded");
    return await Promise.all(
      degraded.map(async (r) => {
        const b = await ctx.db.get(r.businessId);
        const lastCheck = await ctx.db
          .query("connectionChecks")
          .withIndex("by_integration_ts", (q) =>
            q.eq("integrationId", r._id),
          )
          .order("desc")
          .first();
        return {
          _id: r._id,
          businessId: r.businessId,
          businessName: b?.name ?? "—",
          slug: b?.slug ?? "",
          kind: r.kind,
          provider: r.provider,
          failureStreak: r.failureStreak ?? 0,
          lastCheckedAt: r.lastCheckedAt ?? null,
          lastError: lastCheck?.error ?? null,
        };
      }),
    );
  },
});

// --- Installer provisioning + hand-off --------------------------------------

/** Assert the caller is a superadmin; returns their id (for the provision action). */
export const requireSuperadmin = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const { userId } = await requirePlatformAdmin(ctx, "superadmin");
    return userId;
  },
});

/** Find-or-create a placeholder user for a client email (no auth attached until
 *  they claim it via an invite). */
export const ensureShellUser = internalMutation({
  args: { email: v.string() },
  returns: v.id("users"),
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", { email });
  },
});

/** Write an audit row (thin Convex wrapper over the audit helper). */
export const audit = internalMutation({
  args: {
    actorUserId: v.id("users"),
    scope: v.union(v.literal("platform"), v.literal("business")),
    action: v.string(),
    businessId: v.optional(v.id("businesses")),
    targetId: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordAudit(ctx, args);
    return null;
  },
});

/** Provision a tenant on a client's behalf (superadmin). The business is owned
 *  by a placeholder shell user (the client's email) and marked installer-managed;
 *  the client claims it later via an invite. */
export const provisionForClient = action({
  args: {
    clientEmail: v.string(),
    name: v.string(),
    slug: v.string(),
    tier: v.optional(planValidator),
  },
  returns: v.object({ businessId: v.id("businesses"), slug: v.string() }),
  handler: async (ctx, args): Promise<{ businessId: Id<"businesses">; slug: string }> => {
    const installerId = await ctx.runQuery(internal.platform.requireSuperadmin, {});
    const slug = args.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      appError("INVALID_INPUT", "Use 3–40 lowercase letters, numbers, or hyphens.");
    }
    const email = args.clientEmail.trim().toLowerCase();
    if (!email.includes("@")) appError("INVALID_INPUT", "Enter a valid client email.");

    const { key, prefix, hash } = await generateEmbedKey();
    const ownerUserId = await ctx.runMutation(internal.platform.ensureShellUser, {
      email,
    });
    const businessId: Id<"businesses"> = await ctx.runMutation(
      internal.businesses.provision,
      {
        name: args.name,
        slug,
        tier: args.tier ?? "starter",
        embedKeyPrefix: prefix,
        embedKeyHash: hash,
        embedKey: key,
        ownerUserId,
        provisioning: "installer",
        installerId,
      },
    );
    await ctx.runMutation(internal.platform.audit, {
      actorUserId: installerId,
      scope: "platform",
      businessId,
      action: "platform.provisionForClient",
      meta: { clientEmail: email },
    });
    return { businessId, slug };
  },
});

/** Hand a tenant between self-serve and installer-managed (superadmin). Flips
 *  `provisioning` + sets/clears `installerId` on the same row — who may act
 *  changes, the data model doesn't. */
export const setProvisioning = mutation({
  args: {
    businessId: v.id("businesses"),
    mode: v.union(v.literal("self"), v.literal("installer")),
  },
  returns: v.null(),
  handler: async (ctx, { businessId, mode }) => {
    const { userId } = await requirePlatformAdmin(ctx, "superadmin");
    const business = await ctx.db.get(businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    await ctx.db.patch(businessId, {
      provisioning: mode,
      installerId: mode === "installer" ? userId : undefined,
    });
    await recordAudit(ctx, {
      actorUserId: userId,
      scope: "platform",
      businessId,
      action: `platform.handoff.${mode}`,
    });
    return null;
  },
});
