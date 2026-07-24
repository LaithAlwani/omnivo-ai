import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { roleValidator } from "./schema";

// -----------------------------------------------------------------------------
// Team — members (people with dashboard logins, scoped by `memberships`).
// Staff/calendars live in ./staff. Every mutation is manager-gated and keeps at
// least one owner.
// -----------------------------------------------------------------------------

async function countOwners(ctx: QueryCtx, businessId: Id<"businesses">) {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  return members.filter((m) => m.role === "owner").length;
}

export const listMembers = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business, userId: me } = await requireMemberBySlug(ctx, args.slug);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();

    // Map each login to the staff row it manages (if any), for the link control.
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    const staffByUser = new Map(
      staff.filter((s) => s.userId).map((s) => [s.userId as Id<"users">, s]),
    );

    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const linked = staffByUser.get(m.userId);
        return {
          membershipId: m._id,
          role: m.role,
          email: user?.email ?? "(unknown)",
          name: user?.name ?? null,
          isSelf: m.userId === me,
          linkedStaffId: linked?._id ?? null,
          linkedStaffName: linked?.name ?? null,
        };
      }),
    );
  },
});

/**
 * Link a member's login to a bookable staff row (or unlink). A linked member
 * self-manages that calendar's availability + connection. One login ↔ one staff
 * row per business, so linking first unlinks any existing tie.
 *   target: "none" → unlink · "create" → new bookable staff row · <staffId> → existing
 */
export const linkStaff = mutation({
  args: {
    slug: v.string(),
    membershipId: v.id("memberships"),
    target: v.union(v.literal("none"), v.literal("create"), v.id("staff")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.businessId !== business._id) {
      appError("NOT_FOUND", "That member no longer exists.");
    }
    const userId = membership.userId;

    // Unlink whatever this user is currently tied to in this business.
    const current = await ctx.db
      .query("staff")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const s of current) {
      if (s.businessId === business._id) {
        await ctx.db.patch(s._id, { userId: undefined });
      }
    }

    if (args.target === "none") return null;

    if (args.target === "create") {
      const user = await ctx.db.get(userId);
      const existing = await ctx.db
        .query("staff")
        .withIndex("by_business", (q) => q.eq("businessId", business._id))
        .collect();
      const order = existing.reduce((m, s) => Math.max(m, s.order), -1) + 1;
      await ctx.db.insert("staff", {
        businessId: business._id,
        userId,
        name: user?.name ?? user?.email ?? "Staff",
        email: user?.email ?? undefined,
        bookable: true,
        active: true,
        order,
      });
      return null;
    }

    const staff = await ctx.db.get(args.target);
    if (!staff || staff.businessId !== business._id) {
      appError("NOT_FOUND", "That staff member no longer exists.");
    }
    if (staff.userId && staff.userId !== userId) {
      appError("CONFLICT", "That calendar is already linked to another member.");
    }
    await ctx.db.patch(staff._id, { userId });
    return null;
  },
});

/** Add an existing user (by email) as a member. Pending invites for not-yet-
 *  registered emails are a later enhancement. */
export const addMember = mutation({
  args: { slug: v.string(), email: v.string(), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const email = args.email.trim();

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!user) {
      appError(
        "NOT_FOUND",
        "No account with that email yet — ask them to sign up first, then add them.",
      );
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_business", (q) =>
        q.eq("userId", user._id).eq("businessId", business._id),
      )
      .unique();
    if (existing) appError("CONFLICT", "They're already a member.");

    await ctx.db.insert("memberships", {
      userId: user._id,
      businessId: business._id,
      role: args.role,
    });
    return null;
  },
});

export const updateMemberRole = mutation({
  args: {
    slug: v.string(),
    membershipId: v.id("memberships"),
    role: roleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business, membership: caller } = await requireMemberBySlug(
      ctx,
      args.slug,
      "admin",
    );
    const target = await ctx.db.get(args.membershipId);
    if (!target || target.businessId !== business._id) {
      appError("NOT_FOUND", "That member no longer exists.");
    }
    // Only an owner may touch the owner role — an admin can't promote to owner
    // or change an existing owner.
    if (
      (target.role === "owner" || args.role === "owner") &&
      caller.role !== "owner"
    ) {
      appError("FORBIDDEN", "Only an owner can manage owner roles.");
    }
    if (
      target.role === "owner" &&
      args.role !== "owner" &&
      (await countOwners(ctx, business._id)) <= 1
    ) {
      appError("CONFLICT", "A business must keep at least one owner.");
    }
    await ctx.db.patch(args.membershipId, { role: args.role });
    return null;
  },
});

export const removeMember = mutation({
  args: { slug: v.string(), membershipId: v.id("memberships") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business, membership: caller } = await requireMemberBySlug(
      ctx,
      args.slug,
      "admin",
    );
    const target = await ctx.db.get(args.membershipId);
    if (!target || target.businessId !== business._id) {
      appError("NOT_FOUND", "That member no longer exists.");
    }
    if (target.role === "owner") {
      // Only an owner can remove another owner.
      if (caller.role !== "owner") {
        appError("FORBIDDEN", "Only an owner can remove another owner.");
      }
      if ((await countOwners(ctx, business._id)) <= 1) {
        appError("CONFLICT", "A business must keep at least one owner.");
      }
    }
    await ctx.db.delete(args.membershipId);
    return null;
  },
});
