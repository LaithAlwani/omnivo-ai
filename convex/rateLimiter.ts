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
  // Public writes — a hard cap to stop lead spam.
  widgetLead: { kind: "fixed window", rate: 12, period: MINUTE },
  // Marketing "Book a demo" form. This surface has no tenant, so the limits are
  // platform-wide: a per-email cap stops one address from flooding the inbox,
  // and a global token bucket shields the shared SMTP account from a spray of
  // varied addresses.
  demoRequestPerEmail: { kind: "fixed window", rate: 3, period: 10 * MINUTE },
  demoRequestGlobal: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
});

/** Turn a failed rate-limit result into a user-readable RATE_LIMITED error. */
function tooManyRequests(retryAfter?: number): never {
  const secs = Math.ceil((retryAfter ?? 0) / 1000);
  appError(
    "RATE_LIMITED",
    `Too many requests right now — please try again${secs ? ` in ${secs}s` : " shortly"}.`,
  );
}

/** Consume one token for `name`, keyed to the business. Throws RATE_LIMITED
 *  (with a user-readable retry hint) when the tenant is over its quota. */
export async function enforceLimit(
  ctx: ActionCtx,
  name: "widgetChat" | "widgetLead",
  businessId: Id<"businesses">,
): Promise<void> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, {
    key: businessId,
  });
  if (!ok) tooManyRequests(retryAfter);
}

/** Guard the tenant-less demo-request form: a global cap plus a per-email cap.
 *  Both must pass; throws RATE_LIMITED on the first that trips. */
export async function enforceDemoRequestLimit(
  ctx: ActionCtx,
  emailKey: string,
): Promise<void> {
  const global = await rateLimiter.limit(ctx, "demoRequestGlobal");
  if (!global.ok) tooManyRequests(global.retryAfter);
  const perEmail = await rateLimiter.limit(ctx, "demoRequestPerEmail", {
    key: emailKey,
  });
  if (!perEmail.ok) tooManyRequests(perEmail.retryAfter);
}
