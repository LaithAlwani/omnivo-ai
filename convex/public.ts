import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appError } from "./lib/errors";
import { randomHex, sha256Hex } from "./lib/keys";
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
  if (row.suspended) {
    appError("FORBIDDEN", "This business isn't accepting bookings right now.");
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

/** The bookable staff for the widget (Calendly links surface here too). */
export const staff = action({
  args: keyArgs,
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      _id: Id<"staff">;
      name: string;
      title: string | null;
      externalBookingUrl: string | null;
    }>
  > => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    return await ctx.runQuery(internal.staff.listBookableForBusiness, {
      businessId,
    });
  },
});

/** Open slots for the widget/assistant. */
export const slots = action({
  args: {
    ...keyArgs,
    staffId: v.union(v.id("staff"), v.literal("any")),
    fromMs: v.number(),
    days: v.number(),
    serviceId: v.optional(v.id("services")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ start: number; end: number; staffId: Id<"staff"> }>> => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    return await ctx.runQuery(internal.slots.getSlotsForBusiness, {
      businessId,
      staffId: args.staffId,
      fromMs: args.fromMs,
      days: args.days,
      serviceId: args.serviceId,
    });
  },
});

/** Book an appointment from the widget/assistant (source = widget). */
export const book = action({
  args: {
    ...keyArgs,
    staffId: v.union(v.id("staff"), v.literal("any")),
    start: v.number(),
    serviceId: v.optional(v.id("services")),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    bookingId: v.id("bookings"),
    staffId: v.id("staff"),
    start: v.number(),
    end: v.number(),
    cancelToken: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    bookingId: Id<"bookings">;
    staffId: Id<"staff">;
    start: number;
    end: number;
    cancelToken: string;
  }> => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    await enforceLimit(ctx, "widgetBooking", businessId);
    const cancelToken = randomHex(16);
    const res = await ctx.runMutation(internal.bookings.createForBusiness, {
      businessId,
      staffId: args.staffId,
      start: args.start,
      serviceId: args.serviceId,
      source: "widget",
      cancelToken,
      customerName: args.customerName,
      customerEmail: args.customerEmail,
      customerPhone: args.customerPhone,
      note: args.note,
    });
    return { ...res, cancelToken };
  },
});

/** Capture a lead from the widget/assistant. */
export const captureLead = action({
  args: {
    ...keyArgs,
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
  },
  returns: v.object({ leadId: v.id("leads") }),
  handler: async (ctx, args): Promise<{ leadId: Id<"leads"> }> => {
    const { businessId } = await verifyKey(ctx, args.embedKey, args.origin);
    await enforceLimit(ctx, "widgetLead", businessId);
    const leadId = await ctx.runMutation(internal.leads.captureForBusiness, {
      businessId,
      source: "widget",
      name: args.name,
      email: args.email,
      phone: args.phone,
      message: args.message,
      serviceId: args.serviceId,
    });
    return { leadId };
  },
});
