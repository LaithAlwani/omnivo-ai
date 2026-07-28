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

// -----------------------------------------------------------------------------
// Public assistant chat with booking + lead tools. Embed-key authed (no login),
// Node runtime for the Anthropic SDK. The model drives a tool loop; each tool_use
// is executed by internal.assistantTools.execute against tenant-scoped functions.
// -----------------------------------------------------------------------------

const messageValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_services",
    description: "List the bookable services with their durations and prices.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_availability",
    description:
      "Find open appointment times. Optionally narrow by service and/or staff name. Returns times with a startMs value to book.",
    input_schema: {
      type: "object",
      properties: {
        serviceName: { type: "string" },
        staffName: { type: "string" },
        daysAhead: {
          type: "number",
          description: "How many days ahead to search (default 14).",
        },
      },
    },
  },
  {
    name: "book_appointment",
    description:
      "Book an appointment. Use a startMs value returned by check_availability — never invent one. Requires the customer's name and email.",
    input_schema: {
      type: "object",
      properties: {
        startMs: { type: "number" },
        serviceName: { type: "string" },
        staffName: { type: "string" },
        customerName: { type: "string" },
        customerEmail: { type: "string" },
        customerPhone: { type: "string" },
      },
      required: ["startMs", "customerName", "customerEmail"],
    },
  },
  {
    name: "capture_lead",
    description:
      "Save a visitor's contact details so the team can follow up when they aren't ready to book.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        message: { type: "string" },
      },
      required: ["name"],
    },
  },
];

export const chat = action({
  args: {
    embedKey: v.string(),
    origin: v.optional(v.string()),
    conversationId: v.optional(v.string()),
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

    // Plan enforcement: a new conversation (first user turn) is refused once the
    // tenant is over its monthly cap. Existing conversations continue. We degrade
    // to a polite message rather than an error so the widget stays graceful.
    const isNewConversation =
      args.messages.filter((m) => m.role === "user").length <= 1;
    if (isNewConversation) {
      const { over } = await ctx.runQuery(
        internal.tiers.conversationCapStatus,
        { businessId, period: usagePeriod(Date.now()) },
      );
      if (over) {
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

    const nowIso = new Date().toISOString();
    const bookingGuide = [
      "You can take bookings and capture leads using your tools.",
      context.timezone
        ? `The business timezone is ${context.timezone}; read dates like "next Tuesday" in that zone.`
        : "Interpret times in UTC.",
      `The current time is ${nowIso}.`,
      "To book: call check_availability, offer the visitor the returned times, then call book_appointment with the exact startMs they pick plus their name and email. Only ever book a startMs that check_availability returned.",
      "If the visitor wants a follow-up instead of booking now, use capture_lead.",
    ].join(" ");

    const client = new Anthropic({ apiKey });
    const model = context.aiSettings.model ?? "claude-haiku-4-5";
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: buildSystemPrompt(context, context.knowledge),
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: bookingGuide },
    ];

    const messages: Anthropic.MessageParam[] = args.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let response = await client.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });

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
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        system,
        tools: TOOLS,
        messages,
      });
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    return { reply: text || "Sorry, I didn't catch that — could you rephrase?" };
  },
});
