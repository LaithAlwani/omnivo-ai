import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  capabilitiesFor,
  toolsFor,
  type AgentConnections,
} from "./modules/registry";
import { resolveBookingProvider, lookupAvailable } from "./lib/providers";

// -----------------------------------------------------------------------------
// The ONE place the agent's capability set is derived. A module flag is
// permission; a live connection is the grant — both required (Phase B). The
// widget orchestrator (publicChat) and tests both go through here, so "what can
// this tenant's assistant do?" has exactly one answer.
// -----------------------------------------------------------------------------

export const capabilityPlan = internalAction({
  args: { businessId: v.id("businesses") },
  returns: v.object({
    capabilities: v.array(v.string()),
    toolNames: v.array(v.string()),
    bookingSystem: v.union(
      v.literal("external"),
      v.literal("native"),
      v.null(),
    ),
  }),
  handler: async (ctx, { businessId }) => {
    const entitlements = await ctx.runQuery(internal.entitlements.forBusiness, {
      businessId,
    });
    const provider = await resolveBookingProvider(ctx, businessId);
    const lookup = entitlements.integrationsEnabled
      ? await lookupAvailable(ctx, businessId)
      : false;

    const conns: AgentConnections = {
      bookingRead: provider?.caps.has("read") ?? false,
      bookingWrite: provider?.caps.has("write") ?? false,
      lookup,
    };
    const caps = capabilitiesFor(entitlements, conns);
    const tools = toolsFor(caps);

    // Only label the booking system when the agent can actually use it.
    const canBook = caps.has("availability") || caps.has("booking");
    const bookingSystem =
      canBook && provider
        ? provider.id === "webhook"
          ? ("external" as const)
          : ("native" as const)
        : null;

    return {
      capabilities: Array.from(caps),
      toolNames: tools.map((t) => t.name),
      bookingSystem,
    };
  },
});
