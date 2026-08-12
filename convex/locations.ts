import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { accountForBusiness, accountLocationLimit } from "./lib/accounts";

// -----------------------------------------------------------------------------
// Locations — bookable sites within a project. Staff and bookings are scoped to
// a location; the assistant books at the right one. The account plan's
// `locationLimit` caps how many active locations a project may have.
// -----------------------------------------------------------------------------

function validTimezone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    appError("INVALID_INPUT", "That timezone isn't recognized.");
  }
}

/** Ensure a project has at least one location, returning the default one's id.
 *  Seeds from the business timezone / knowledge address when creating. */
export async function ensureDefaultLocation(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
): Promise<Id<"locations">> {
  const existing = await ctx.db
    .query("locations")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  if (existing.length) {
    return existing.sort((a, b) => a.order - b.order)[0]._id;
  }
  const business = await ctx.db.get(businessId);
  const knowledge = await ctx.db
    .query("knowledge")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
  const seed = knowledge?.locations?.[0];
  return await ctx.db.insert("locations", {
    businessId,
    name: seed?.name?.trim() || "Main location",
    address: seed?.address,
    timezone: business?.timezone,
    phone: seed?.phone,
    active: true,
    order: 0,
  });
}

/** All locations for a project (managers + staff), ordered. */
export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const rows = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

/** Public (embed-key) active locations — safe fields, for the assistant to
 *  resolve a location by name and book at the right site. */
export const listActiveForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const rows = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    return rows
      .filter((l) => l.active)
      .sort((a, b) => a.order - b.order)
      .map((l) => ({ _id: l._id, name: l.name, address: l.address ?? null }));
  },
});

export const add = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    timezone: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.id("locations"),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");

    // Enforce the plan's per-project location limit (active locations only).
    const account = await accountForBusiness(ctx, business._id);
    const limit = account ? accountLocationLimit(account) : 1;
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    const activeCount = existing.filter((l) => l.active).length;
    if (limit !== null && activeCount >= limit) {
      appError(
        "FORBIDDEN",
        `Your plan includes ${limit} location${limit === 1 ? "" : "s"} per project. Upgrade to add more.`,
      );
    }

    const order = existing.reduce((max, l) => Math.max(max, l.order), -1) + 1;
    return await ctx.db.insert("locations", {
      businessId: business._id,
      name: args.name.trim() || "Location",
      address: args.address?.trim() || undefined,
      timezone: validTimezone(args.timezone?.trim() || undefined),
      phone: args.phone?.trim() || undefined,
      active: true,
      order,
    });
  },
});

export const update = mutation({
  args: {
    slug: v.string(),
    locationId: v.id("locations"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    timezone: v.optional(v.string()),
    phone: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const location = await ctx.db.get(args.locationId);
    if (!location || location.businessId !== business._id) {
      appError("NOT_FOUND", "That location no longer exists.");
    }

    // Reactivating counts against the limit again.
    if (args.active === true && !location.active) {
      const account = await accountForBusiness(ctx, business._id);
      const limit = account ? accountLocationLimit(account) : 1;
      if (limit !== null) {
        const active = (
          await ctx.db
            .query("locations")
            .withIndex("by_business", (q) => q.eq("businessId", business._id))
            .collect()
        ).filter((l) => l.active).length;
        if (active >= limit) {
          appError("FORBIDDEN", `Your plan includes ${limit} location${limit === 1 ? "" : "s"} per project.`);
        }
      }
    }

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim() || "Location";
    if (args.address !== undefined) patch.address = args.address.trim() || undefined;
    if (args.timezone !== undefined)
      patch.timezone = validTimezone(args.timezone.trim() || undefined);
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.active !== undefined) patch.active = args.active;
    await ctx.db.patch(args.locationId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { slug: v.string(), locationId: v.id("locations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const location = await ctx.db.get(args.locationId);
    if (!location || location.businessId !== business._id) {
      appError("NOT_FOUND", "That location no longer exists.");
    }
    // Don't orphan staff: refuse deletion while any staff is assigned here.
    const staffHere = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    if (staffHere.some((s) => s.locationId === args.locationId)) {
      appError(
        "CONFLICT",
        "Move or remove the team members at this location first.",
      );
    }
    // Keep at least one location per project.
    const all = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    if (all.length <= 1) {
      appError("CONFLICT", "A project must have at least one location.");
    }
    await ctx.db.delete(args.locationId);
    return null;
  },
});
