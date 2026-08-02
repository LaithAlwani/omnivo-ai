import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { knowledgeSize, MAX_KNOWLEDGE_CHARS } from "./lib/leoPrompt";

// -----------------------------------------------------------------------------
// Per-tenant knowledge — the facts the assistant answers from. One row per
// business, upserted from the dashboard editor.
// -----------------------------------------------------------------------------

export const knowledgeValidator = v.object({
  about: v.string(),
  services: v.array(
    v.object({ name: v.string(), description: v.optional(v.string()) }),
  ),
  pricing: v.string(),
  hours: v.string(),
  locations: v.array(
    v.object({
      name: v.optional(v.string()),
      address: v.string(),
      phone: v.optional(v.string()),
    }),
  ),
  faq: v.array(v.object({ q: v.string(), a: v.string() })),
  policies: v.string(),
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug);
    return await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();
  },
});

export const update = mutation({
  args: { slug: v.string(), knowledge: knowledgeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { business } = await requireMemberBySlug(ctx, args.slug, "admin");

    // The whole knowledge base is injected into every prompt, so bound its size.
    if (knowledgeSize(args.knowledge) > MAX_KNOWLEDGE_CHARS) {
      appError(
        "INVALID_INPUT",
        `Your knowledge base is too large (max ~${MAX_KNOWLEDGE_CHARS.toLocaleString()} characters). Trim it, or reach out about large knowledge bases.`,
      );
    }

    const existing = await ctx.db
      .query("knowledge")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args.knowledge);
    } else {
      await ctx.db.insert("knowledge", {
        businessId: business._id,
        ...args.knowledge,
      });
    }
    return null;
  },
});
