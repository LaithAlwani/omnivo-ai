import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import {
  type ModuleKey,
  type Entitlements,
  DEFAULT_ENTITLEMENTS,
} from "./modules/registry";
import { entitlementsForPlan, type Plan } from "./lib/tiers";

// -----------------------------------------------------------------------------
// Entitlements — per-project module toggles. The single AI Employee gains skills
// from whichever modules are enabled here. This is the source of truth for tool
// gating (chat path) and workflow gating (crons). Synced from the account's plan
// on Stripe subscription changes; also toggleable from the platform.
// -----------------------------------------------------------------------------

const moduleKeyValidator = v.union(
  v.literal("booking"),
  v.literal("leadQualification"),
  v.literal("integrations"),
);

/** Read a project's entitlements, falling back to all-off defaults. */
export async function entitlementsFor(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
): Promise<Entitlements> {
  const row = await ctx.db
    .query("tenantFeatures")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
  if (!row) return { ...DEFAULT_ENTITLEMENTS };
  return {
    bookingEnabled: row.bookingEnabled,
    leadQualificationEnabled: row.leadQualificationEnabled,
    integrationsEnabled: row.integrationsEnabled,
  };
}

/** Seed a tenantFeatures row if the project doesn't have one yet. */
export async function ensureFeatures(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  overrides?: Partial<Entitlements>,
): Promise<void> {
  const existing = await ctx.db
    .query("tenantFeatures")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
  if (existing) return;
  await ctx.db.insert("tenantFeatures", {
    businessId,
    ...DEFAULT_ENTITLEMENTS,
    ...overrides,
  });
}

/** Overwrite a project's module entitlements to exactly match its plan's bundle.
 *  Called on provision and whenever the account's plan changes, so enabling a
 *  higher tier turns on its modules and downgrading turns the rest off. */
export async function syncEntitlementsToPlan(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  plan: Plan,
): Promise<void> {
  const entitlements = entitlementsForPlan(plan);
  const existing = await ctx.db
    .query("tenantFeatures")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, entitlements);
  } else {
    await ctx.db.insert("tenantFeatures", { businessId, ...entitlements });
  }
}

/** Internal: entitlements for the chat/workflow path. */
export const forBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => await entitlementsFor(ctx, businessId),
});

/** Dashboard: the caller's project entitlements. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    return await entitlementsFor(ctx, business._id);
  },
});

/** Enable/disable a module for a project (manager only). A manual override on
 *  top of the plan bundle synced from Stripe — used for platform/support tweaks. */
export const setModule = mutation({
  args: { slug: v.string(), module: moduleKeyValidator, enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { slug, module, enabled }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const existing = await ctx.db
      .query("tenantFeatures")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
    const field = `${module}Enabled` as `${ModuleKey}Enabled`;
    if (existing) {
      await ctx.db.patch(existing._id, { [field]: enabled });
    } else {
      await ctx.db.insert("tenantFeatures", {
        businessId: business._id,
        ...DEFAULT_ENTITLEMENTS,
        [field]: enabled,
      });
    }
    return null;
  },
});

// -----------------------------------------------------------------------------
// Migration: seed a tenantFeatures row per project. To preserve current widget
// behavior, default Booking + Lead Qualification on (SMS Automation on where the
// account plan historically included SMS — i.e. every plan today).
// -----------------------------------------------------------------------------
export const backfillFeatures = internalMutation({
  args: {},
  returns: v.object({ seeded: v.number() }),
  handler: async (ctx) => {
    let seeded = 0;
    const businesses = await ctx.db.query("businesses").collect();
    for (const business of businesses) {
      const existing = await ctx.db
        .query("tenantFeatures")
        .withIndex("by_business", (q) => q.eq("businessId", business._id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("tenantFeatures", {
        businessId: business._id,
        ...DEFAULT_ENTITLEMENTS,
        bookingEnabled: true,
        leadQualificationEnabled: true,
      });
      seeded++;
    }
    return { seeded };
  },
});
