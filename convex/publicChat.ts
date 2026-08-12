"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildSystemPrompt } from "./lib/leoPrompt";
import { appError } from "./lib/errors";
import { verifyKey } from "./public";
import { enforceLimit } from "./rateLimiter";
import { usagePeriod } from "./lib/tiers";
import { toolsFor, promptFragments, type Capability } from "./modules/registry";

// -----------------------------------------------------------------------------
// Public assistant chat — the ONE AI Employee orchestrator. Embed-key authed (no
// login), Node runtime for the Anthropic SDK. It loads the project's enabled
// modules, assembles the model's tools + prompt fragments from the union of
// their capabilities, then drives a tool loop; each tool_use is executed by
// internal.assistantTools.execute (which re-checks the capability) against
// tenant-scoped functions. No feature is hardcoded into the agent.
// -----------------------------------------------------------------------------

const messageValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

export const chat = action({
  args: {
    embedKey: v.string(),
    origin: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    // Random per-turn id: when set, the reply streams into `chatStreams` so the
    // widget can render it token-by-token via the reactive `streamText` query.
    streamKey: v.optional(v.string()),
    messages: v.array(messageValidator),
  },
  returns: v.object({ reply: v.string() }),
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      appError(
        "CONFIG",
        "The assistant isn't configured yet — set ANTHROPIC_API_KEY on the Convex deployment.",
      );
    }

    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    // Per-tenant guard on the expensive AI path before we touch the model.
    await enforceLimit(ctx, "widgetChat", businessId);

    // No hard credit cap — usage past the plan's included AI credits (and any
    // purchased packs) keeps working and accrues overage. We only refuse in a
    // runaway case (usage far beyond the allowance), as a safety valve. Degrade
    // to a polite message so the widget stays graceful.
    const isNewConversation =
      args.messages.filter((m) => m.role === "user").length <= 1;
    if (isNewConversation) {
      const { blocked } = await ctx.runQuery(
        internal.tiers.creditSafetyStatus,
        { businessId, period: usagePeriod(Date.now()) },
      );
      if (blocked) {
        return {
          reply:
            "Thanks for reaching out! We're unable to chat right now — please contact us by email or phone and we'll get back to you shortly.",
        };
      }
    }

    // Track the conversation turn (metadata only) for analytics + usage. Fire-
    // and-forget so it never blocks or fails the reply.
    if (args.conversationId) {
      await ctx.scheduler.runAfter(0, internal.conversations.record, {
        businessId,
        conversationKey: args.conversationId,
      });
    }
    const context = await ctx.runQuery(internal.assistantContext.getForBusiness, {
      businessId,
    });
    if (!context) appError("NOT_FOUND", "That business doesn't exist.");

    // The agent's skills come from module permissions ∩ live connections — the
    // single derivation lives in agentPlan.capabilityPlan.
    const plan = await ctx.runAction(internal.agentPlan.capabilityPlan, {
      businessId,
    });
    const capabilities = new Set(plan.capabilities as Capability[]);
    const tools = toolsFor(capabilities);

    const nowIso = new Date().toISOString();
    const fragments = promptFragments(capabilities, {
      timezone: context.timezone,
      nowIso,
      bookingSystem: plan.bookingSystem,
      bookingLink: plan.bookingLink,
    });

    const client = new Anthropic({ apiKey });
    const model = context.aiSettings.model ?? "claude-haiku-4-5";

    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: buildSystemPrompt(context, context.knowledge),
        cache_control: { type: "ephemeral" },
      },
      ...fragments.map((text) => ({ type: "text" as const, text })),
    ];

    const messages: Anthropic.MessageParam[] = args.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Token accounting — summed across every model call in this turn (billable
    // credits = input+output; cache tokens are our-cost-only, for margin).
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    const addUsage = (u: Anthropic.Usage | undefined) => {
      if (!u) return;
      inputTokens += u.input_tokens ?? 0;
      outputTokens += u.output_tokens ?? 0;
      cacheReadTokens += u.cache_read_input_tokens ?? 0;
      cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    };

    // Streaming: when a streamKey is given, run each turn as a token stream and
    // flush the accumulated text into `chatStreams` (throttled) so the widget's
    // reactive `streamText` query renders it as it arrives.
    const streamKey = args.streamKey;
    let streamed = "";
    let lastFlush = 0;
    if (streamKey) {
      await ctx.runMutation(internal.chatStream.putStream, {
        key: streamKey,
        text: "",
        done: false,
      });
    }

    const runTurn = async (): Promise<Anthropic.Message> => {
      if (!streamKey) {
        const m = await client.messages.create({
          model,
          max_tokens: 1024,
          system,
          tools,
          messages,
        });
        addUsage(m.usage);
        return m;
      }
      const stream = client.messages.stream({
        model,
        max_tokens: 1024,
        system,
        tools,
        messages,
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          streamed += event.delta.text;
          const now = Date.now();
          if (now - lastFlush > 120) {
            lastFlush = now;
            await ctx.runMutation(internal.chatStream.putStream, {
              key: streamKey,
              text: streamed,
              done: false,
            });
          }
        }
      }
      const m = await stream.finalMessage();
      addUsage(m.usage);
      return m;
    };

    let response = await runTurn();

    // Tool loop — bounded so a misbehaving model can't spin forever.
    let guard = 0;
    while (response.stop_reason === "tool_use" && guard++ < 6) {
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { result } = await ctx.runAction(internal.assistantTools.execute, {
          businessId,
          timezone: context.timezone ?? undefined,
          nowMs: Date.now(),
          capabilities: Array.from(capabilities),
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
      response = await runTurn();
    }

    // Meter this turn's tokens onto the conversation + the account (drives AI
    // credits + our cost/margin). Fire-and-forget so it never blocks the reply.
    await ctx.scheduler.runAfter(0, internal.conversations.recordUsage, {
      businessId,
      conversationKey: args.conversationId,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    });

    const lastText = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    const reply =
      (streamKey ? streamed : lastText).trim() ||
      "Sorry, I didn't catch that — could you rephrase?";

    if (streamKey) {
      // Finalize the buffer with the complete text, then clear it shortly after.
      await ctx.runMutation(internal.chatStream.putStream, {
        key: streamKey,
        text: reply,
        done: true,
      });
      await ctx.scheduler.runAfter(60_000, internal.chatStream.clearStream, {
        key: streamKey,
      });
    }

    return { reply };
  },
});
