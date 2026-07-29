import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { aiEmployeesEnabled } from "./lib/tiers";

// -----------------------------------------------------------------------------
// AI Employees — composable assistant roles built from the shared toolkit. The
// widget serves the business's default active employee (see publicChat /
// businesses.configForBusiness); with none set it falls back to the base
// assistant. Creating employees is a Professional+ feature.
// -----------------------------------------------------------------------------

/** The default active employee for a business, or null. Shared by the chat +
 *  widget-config paths so routing stays consistent. */
export async function getDefaultEmployee(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
): Promise<Doc<"aiEmployees"> | null> {
  const rows = await ctx.db
    .query("aiEmployees")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(100);
  return rows.find((e) => e.isDefault && e.active) ?? null;
}

/** Resolve the employee a widget should use: the one the embed snippet targets
 *  (`data-employee`), if it's a valid active employee of this business —
 *  otherwise the business default. `employeeId` is untrusted client input. */
export async function resolveEmployee(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  employeeId?: string | null,
): Promise<Doc<"aiEmployees"> | null> {
  if (employeeId) {
    const id = ctx.db.normalizeId("aiEmployees", employeeId);
    if (id) {
      const emp = await ctx.db.get(id);
      if (emp && emp.businessId === businessId && emp.active) return emp;
    }
  }
  return getDefaultEmployee(ctx, businessId);
}

const fieldArgs = {
  name: v.string(),
  role: v.string(),
  persona: v.string(),
  welcomeMsg: v.string(),
  canBook: v.boolean(),
  canCaptureLeads: v.boolean(),
};

export const list = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const rows = await ctx.db
      .query("aiEmployees")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(100);
    return rows.sort((a, b) => a.order - b.order);
  },
});

export const createEmployee = mutation({
  args: { slug: v.string(), ...fieldArgs },
  returns: v.id("aiEmployees"),
  handler: async (ctx, { slug, ...fields }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    if (!aiEmployeesEnabled(business.tier)) {
      appError("FORBIDDEN", "AI Employees are available on Professional and up.");
    }
    const existing = await ctx.db
      .query("aiEmployees")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(100);
    const first = existing.length === 0;
    return await ctx.db.insert("aiEmployees", {
      businessId: business._id,
      ...fields,
      active: true,
      isDefault: first, // the first employee becomes the default
      order: existing.length,
    });
  },
});

async function ownedEmployee(
  ctx: QueryCtx,
  slug: string,
  employeeId: Id<"aiEmployees">,
): Promise<{ business: Doc<"businesses">; employee: Doc<"aiEmployees"> }> {
  const { business } = await requireMemberBySlug(ctx, slug, "admin");
  const employee = await ctx.db.get(employeeId);
  if (!employee || employee.businessId !== business._id) {
    appError("NOT_FOUND", "That employee doesn't exist.");
  }
  return { business, employee };
}

export const updateEmployee = mutation({
  args: {
    slug: v.string(),
    employeeId: v.id("aiEmployees"),
    ...fieldArgs,
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { slug, employeeId, active, ...fields }) => {
    const { employee } = await ownedEmployee(ctx, slug, employeeId);
    await ctx.db.patch(employee._id, { ...fields, active });
    // A deactivated default is no longer served; leave default flag for restore.
    return null;
  },
});

export const setDefault = mutation({
  args: { slug: v.string(), employeeId: v.id("aiEmployees") },
  returns: v.null(),
  handler: async (ctx, { slug, employeeId }) => {
    const { business, employee } = await ownedEmployee(ctx, slug, employeeId);
    const all = await ctx.db
      .query("aiEmployees")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(100);
    for (const e of all) {
      if (e.isDefault && e._id !== employee._id) {
        await ctx.db.patch(e._id, { isDefault: false });
      }
    }
    await ctx.db.patch(employee._id, { isDefault: true, active: true });
    return null;
  },
});

export const removeEmployee = mutation({
  args: { slug: v.string(), employeeId: v.id("aiEmployees") },
  returns: v.null(),
  handler: async (ctx, { slug, employeeId }) => {
    const { business, employee } = await ownedEmployee(ctx, slug, employeeId);
    const wasDefault = employee.isDefault;
    await ctx.db.delete(employee._id);
    if (wasDefault) {
      // Promote another active employee to default so the widget keeps a persona.
      const next = (
        await ctx.db
          .query("aiEmployees")
          .withIndex("by_business", (q) => q.eq("businessId", business._id))
          .take(100)
      )
        .filter((e) => e.active)
        .sort((a, b) => a.order - b.order)[0];
      if (next) await ctx.db.patch(next._id, { isDefault: true });
    }
    return null;
  },
});
