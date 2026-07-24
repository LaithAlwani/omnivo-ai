import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";

// Internal: the tenant data the assistant action needs to build its prompt.
// Membership-gated (dashboard test surface). The public widget will resolve the
// tenant by embed key instead, in the widget phase.
async function contextFor(ctx: QueryCtx, businessId: Id<"businesses">) {
  const business = await ctx.db.get(businessId);
  if (!business) return null;
  const knowledge = await ctx.db
    .query("knowledge")
    .withIndex("by_business", (q) => q.eq("businessId", business._id))
    .unique();
  return {
    name: business.name,
    slug: business.slug,
    timezone: business.timezone ?? null,
    branding: business.branding,
    aiSettings: business.aiSettings,
    knowledge,
  };
}

export const get = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const ctx2 = await contextFor(ctx, business._id);
    return ctx2!;
  },
});

/** Public path: context resolved from a verified embed key (see public.ts). */
export const getForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await contextFor(ctx, args.businessId);
  },
});
