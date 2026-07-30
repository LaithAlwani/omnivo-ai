import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { customEmailDomainEnabled } from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";

// -----------------------------------------------------------------------------
// Custom sending domain (Professional+), verified through Resend. Storage +
// reads live here (default runtime); the Resend API calls (create/verify/send)
// live in resend.ts / emailNode.ts. No credentials are ever stored — only the
// Resend domain id and the DNS records to display.
// -----------------------------------------------------------------------------

const recordsValidator = v.array(
  v.object({
    type: v.string(),
    name: v.string(),
    value: v.string(),
    priority: v.optional(v.number()),
  }),
);
const statusValidator = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("failed"),
);

async function domainRow(ctx: QueryCtx, businessId: Id<"businesses">) {
  return await ctx.db
    .query("emailDomains")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
}

/** Dashboard view: whether the plan allows it + the current domain config. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const plan = await planForBusiness(ctx, business._id);
    const row = await domainRow(ctx, business._id);
    return {
      available: customEmailDomainEnabled(plan),
      domain: row
        ? {
            domain: row.domain,
            fromName: row.fromName,
            fromEmail: row.fromEmail,
            status: row.status,
            records: row.records,
            lastCheckedAt: row.lastCheckedAt ?? null,
          }
        : null,
    };
  },
});

/** Internal: the verified from-address for the send path (null if unverified). */
export const configForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: v.union(
    v.null(),
    v.object({ fromName: v.string(), fromEmail: v.string() }),
  ),
  handler: async (ctx, { businessId }) => {
    const row = await domainRow(ctx, businessId);
    if (!row || row.status !== "verified") return null;
    return { fromName: row.fromName, fromEmail: row.fromEmail };
  },
});

/** Internal: authorize (manager + plan) and resolve the Resend domain id for
 *  the verify/remove actions. Identity forwarded from the calling action. */
export const forManage = internalQuery({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      businessId: v.id("businesses"),
      resendDomainId: v.string(),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const row = await domainRow(ctx, business._id);
    if (!row) return null;
    return { businessId: business._id, resendDomainId: row.resendDomainId };
  },
});

/** Internal: authorize (manager + plan) then store a newly registered domain. */
export const upsert = internalMutation({
  args: {
    slug: v.string(),
    domain: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),
    resendDomainId: v.string(),
    status: statusValidator,
    records: recordsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    const plan = await planForBusiness(ctx, business._id);
    if (!customEmailDomainEnabled(plan)) {
      appError(
        "FORBIDDEN",
        "A custom email domain is available on Professional and up.",
      );
    }
    const existing = await domainRow(ctx, business._id);
    const fields = {
      businessId: business._id,
      domain: args.domain,
      fromName: args.fromName,
      fromEmail: args.fromEmail,
      resendDomainId: args.resendDomainId,
      status: args.status,
      records: args.records,
      lastCheckedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("emailDomains", fields);
    }
    return null;
  },
});

/** Internal: update status + records after a verification check. */
export const setVerification = internalMutation({
  args: {
    businessId: v.id("businesses"),
    status: statusValidator,
    records: recordsValidator,
  },
  returns: v.null(),
  handler: async (ctx, { businessId, status, records }) => {
    const row = await domainRow(ctx, businessId);
    if (row) {
      await ctx.db.patch(row._id, {
        status,
        records,
        lastCheckedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Internal: drop the domain row (after Resend deletion). */
export const clear = internalMutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const row = await domainRow(ctx, business._id);
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});
