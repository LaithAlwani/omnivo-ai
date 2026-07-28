import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Durable, race-free per-tenant abuse guards for the public widget surface.
// Every limit is keyed by businessId so one tenant's traffic can never exhaust
// another's quota. Token buckets permit short bursts (capacity) while capping
// the sustained rate; fixed windows are a hard cap per period for writes.
//
// These live in the rate-limiter component's own tables, so they survive across
// function calls and can't be raced (unlike a hand-rolled counter).
// -----------------------------------------------------------------------------

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // AI chat — the expensive one (each call can fan out to the model + tools).
  widgetChat: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 45 },
  // Public writes — hard caps to stop booking / lead spam.
  widgetBooking: { kind: "fixed window", rate: 12, period: MINUTE },
  widgetLead: { kind: "fixed window", rate: 12, period: MINUTE },
});

/** Consume one token for `name`, keyed to the business. Throws RATE_LIMITED
 *  (with a user-readable retry hint) when the tenant is over its quota. */
export async function enforceLimit(
  ctx: ActionCtx,
  name: "widgetChat" | "widgetBooking" | "widgetLead",
  businessId: Id<"businesses">,
): Promise<void> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, {
    key: businessId,
  });
  if (!ok) {
    const secs = Math.ceil((retryAfter ?? 0) / 1000);
    appError(
      "RATE_LIMITED",
      `Too many requests right now — please try again${secs ? ` in ${secs}s` : " shortly"}.`,
    );
  }
}
