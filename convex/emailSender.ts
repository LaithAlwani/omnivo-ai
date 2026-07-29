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

// -----------------------------------------------------------------------------
// Custom sending domain (bring-your-own SMTP). Managers configure their own SMTP
// so booking emails send from THEIR domain. The password is encrypted in the
// Node layer (emailNode.ts) before it ever reaches these mutations. The queries
// that surface config to the dashboard never return the password.
// -----------------------------------------------------------------------------

async function senderRow(ctx: QueryCtx, businessId: Id<"businesses">) {
  return await ctx.db
    .query("emailSenders")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
}

/** Dashboard view of the sender config — never includes the password. */
export const getSender = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      fromName: v.string(),
      fromEmail: v.string(),
      host: v.string(),
      port: v.number(),
      username: v.string(),
      verified: v.boolean(),
      lastTestedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const row = await senderRow(ctx, business._id);
    if (!row) return null;
    return {
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      host: row.host,
      port: row.port,
      username: row.username,
      verified: row.verified,
      lastTestedAt: row.lastTestedAt ?? null,
    };
  },
});

/** Internal: full config incl. the encrypted password, for the send path. No
 *  auth gate — the caller (booking-email action) runs without a user. */
export const configForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const row = await senderRow(ctx, businessId);
    if (!row || !row.verified) return null;
    return {
      businessId,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      host: row.host,
      port: row.port,
      username: row.username,
      passwordEnc: row.passwordEnc,
    };
  },
});

/** Internal + manager-gated: full config for the "send test" flow. */
export const configForTest = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const row = await senderRow(ctx, business._id);
    if (!row) return null;
    return {
      businessId: business._id,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      host: row.host,
      port: row.port,
      username: row.username,
      passwordEnc: row.passwordEnc,
    };
  },
});

/** Internal: store an (already-encrypted) sender config. Manager + tier gated.
 *  Resets `verified` — any change must be re-tested. */
export const upsert = internalMutation({
  args: {
    slug: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),
    host: v.string(),
    port: v.number(),
    username: v.string(),
    passwordEnc: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");
    if (!customEmailDomainEnabled(business.tier)) {
      appError(
        "FORBIDDEN",
        "A custom email domain is available on Professional and up.",
      );
    }
    const existing = await senderRow(ctx, business._id);
    const fields = {
      businessId: business._id,
      fromName: args.fromName.trim(),
      fromEmail: args.fromEmail.trim(),
      host: args.host.trim(),
      port: args.port,
      username: args.username.trim(),
      passwordEnc: args.passwordEnc,
      verified: false,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("emailSenders", fields);
    }
    return null;
  },
});

/** Internal: flip verified after a successful test send. */
export const markTested = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const row = await senderRow(ctx, businessId);
    if (row) {
      await ctx.db.patch(row._id, { verified: true, lastTestedAt: Date.now() });
    }
    return null;
  },
});

/** Remove the custom sender — booking emails revert to the platform address. */
export const removeSender = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const row = await senderRow(ctx, business._id);
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});
