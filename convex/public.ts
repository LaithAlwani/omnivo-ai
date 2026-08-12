import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appError } from "./lib/errors";
import { sha256Hex } from "./lib/keys";
import { enforceLimit } from "./rateLimiter";

// -----------------------------------------------------------------------------
// Public surface for the embeddable widget + assistant. There is NO dashboard
// login here — the tenant is proven by the publishable embed key (ek_<prefix>.
// <secret>): look the business up by prefix, hash the secret, compare. An
// optional origin allow-list adds a soft guard. Every call funnels into the same
// tenant-scoped internal functions the dashboard uses, so rules stay identical.
//
// NOTE: origin is passed by the caller (actions can't read request headers).
// Hard Origin/CORS enforcement moves to an httpAction wrapper in the widget slice.
// -----------------------------------------------------------------------------

function parseKey(key: string): { prefix: string; secret: string } | null {
  if (!key.startsWith("ek_")) return null;
  const rest = key.slice(3);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { prefix: rest.slice(0, dot), secret: rest.slice(dot + 1) };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function originAllowed(domains: string[], origin?: string): boolean {
  // No allow-list configured → the widget is open (tenant hasn't locked it down).
  if (domains.length === 0) return true;
  // Allow-list configured: the origin must be present AND match. widget.js always
  // sends the parent origin, so a missing origin means a direct/forged call —
  // reject it. (The origin is client-asserted, so this is defense-in-depth on top
  // of the hashed embed key, not a cryptographic boundary.)
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return domains.some((d) => {
    const dd = d.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return dd === host || dd === origin;
  });
}

/** Resolve + authorize a business from an embed key. Throws on any failure. */
export async function verifyKey(
  ctx: ActionCtx,
  key: string,
  origin?: string,
): Promise<{ businessId: Id<"businesses">; slug: string }> {
  const parsed = parseKey(key);
  if (!parsed) appError("INVALID_CREDENTIALS", "Invalid embed key.");
  const row = await ctx.runQuery(internal.businesses.byEmbedPrefix, {
    prefix: parsed.prefix,
  });
  if (!row) appError("INVALID_CREDENTIALS", "Invalid embed key.");
  const hash = await sha256Hex(parsed.secret);
  if (!timingSafeEqual(hash, row.embedKeyHash)) {
    appError("INVALID_CREDENTIALS", "Invalid embed key.");
  }
  if (!row.serving) {
    appError("FORBIDDEN", "This assistant isn't live yet.");
  }
  if (!originAllowed(row.domains, origin)) {
    appError("FORBIDDEN", "This site isn't allowed to use this key.");
  }
  return { businessId: row.businessId, slug: row.slug };
}

const keyArgs = { embedKey: v.string(), origin: v.optional(v.string()) };

/** Branding for the widget to render itself (name, colors, welcome message). */
export const config = action({
  args: keyArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{
    name: string;
    assistantName: string;
    welcomeMsg: string;
    primaryColor: string;
    accentColor: string;
    textColor: string;
    position: "left" | "right";
    chatIcon: string | null;
    whiteLabel: boolean;
  }> => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    const cfg = await ctx.runQuery(internal.businesses.configForBusiness, {
      businessId,
    });
    if (!cfg) appError("NOT_FOUND", "That business doesn't exist.");
    return cfg;
  },
});

// Explicit return types below break a circular inference: an action that just
// returns `ctx.runQuery(internal.…)` would make the generated `internal` type
// depend on itself and collapse the whole api to `any`.

/** The bookable service menu for the widget. */
export const services = action({
  args: keyArgs,
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"services">;
      name: string;
      durationMinutes: number;
      priceCents: number | null;
      description: string | null;
    }>
  > => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    return await ctx.runQuery(internal.services.listForBusiness, { businessId });
  },
});

/** Capture a contact from the widget/assistant and route it to the tenant's CRM
 *  (or the fallback email). Omnivo stores nothing itself. */
export const captureLead = action({
  args: {
    ...keyArgs,
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    await enforceLimit(ctx, "widgetLead", businessId);
    await ctx.runMutation(internal.leads.captureForBusiness, {
      businessId,
      source: "widget",
      name: args.name,
      email: args.email,
      phone: args.phone,
      message: args.message,
      serviceId: args.serviceId,
    });
    return { ok: true };
  },
});
