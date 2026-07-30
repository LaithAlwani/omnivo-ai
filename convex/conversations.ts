import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { usagePeriod } from "./lib/tiers";

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
