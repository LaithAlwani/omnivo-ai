import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Staff — bookable resources/calendars under a business. A staff member may be
// login-less (no `userId`) — a manager-managed calendar. Phase 2 hangs
// per-employee availability + calendar (Google/Outlook) off these rows, or a
// Calendly-style external link (externalBookingUrl) for hand-off booking.
// -----------------------------------------------------------------------------

/** Normalize a Calendly/external booking URL, or "" → cleared. Must be http(s). */
function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    appError("INVALID_INPUT", "Enter a full booking link, e.g. https://calendly.com/you.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    appError("INVALID_INPUT", "The booking link must start with http:// or https://.");
  }
  return url.toString();
}

export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

/** Public (embed-key) staff list — bookable + active, safe fields only. */
export const listBookableForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_business_active", (q) =>
        q.eq("businessId", args.businessId).eq("active", true),
      )
      .collect();
    return rows
      .filter((s) => s.bookable)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        title: s.title ?? null,
        externalBookingUrl: s.externalBookingUrl ?? null,
      }));
  },
});

/** Resolve the location a new/edited staff member belongs to: the one given (if
 *  it belongs to this business) or the project's default (lowest-order). */
async function resolveLocation(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  locationId: Id<"locations"> | undefined,
): Promise<Id<"locations"> | undefined> {
  const locations = await ctx.db
    .query("locations")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  if (locationId) {
    const match = locations.find((l) => l._id === locationId);
    if (!match) appError("NOT_FOUND", "That location no longer exists.");
    return match._id;
  }
  return locations.sort((a, b) => a.order - b.order)[0]?._id;
}

export const add = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
    bookable: v.boolean(),
    externalBookingUrl: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  returns: v.id("staff"),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    const order = existing.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const locationId = await resolveLocation(ctx, business._id, args.locationId);

    return await ctx.db.insert("staff", {
      businessId: business._id,
      locationId,
      name: args.name.trim(),
      title: args.title?.trim() || undefined,
      bookable: args.bookable,
      externalBookingUrl:
        args.externalBookingUrl !== undefined
          ? normalizeUrl(args.externalBookingUrl)
          : undefined,
      active: true,
      order,
    });
  },
});

export const update = mutation({
  args: {
    slug: v.string(),
    staffId: v.id("staff"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    bookable: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    externalBookingUrl: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.businessId !== business._id) {
      appError("NOT_FOUND", "That staff member no longer exists.");
    }

    const patch: {
      name?: string;
      title?: string | undefined;
      bookable?: boolean;
      active?: boolean;
      externalBookingUrl?: string | undefined;
      locationId?: Id<"locations">;
    } = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.title !== undefined) patch.title = args.title.trim() || undefined;
    if (args.bookable !== undefined) patch.bookable = args.bookable;
    if (args.active !== undefined) patch.active = args.active;
    if (args.externalBookingUrl !== undefined) {
      patch.externalBookingUrl = normalizeUrl(args.externalBookingUrl);
    }
    if (args.locationId !== undefined) {
      patch.locationId = await resolveLocation(ctx, business._id, args.locationId);
    }

    await ctx.db.patch(args.staffId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { slug: v.string(), staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.businessId !== business._id) {
      appError("NOT_FOUND", "That staff member no longer exists.");
    }
    await ctx.db.delete(args.staffId);
    return null;
  },
});
