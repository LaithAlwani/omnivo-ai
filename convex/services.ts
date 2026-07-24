import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Services — the bookable offerings (a haircut, a color, a consult). Each has a
// duration that drives slot length and an optional price. `staffIds` limits who
// performs it (empty = anyone bookable). The assistant offers these by name and
// books the matching duration.
// -----------------------------------------------------------------------------

function validateDuration(mins: number) {
  if (!Number.isInteger(mins) || mins < 5 || mins > 1440) {
    appError("INVALID_INPUT", "Duration must be between 5 and 1440 minutes.");
  }
}

function validatePrice(cents: number | undefined) {
  if (cents !== undefined && (!Number.isInteger(cents) || cents < 0)) {
    appError("INVALID_INPUT", "Price must be a whole number of cents, or blank.");
  }
}

/** Keep only staff ids that belong to this business (drops stale/foreign ids). */
async function cleanStaffIds(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  staffIds: Id<"staff">[] | undefined,
): Promise<Id<"staff">[] | undefined> {
  if (!staffIds || staffIds.length === 0) return undefined;
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  const valid = new Set(rows.map((s) => s._id as string));
  const kept = staffIds.filter((id) => valid.has(id));
  return kept.length ? kept : undefined;
}

export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const rows = await ctx.db
      .query("services")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

/** Public (embed-key) service menu — active services only, safe fields. */
export const listForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("services")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    return rows
      .filter((s) => s.active)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents ?? null,
        description: s.description ?? null,
      }));
  },
});

export const add = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    durationMinutes: v.number(),
    priceCents: v.optional(v.number()),
    description: v.optional(v.string()),
    staffIds: v.optional(v.array(v.id("staff"))),
  },
  returns: v.id("services"),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const name = args.name.trim();
    if (!name) appError("INVALID_INPUT", "Give the service a name.");
    validateDuration(args.durationMinutes);
    validatePrice(args.priceCents);

    const existing = await ctx.db
      .query("services")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    const order = existing.reduce((max, s) => Math.max(max, s.order), -1) + 1;

    return await ctx.db.insert("services", {
      businessId: business._id,
      name,
      durationMinutes: args.durationMinutes,
      priceCents: args.priceCents,
      description: args.description?.trim() || undefined,
      staffIds: await cleanStaffIds(ctx, business._id, args.staffIds),
      active: true,
      order,
    });
  },
});

export const update = mutation({
  args: {
    slug: v.string(),
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    priceCents: v.optional(v.union(v.number(), v.null())),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
    staffIds: v.optional(v.array(v.id("staff"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.businessId !== business._id) {
      appError("NOT_FOUND", "That service no longer exists.");
    }

    const patch: {
      name?: string;
      durationMinutes?: number;
      priceCents?: number | undefined;
      description?: string | undefined;
      active?: boolean;
      staffIds?: Id<"staff">[] | undefined;
    } = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) appError("INVALID_INPUT", "Give the service a name.");
      patch.name = name;
    }
    if (args.durationMinutes !== undefined) {
      validateDuration(args.durationMinutes);
      patch.durationMinutes = args.durationMinutes;
    }
    if (args.priceCents !== undefined) {
      const cents = args.priceCents ?? undefined; // null clears the price
      validatePrice(cents);
      patch.priceCents = cents;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }
    if (args.active !== undefined) patch.active = args.active;
    if (args.staffIds !== undefined) {
      patch.staffIds = await cleanStaffIds(ctx, business._id, args.staffIds);
    }

    await ctx.db.patch(args.serviceId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { slug: v.string(), serviceId: v.id("services") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.businessId !== business._id) {
      appError("NOT_FOUND", "That service no longer exists.");
    }
    await ctx.db.delete(args.serviceId);
    return null;
  },
});
