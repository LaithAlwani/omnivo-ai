import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMemberBySlug, isManager } from "./lib/authz";
import { appError } from "./lib/errors";
import { signState, verifyState } from "./lib/calendarState";
import {
  buildAuthUrl,
  createEvent,
  deleteEvent,
  exchangeCode,
  fetchBusy,
  fetchEmail,
  refreshTokens,
  type Provider,
} from "./lib/calendarProviders";

// -----------------------------------------------------------------------------
// Per-employee calendar (Google / Microsoft). OAuth with a signed state, cached
// free/busy that slot generation subtracts, and event write-back so bookings
// appear on the staff's own calendar. All fetch — no Node runtime.
// -----------------------------------------------------------------------------

const providerValidator = v.union(v.literal("google"), v.literal("microsoft"));

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) appError("CONFIG", `${name} is not set on the Convex deployment.`);
  return val;
}
const callbackUri = () => `${requireEnv("CONVEX_SITE_URL")}/calendar/callback`;

// A staff row with a linked login → only that employee connects it. A login-less
// shared/resource calendar → managers connect it.
function manageAllowed(
  role: Doc<"memberships">["role"],
  staffUserId: Id<"users"> | undefined,
  caller: Id<"users">,
): boolean {
  return staffUserId ? staffUserId === caller : isManager(role);
}

async function freshToken(
  ctx: ActionCtx,
  conn: Doc<"calendarConnections">,
): Promise<string> {
  if (conn.expiryMs > Date.now() + 60_000) return conn.accessToken;
  const refreshed = await refreshTokens(conn.provider, conn.refreshToken);
  await ctx.runMutation(internal.calendar.updateAccess, {
    staffId: conn.staffId,
    accessToken: refreshed.accessToken,
    expiryMs: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
  });
  return refreshed.accessToken;
}

// --- Dashboard entry points -------------------------------------------------

export const assertAccess = internalQuery({
  args: { slug: v.string(), staffId: v.id("staff") },
  returns: v.object({ businessId: v.id("businesses") }),
  handler: async (ctx, args) => {
    const { business, userId, membership } = await requireMemberBySlug(
      ctx,
      args.slug,
    );
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.businessId !== business._id) {
      appError("NOT_FOUND", "That staff member no longer exists.");
    }
    if (!manageAllowed(membership.role, staff.userId, userId)) {
      appError(
        "FORBIDDEN",
        staff.userId
          ? "Only this staff member can connect their own calendar."
          : "Only an owner or admin can connect a shared calendar.",
      );
    }
    return { businessId: business._id };
  },
});

export const getAuthUrl = action({
  args: { slug: v.string(), staffId: v.id("staff"), provider: providerValidator },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const { businessId } = await ctx.runQuery(internal.calendar.assertAccess, {
      slug: args.slug,
      staffId: args.staffId,
    });
    const state = await signState(
      requireEnv("OAUTH_STATE_SECRET"),
      businessId,
      args.staffId,
      args.provider,
    );
    return { url: buildAuthUrl(args.provider, callbackUri(), state) };
  },
});

export const status = query({
  args: { slug: v.string(), staffId: v.id("staff") },
  handler: async (ctx, args) => {
    const { business, userId, membership } = await requireMemberBySlug(
      ctx,
      args.slug,
    );
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.businessId !== business._id) {
      return {
        connected: false,
        provider: null as Provider | null,
        email: null as string | null,
        canManage: false,
        hasLogin: false,
      };
    }
    const conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .unique();
    return {
      connected: !!conn,
      provider: conn?.provider ?? null,
      email: conn?.email ?? null,
      canManage: manageAllowed(membership.role, staff.userId, userId),
      hasLogin: !!staff.userId,
    };
  },
});

export const disconnect = action({
  args: { slug: v.string(), staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.calendar.assertAccess, {
      slug: args.slug,
      staffId: args.staffId,
    });
    await ctx.runMutation(internal.calendar.removeConnection, {
      staffId: args.staffId,
    });
    return null;
  },
});

export const syncBusy = action({
  args: { slug: v.string(), staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.calendar.assertAccess, {
      slug: args.slug,
      staffId: args.staffId,
    });
    await ctx.runAction(internal.calendar.syncStaffBusy, {
      staffId: args.staffId,
    });
    return null;
  },
});

// --- OAuth callback completion (from /calendar/callback) --------------------

export const completeConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args): Promise<{ slug: string }> => {
    const parsed = await verifyState(requireEnv("OAUTH_STATE_SECRET"), args.state);
    if (!parsed) {
      appError("INVALID_CREDENTIALS", "Invalid or expired connection request.");
    }

    const tokens = await exchangeCode(parsed.provider, args.code, callbackUri());
    const email = await fetchEmail(parsed.provider, tokens.accessToken);

    await ctx.runMutation(internal.calendar.upsertConnection, {
      businessId: parsed.businessId as Id<"businesses">,
      staffId: parsed.staffId as Id<"staff">,
      provider: parsed.provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryMs: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
      email,
    });
    await ctx.runAction(internal.calendar.syncStaffBusy, {
      staffId: parsed.staffId as Id<"staff">,
    });
    const slug = await ctx.runQuery(internal.calendar.slugForStaff, {
      staffId: parsed.staffId as Id<"staff">,
    });
    return { slug };
  },
});

export const syncStaffBusy = internalAction({
  args: { staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const conn = await ctx.runQuery(internal.calendar.connectionFor, {
      staffId: args.staffId,
    });
    if (!conn) return null;
    const token = await freshToken(ctx, conn);
    const spans = await fetchBusy(
      conn.provider,
      token,
      conn.calendarId,
      conn.email,
      Date.now(),
      Date.now() + 30 * 86_400_000,
    );
    await ctx.runMutation(internal.calendar.replaceBusy, {
      businessId: conn.businessId,
      staffId: args.staffId,
      spans,
    });
    return null;
  },
});

// --- Event write-back (scheduled from the booking mutations) ----------------

export const pushEvent = internalAction({
  args: { bookingId: v.id("bookings") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const data = await ctx.runQuery(internal.calendar.eventContext, {
      bookingId: args.bookingId,
    });
    if (!data || !data.conn || data.status !== "confirmed") return null;
    const token = await freshToken(ctx, data.conn);
    const eventId = await createEvent(
      data.conn.provider,
      token,
      data.conn.calendarId,
      {
        startMs: data.start,
        endMs: data.end,
        summary: `${data.customerName} — ${data.businessName}`,
        description: `Booked via Omnivo AI.\nCustomer: ${data.customerEmail}`,
      },
    );
    await ctx.runMutation(internal.calendar.setBookingEvent, {
      bookingId: args.bookingId,
      calendarEventId: eventId,
    });
    return null;
  },
});

export const removeEvent = internalAction({
  args: { staffId: v.id("staff"), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const conn = await ctx.runQuery(internal.calendar.connectionFor, {
      staffId: args.staffId,
    });
    if (!conn) return null;
    const token = await freshToken(ctx, conn);
    await deleteEvent(conn.provider, token, conn.calendarId, args.eventId);
    return null;
  },
});

// --- Internal data helpers --------------------------------------------------

export const connectionFor = internalQuery({
  args: { staffId: v.id("staff") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .unique();
  },
});

export const eventContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const bk = await ctx.db.get(args.bookingId);
    if (!bk) return null;
    const conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", bk.staffId))
      .unique();
    const business = await ctx.db.get(bk.businessId);
    return {
      conn,
      status: bk.status,
      start: bk.start,
      end: bk.end,
      customerName: bk.customerName,
      customerEmail: bk.customerEmail,
      businessName: business?.name ?? "Appointment",
    };
  },
});

export const slugForStaff = internalQuery({
  args: { staffId: v.id("staff") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const staff = await ctx.db.get(args.staffId);
    if (!staff) return "";
    const business = await ctx.db.get(staff.businessId);
    return business?.slug ?? "";
  },
});

export const upsertConnection = internalMutation({
  args: {
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    provider: providerValidator,
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiryMs: v.number(),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .unique();
    const refresh = args.refreshToken ?? existing?.refreshToken;
    if (!refresh) {
      appError(
        "CONFIG",
        "No refresh token returned — reconnect and grant offline access.",
      );
    }
    const doc = {
      businessId: args.businessId,
      staffId: args.staffId,
      provider: args.provider,
      accessToken: args.accessToken,
      refreshToken: refresh,
      expiryMs: args.expiryMs,
      email: args.email ?? existing?.email,
      calendarId: existing?.calendarId ?? "primary",
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("calendarConnections", doc);
    return null;
  },
});

export const updateAccess = internalMutation({
  args: {
    staffId: v.id("staff"),
    accessToken: v.string(),
    expiryMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        expiryMs: args.expiryMs,
      });
    }
    return null;
  },
});

export const replaceBusy = internalMutation({
  args: {
    businessId: v.id("businesses"),
    staffId: v.id("staff"),
    spans: v.array(v.object({ start: v.number(), end: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("calendarBusy")
      .withIndex("by_staff_start", (q) => q.eq("staffId", args.staffId))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);
    for (const span of args.spans) {
      await ctx.db.insert("calendarBusy", {
        businessId: args.businessId,
        staffId: args.staffId,
        start: span.start,
        end: span.end,
      });
    }
    return null;
  },
});

export const setBookingEvent = internalMutation({
  args: { bookingId: v.id("bookings"), calendarEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const bk = await ctx.db.get(args.bookingId);
    if (bk) await ctx.db.patch(args.bookingId, { calendarEventId: args.calendarEventId });
    return null;
  },
});

export const removeConnection = internalMutation({
  args: { staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .unique();
    if (conn) await ctx.db.delete(conn._id);
    const busy = await ctx.db
      .query("calendarBusy")
      .withIndex("by_staff_start", (q) => q.eq("staffId", args.staffId))
      .collect();
    for (const row of busy) await ctx.db.delete(row._id);
    return null;
  },
});
