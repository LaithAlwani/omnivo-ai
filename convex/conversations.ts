import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { usagePeriod } from "./lib/tiers";
import { estimateCostCents } from "./lib/modelPricing";

// -----------------------------------------------------------------------------
// Widget conversation tracking. The chat action calls `record` once per turn
// with the session's opaque key: the first turn opens a conversation row, later
// turns bump its counter. Metadata only — we never persist message content.
// -----------------------------------------------------------------------------

export const record = internalMutation({
  args: {
    businessId: v.id("businesses"),
    conversationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { businessId, conversationKey }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_business_key", (q) =>
        q.eq("businessId", businessId).eq("conversationKey", conversationKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        messageCount: existing.messageCount + 1,
        lastMessageAt: now,
      });
      return null;
    }

    // New conversation: create it and bump this month's usage counter (the one
    // read to enforce the plan's conversation cap). Usage is pooled at the
    // account level.
    await ctx.db.insert("conversations", {
      businessId,
      conversationKey,
      messageCount: 1,
      lastMessageAt: now,
    });

    const business = await ctx.db.get(businessId);
    const accountId = business?.accountId;
    if (accountId) {
      const period = usagePeriod(now);
      const counter = await ctx.db
        .query("usageCounters")
        .withIndex("by_account_period", (q) =>
          q.eq("accountId", accountId).eq("period", period),
        )
        .unique();
      if (counter) {
        await ctx.db.patch(counter._id, {
          conversations: counter.conversations + 1,
        });
      } else {
        await ctx.db.insert("usageCounters", {
          accountId,
          period,
          conversations: 1,
        });
      }
    }
    return null;
  },
});

/** Accumulate a turn's token usage (from the chat loop) onto the conversation
 *  row + the account's monthly counter. Billable credits are input+output; cache
 *  reads are our-cost-only. `costCents` is our estimated Anthropic spend (for the
 *  margin view). Fire-and-forget from publicChat, like `record`. */
export const recordUsage = internalMutation({
  args: {
    businessId: v.id("businesses"),
    conversationKey: v.optional(v.string()),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const costCents = estimateCostCents(args.model, {
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
    });

    // Conversation-level detail (if we have a session key + row).
    if (args.conversationKey) {
      const conv = await ctx.db
        .query("conversations")
        .withIndex("by_business_key", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("conversationKey", args.conversationKey!),
        )
        .unique();
      if (conv) {
        await ctx.db.patch(conv._id, {
          inputTokens: (conv.inputTokens ?? 0) + args.inputTokens,
          outputTokens: (conv.outputTokens ?? 0) + args.outputTokens,
          cacheReadTokens: (conv.cacheReadTokens ?? 0) + args.cacheReadTokens,
          costCents: (conv.costCents ?? 0) + costCents,
          lastMessageAt: now,
        });
      }
    }

    // Account-level aggregate (the credit + margin driver).
    const business = await ctx.db.get(args.businessId);
    const accountId = business?.accountId;
    if (!accountId) return null;
    const period = usagePeriod(now);
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", accountId).eq("period", period),
      )
      .unique();
    if (counter) {
      await ctx.db.patch(counter._id, {
        aiInputTokens: (counter.aiInputTokens ?? 0) + args.inputTokens,
        aiOutputTokens: (counter.aiOutputTokens ?? 0) + args.outputTokens,
        aiCacheReadTokens:
          (counter.aiCacheReadTokens ?? 0) + args.cacheReadTokens,
        aiCostCents: (counter.aiCostCents ?? 0) + costCents,
      });
    } else {
      await ctx.db.insert("usageCounters", {
        accountId,
        period,
        conversations: 0,
        aiInputTokens: args.inputTokens,
        aiOutputTokens: args.outputTokens,
        aiCacheReadTokens: args.cacheReadTokens,
        aiCostCents: costCents,
      });
    }
    return null;
  },
});
