import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Time off / holidays. A blackout blocks slot generation + booking for its span.
// `staffId` absent = the whole business is closed (a public holiday); set = one
// person's time off. Manager-gated writes; members can read.
// -----------------------------------------------------------------------------

/** Blackouts affecting a staff member (their own + business-wide), soonest first. */
export const list = query({
  args: { slug: v.string(), staffId: v.optional(v.id("staff")) },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const rows = await ctx.db
      .query("blackouts")
      .withIndex("by_business_start", (q) => q.eq("businessId", business._id))
      .collect();
    return rows
      .filter(
        (r) =>
          args.staffId === undefined ||
          r.staffId === undefined ||
          r.staffId === args.staffId,
      )
      .sort((a, b) => a.start - b.start);
  },
});

export const add = mutation({
  args: {
    slug: v.string(),
    staffId: v.optional(v.id("staff")),
    start: v.number(),
    end: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.id("blackouts"),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    if (args.end <= args.start) {
      appError("INVALID_INPUT", "The end of a time-off block must be after its start.");
    }
    if (args.staffId) {
      const staff = await ctx.db.get(args.staffId);
      if (!staff || staff.businessId !== business._id) {
        appError("NOT_FOUND", "That staff member no longer exists.");
      }
    }
    return await ctx.db.insert("blackouts", {
      businessId: business._id,
      staffId: args.staffId,
      start: args.start,
      end: args.end,
      reason: args.reason?.trim() || undefined,
    });
  },
});

export const remove = mutation({
  args: { slug: v.string(), blackoutId: v.id("blackouts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const row = await ctx.db.get(args.blackoutId);
    if (!row || row.businessId !== business._id) {
      appError("NOT_FOUND", "That time-off block no longer exists.");
    }
    await ctx.db.delete(args.blackoutId);
    return null;
  },
});
