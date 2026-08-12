import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// -----------------------------------------------------------------------------
// Streaming buffer for the widget's assistant reply. The `publicChat` action
// (Node) writes text deltas here as the model streams; the widget subscribes to
// `streamText` by a random per-turn key and renders the growing text. Rows are
// ephemeral — deleted shortly after the turn completes. No auth: the key is an
// unguessable per-turn UUID and the content is the reply the caller is already
// receiving, so a subscription leaks nothing a guesser could target.
// -----------------------------------------------------------------------------

/** The current streamed text for a turn (reactive; drives the live bubble). */
export const streamText = query({
  args: { key: v.string() },
  returns: v.union(
    v.object({ text: v.string(), done: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("chatStreams")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row ? { text: row.text, done: row.done } : null;
  },
});

/** Upsert the buffer for a turn (called repeatedly by the streaming action). */
export const putStream = internalMutation({
  args: { key: v.string(), text: v.string(), done: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { key, text, done }) => {
    const row = await ctx.db
      .query("chatStreams")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { text, done });
    else await ctx.db.insert("chatStreams", { key, text, done });
    return null;
  },
});

/** Delete a buffer row (scheduled shortly after the turn finishes). */
export const clearStream = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("chatStreams")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});
