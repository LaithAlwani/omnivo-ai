import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePlatformAdmin } from "./lib/authz";
import { appError } from "./lib/errors";

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
    return rows
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((b) => ({
        _id: b._id,
        name: b.name,
        slug: b.slug,
        tier: b.tier,
        status: b.status,
        createdAt: b._creationTime,
      }));
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

    return {
      business: {
        _id: business._id,
        name: business.name,
        slug: business.slug,
        tier: business.tier,
        status: business.status,
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
    };
  },
});
