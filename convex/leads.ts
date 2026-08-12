import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { entitlementsFor } from "./entitlements";
import { contactSourceValidator } from "./schema";

// -----------------------------------------------------------------------------
// Lead capture — no native CRM. The assistant captures a contact and ROUTES it
// out: to a connected outbound CRM if one is active, otherwise a fallback email
// to the owner (or installer) so it's never lost. Omnivo stores nothing itself —
// leads live in the client's own CRM, connected on the Integrations page.
// -----------------------------------------------------------------------------

/** The party notified when a captured lead has no CRM to land in: the installer
 *  for installer-managed tenants, otherwise the business owner. Returns their
 *  email, or null when none can be resolved. Mirrors the health-alert routing. */
async function leadFallbackRecipient(
  ctx: MutationCtx,
  business: Doc<"businesses">,
): Promise<string | null> {
  let userId = null as Doc<"users">["_id"] | null;
  if (business.provisioning === "installer" && business.installerId) {
    userId = business.installerId;
  } else {
    const owner = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    userId = owner ? owner.userId : null;
  }
  const user = userId ? await ctx.db.get(userId) : null;
  return user?.email ?? null;
}

/** Capture from a verified embed key (businessId already resolved) and route the
 *  contact to the tenant's CRM (or the fallback email). Stores nothing. */
export const captureForBusiness = internalMutation({
  args: {
    businessId: v.id("businesses"),
    source: contactSourceValidator,
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    const name = args.name.trim() || "Unknown";
    const email = args.email?.trim() || undefined;
    const phone = args.phone?.trim() || undefined;
    const message = args.message?.trim() || undefined;

    // Route the lead: to a connected outbound CRM (let its own alerting fire —
    // no double-messaging), otherwise email the responsible party so it's never
    // lost, with a nudge to connect a CRM (or have LA Digital set one up).
    const entitlements = await entitlementsFor(ctx, args.businessId);
    const outbound = entitlements.integrationsEnabled
      ? await ctx.db
          .query("integrations")
          .withIndex("by_business_kind", (q) =>
            q.eq("businessId", args.businessId).eq("kind", "crmOutbound"),
          )
          .collect()
      : [];

    if (outbound.some((r) => r.active)) {
      await ctx.scheduler.runAfter(0, internal.integrationsNode.dispatch, {
        businessId: args.businessId,
        event: {
          type: "lead.created",
          data: {
            name,
            email: email ?? null,
            phone: phone ?? null,
            message: message ?? null,
            source: args.source,
          },
        },
      });
    } else {
      const to = await leadFallbackRecipient(ctx, business);
      if (to) {
        await ctx.scheduler.runAfter(0, internal.emailNode.sendLeadFallback, {
          to,
          businessName: business.name,
          slug: business.slug,
          name,
          email,
          phone,
          message,
        });
      }
    }
    return null;
  },
});
