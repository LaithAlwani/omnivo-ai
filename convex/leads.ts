import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { entitlementsFor } from "./entitlements";
import { leadStatusValidator, contactSourceValidator } from "./schema";

// -----------------------------------------------------------------------------
// Leads CRM — captured interest with a simple pipeline (new → contacted →
// qualified → won/lost). Shared across the business: any member reads/writes,
// admins delete. `capture` is the internal entry point the assistant/widget use
// later; the dashboard uses `create` for manual entry.
// -----------------------------------------------------------------------------

const contactArgs = {
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  message: v.optional(v.string()),
  serviceId: v.optional(v.id("services")),
};

/** Leads for the business, newest first, optionally filtered by status. */
export const list = query({
  args: { slug: v.string(), status: v.optional(leadStatusValidator) },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const rows = args.status
      ? await ctx.db
          .query("leads")
          .withIndex("by_business_status", (q) =>
            q.eq("businessId", business._id).eq("status", args.status!),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("leads")
          .withIndex("by_business", (q) => q.eq("businessId", business._id))
          .order("desc")
          .collect();

    return Promise.all(
      rows.map(async (l) => {
        const service = l.serviceId ? await ctx.db.get(l.serviceId) : null;
        const staff = l.assignedStaffId
          ? await ctx.db.get(l.assignedStaffId)
          : null;
        return {
          _id: l._id,
          createdAt: l._creationTime,
          updatedAt: l.updatedAt,
          name: l.name,
          email: l.email ?? null,
          phone: l.phone ?? null,
          message: l.message ?? null,
          notes: l.notes ?? null,
          status: l.status,
          source: l.source,
          serviceId: l.serviceId ?? null,
          serviceName: service?.name ?? null,
          assignedStaffId: l.assignedStaffId ?? null,
          assignedStaffName: staff?.name ?? null,
        };
      }),
    );
  },
});

/** Count of leads in each pipeline stage (for the filter tabs). */
export const counts = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const rows = await ctx.db
      .query("leads")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .collect();
    const tally = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
    for (const l of rows) tally[l.status] += 1;
    return { total: rows.length, ...tally };
  },
});

/** Manually add a lead from the dashboard. */
export const create = mutation({
  args: { slug: v.string(), ...contactArgs },
  returns: v.id("leads"),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const name = args.name.trim();
    if (!name) appError("INVALID_INPUT", "Give the lead a name.");
    if (args.serviceId) {
      const service = await ctx.db.get(args.serviceId);
      if (!service || service.businessId !== business._id) {
        appError("NOT_FOUND", "That service no longer exists.");
      }
    }
    return await ctx.db.insert("leads", {
      businessId: business._id,
      name,
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      message: args.message?.trim() || undefined,
      serviceId: args.serviceId,
      status: "new",
      source: "dashboard",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal capture point for the assistant/widget (used when the AI booking/
 * lead tools land). Takes a slug + source; always lands as a `new` lead.
 */
export const capture = internalMutation({
  args: { slug: v.string(), source: contactSourceValidator, ...contactArgs },
  returns: v.id("leads"),
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    return await ctx.db.insert("leads", {
      businessId: business._id,
      name: args.name.trim() || "Unknown",
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      message: args.message?.trim() || undefined,
      serviceId: args.serviceId,
      status: "new",
      source: args.source,
      updatedAt: Date.now(),
    });
  },
});

/** Public path: capture from a verified embed key (businessId already resolved). */
export const captureForBusiness = internalMutation({
  args: {
    businessId: v.id("businesses"),
    source: contactSourceValidator,
    ...contactArgs,
  },
  returns: v.id("leads"),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    const leadId = await ctx.db.insert("leads", {
      businessId: args.businessId,
      name: args.name.trim() || "Unknown",
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      message: args.message?.trim() || undefined,
      serviceId: args.serviceId,
      status: "new",
      source: args.source,
      updatedAt: Date.now(),
    });
    // Sales Assistant: flag + alert on promising leads as they land.
    const entitlements = await entitlementsFor(ctx, args.businessId);
    if (entitlements.salesAssistantEnabled) {
      await ctx.scheduler.runAfter(0, internal.sales.onLeadCaptured, { leadId });
    }
    // Integrations: push the new lead to any configured outbound CRM.
    if (entitlements.integrationsEnabled) {
      await ctx.scheduler.runAfter(0, internal.integrationsNode.dispatch, {
        businessId: args.businessId,
        event: {
          type: "lead.created",
          data: {
            name: args.name.trim() || "Unknown",
            email: args.email?.trim() || null,
            phone: args.phone?.trim() || null,
            message: args.message?.trim() || null,
            source: args.source,
          },
        },
      });
    }
    return leadId;
  },
});

export const setStatus = mutation({
  args: {
    slug: v.string(),
    leadId: v.id("leads"),
    status: leadStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.businessId !== business._id) {
      appError("NOT_FOUND", "That lead no longer exists.");
    }
    await ctx.db.patch(args.leadId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Edit lead details — notes, assignment, contact info. */
export const update = mutation({
  args: {
    slug: v.string(),
    leadId: v.id("leads"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    assignedStaffId: v.optional(v.union(v.id("staff"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.businessId !== business._id) {
      appError("NOT_FOUND", "That lead no longer exists.");
    }

    const patch: {
      name?: string;
      email?: string | undefined;
      phone?: string | undefined;
      notes?: string | undefined;
      assignedStaffId?: import("./_generated/dataModel").Id<"staff"> | undefined;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) appError("INVALID_INPUT", "Give the lead a name.");
      patch.name = name;
    }
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.assignedStaffId !== undefined) {
      if (args.assignedStaffId === null) {
        patch.assignedStaffId = undefined;
      } else {
        const staff = await ctx.db.get(args.assignedStaffId);
        if (!staff || staff.businessId !== business._id) {
          appError("NOT_FOUND", "That staff member no longer exists.");
        }
        patch.assignedStaffId = args.assignedStaffId;
      }
    }

    await ctx.db.patch(args.leadId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { slug: v.string(), leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.businessId !== business._id) {
      appError("NOT_FOUND", "That lead no longer exists.");
    }
    await ctx.db.delete(args.leadId);
    return null;
  },
});
