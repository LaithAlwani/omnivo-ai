import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { createDomain, verifyDomain, deleteDomain } from "./lib/resend";

// -----------------------------------------------------------------------------
// Custom-domain actions — register a sending domain with Resend, surface its DNS
// records, verify it, and remove it. Storage/auth live in emailDomains.ts; the
// Resend HTTP calls live in lib/resend.ts. `fetch` works in the default runtime,
// so these don't need Node.
// -----------------------------------------------------------------------------

/** Register a custom sending domain. Returns the DNS records to add. */
export const addDomain = action({
  args: {
    slug: v.string(),
    domain: v.string(),
    fromName: v.string(),
    fromEmail: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const domain = args.domain.trim().toLowerCase();
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const fromName = args.fromName.trim();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      appError("INVALID_INPUT", "Enter a valid domain, e.g. mail.acme.com.");
    }
    // The from-address must live at the domain being verified.
    const at = fromEmail.split("@")[1];
    if (!at || (at !== domain && !at.endsWith(`.${domain}`))) {
      appError("INVALID_INPUT", `The from-address must be at @${domain}.`);
    }

    const created = await createDomain(domain);
    await ctx.runMutation(internal.emailDomains.upsert, {
      slug: args.slug,
      domain,
      fromName,
      fromEmail,
      resendDomainId: created.id,
      status: created.status,
      records: created.records,
    });
    return null;
  },
});

/** Re-check verification with Resend and update the stored status. */
export const verify = action({
  args: { slug: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
    ),
  }),
  handler: async (
    ctx,
    { slug },
  ): Promise<{ status: "pending" | "verified" | "failed" }> => {
    const manage = await ctx.runQuery(internal.emailDomains.forManage, { slug });
    if (!manage) appError("NOT_FOUND", "Add a domain first, then verify.");
    const result = await verifyDomain(manage.resendDomainId);
    await ctx.runMutation(internal.emailDomains.setVerification, {
      businessId: manage.businessId,
      status: result.status,
      records: result.records,
    });
    return { status: result.status };
  },
});

/** Remove the custom domain — emails revert to the platform address. */
export const remove = action({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug }): Promise<null> => {
    const manage = await ctx.runQuery(internal.emailDomains.forManage, { slug });
    if (manage) await deleteDomain(manage.resendDomainId);
    await ctx.runMutation(internal.emailDomains.clear, { slug });
    return null;
  },
});
