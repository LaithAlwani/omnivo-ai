import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMemberBySlug } from "./lib/authz";
import { appError } from "./lib/errors";
import { randomHex } from "./lib/keys";
import { entitlementsFor } from "./entitlements";
import { planForBusiness } from "./lib/accounts";
import { whiteLabelEnabled } from "./lib/tiers";
import { resolveSmsSettings, inQuietHours } from "./lib/smsSettings";

// -----------------------------------------------------------------------------
// Review Management — after a booking completes, ask the customer how it went.
// A cron fans out to each review-enabled project, claims each newly-completed
// booking (idempotent via bookings.reviewRequestSentAt), and sends a request by
// SMS (if the SMS Automation module is on + a phone exists) or email. The public
// response page records sentiment: positive → the business's review link;
// negative → private feedback + an owner alert in the audit log.
// -----------------------------------------------------------------------------

// Only ask about bookings that finished within this window, so the first cron
// run doesn't text every historical customer.
const COMPLETED_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const PER_TENANT_LIMIT = 200;

/** Cron tick: fan out to each project with Review Management enabled. */
export const enqueueReviewRequests = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(1000);
    for (const b of businesses) {
      const e = await entitlementsFor(ctx, b._id);
      if (!e.reviewManagementEnabled) continue;
      await ctx.scheduler.runAfter(0, internal.reviews.requestForBusiness, {
        businessId: b._id,
      });
    }
    return null;
  },
});

/** Per-business: claim each newly-completed booking and send a review request. */
export const requestForBusiness = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const now = Date.now();
    // Completed = confirmed and ended, within the lookback. by_business_start is
    // keyed on `start`; we bound loosely and filter on `end`.
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) =>
        q
          .eq("businessId", businessId)
          .gte("start", now - COMPLETED_LOOKBACK_MS - 24 * 60 * 60 * 1000)
          .lte("start", now),
      )
      .take(PER_TENANT_LIMIT);

    const entitlements = await entitlementsFor(ctx, businessId);
    const business = await ctx.db.get(businessId);
    const settings = resolveSmsSettings(business?.smsSettings);

    for (const bk of rows) {
      if (bk.status !== "confirmed") continue;
      if (bk.end >= now) continue; // not finished yet
      if (bk.end < now - COMPLETED_LOOKBACK_MS) continue; // too old
      if (bk.reviewRequestSentAt) continue; // already asked
      if (!bk.customerEmail && !bk.customerPhone) continue;

      // Prefer SMS when the module + the SMS review toggle are on and we have a
      // number; else email.
      const wantSms =
        entitlements.smsAutomationEnabled &&
        !!bk.customerPhone &&
        settings.reviewRequestEnabled;
      // Quiet hours only suppress SMS — defer to a later tick (don't claim) so
      // it goes out after quiet hours; email requests aren't time-restricted.
      if (wantSms && inQuietHours(now, business?.timezone ?? null, settings)) {
        continue;
      }
      const channel = wantSms ? "sms" : "email";

      // Claim before scheduling the send so an overlapping tick can't double-ask.
      await ctx.db.patch(bk._id, { reviewRequestSentAt: now });

      const token = randomHex(16);
      const requestId = await ctx.db.insert("reviewRequests", {
        businessId,
        bookingId: bk._id,
        customerName: bk.customerName,
        customerEmail: bk.customerEmail || undefined,
        customerPhone: bk.customerPhone,
        channel,
        status: "pending",
        token,
      });

      if (channel === "sms") {
        await ctx.scheduler.runAfter(0, internal.sms.sendReviewRequest, {
          requestId,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.emailNode.sendReviewRequest, {
          requestId,
        });
      }
    }
    return null;
  },
});

/** Internal: context a send action needs (business name + link + recipient). */
export const requestContext = internalQuery({
  args: { requestId: v.id("reviewRequests") },
  returns: v.union(
    v.object({
      businessId: v.id("businesses"),
      businessName: v.string(),
      customerName: v.string(),
      customerEmail: v.union(v.string(), v.null()),
      customerPhone: v.union(v.string(), v.null()),
      token: v.string(),
      channel: v.union(v.literal("sms"), v.literal("email")),
      whiteLabel: v.boolean(),
      alreadySent: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req) return null;
    const business = await ctx.db.get(req.businessId);
    if (!business) return null;
    const plan = await planForBusiness(ctx, req.businessId);
    return {
      businessId: req.businessId,
      businessName: business.name,
      customerName: req.customerName,
      customerEmail: req.customerEmail ?? null,
      customerPhone: req.customerPhone ?? null,
      token: req.token,
      channel: req.channel,
      whiteLabel: whiteLabelEnabled(plan),
      alreadySent: req.status !== "pending",
    };
  },
});

/** Internal: mark a request sent after the channel delivered it. */
export const markSent = internalMutation({
  args: { requestId: v.id("reviewRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req || req.status !== "pending") return null;
    await ctx.db.patch(requestId, { status: "sent", sentAt: Date.now() });
    return null;
  },
});

// --- Public response --------------------------------------------------------

/** Public: what the response page shows (business name + review link on the
 *  positive path). Resolved by the opaque token. */
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      businessName: v.string(),
      reviewLink: v.union(v.string(), v.null()),
      status: v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("responded"),
      ),
      sentiment: v.union(v.literal("positive"), v.literal("negative"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { token }) => {
    const req = await ctx.db
      .query("reviewRequests")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!req) return null;
    const business = await ctx.db.get(req.businessId);
    if (!business) return null;
    return {
      businessName: business.name,
      reviewLink: business.reviewLink ?? null,
      status: req.status,
      sentiment: req.sentiment ?? null,
    };
  },
});

/** Public: record a customer's response. Positive → we return the review link
 *  for the page to send them to; negative → we store private feedback and log
 *  an owner alert. Idempotent-ish: a second response just updates the record. */
export const respond = mutation({
  args: {
    token: v.string(),
    sentiment: v.union(v.literal("positive"), v.literal("negative")),
    rating: v.optional(v.number()),
    feedback: v.optional(v.string()),
  },
  returns: v.object({ reviewLink: v.union(v.string(), v.null()) }),
  handler: async (ctx, { token, sentiment, rating, feedback }) => {
    const req = await ctx.db
      .query("reviewRequests")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!req) appError("NOT_FOUND", "This review link is no longer valid.");

    await ctx.db.patch(req._id, {
      status: "responded",
      sentiment,
      rating: rating !== undefined ? Math.max(1, Math.min(5, rating)) : undefined,
      feedback: feedback?.trim() || undefined,
      respondedAt: Date.now(),
    });

    const business = await ctx.db.get(req.businessId);

    // Integrations: push the response to any configured outbound CRM.
    const entitlements = await entitlementsFor(ctx, req.businessId);
    if (entitlements.integrationsEnabled) {
      await ctx.scheduler.runAfter(0, internal.integrationsNode.dispatch, {
        businessId: req.businessId,
        event: {
          type: "review.responded",
          data: {
            customerName: req.customerName,
            sentiment,
            rating: rating ?? null,
            feedback: feedback ?? null,
          },
        },
      });
    }

    // Negative feedback stays private and alerts the team via the audit trail.
    if (sentiment === "negative") {
      const owner = await ctx.db
        .query("memberships")
        .withIndex("by_business", (q) => q.eq("businessId", req.businessId))
        .filter((q) => q.eq(q.field("role"), "owner"))
        .first();
      if (owner) {
        await ctx.db.insert("auditLog", {
          actorUserId: owner.userId,
          scope: "business",
          businessId: req.businessId,
          action: "review.negative_feedback",
          targetId: req._id,
          meta: { rating, feedback: feedback?.slice(0, 500) ?? null },
          ts: Date.now(),
        });
      }
    }

    return {
      reviewLink:
        sentiment === "positive" ? business?.reviewLink ?? null : null,
    };
  },
});

// --- Dashboard --------------------------------------------------------------

/** Reviews dashboard: request/response funnel + rating summary. */
export const metrics = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const rows = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(2000);

    const sent = rows.filter((r) => r.status !== "pending").length;
    const responded = rows.filter((r) => r.status === "responded");
    const positive = responded.filter((r) => r.sentiment === "positive").length;
    const negative = responded.filter((r) => r.sentiment === "negative").length;
    const ratings = responded
      .map((r) => r.rating)
      .filter((n): n is number => typeof n === "number");
    const avgRating =
      ratings.length > 0
        ? ratings.reduce((s, n) => s + n, 0) / ratings.length
        : null;

    const recentNegative = responded
      .filter((r) => r.sentiment === "negative" && r.feedback)
      .sort((a, b) => (b.respondedAt ?? 0) - (a.respondedAt ?? 0))
      .slice(0, 10)
      .map((r) => ({
        _id: r._id,
        customerName: r.customerName,
        rating: r.rating ?? null,
        feedback: r.feedback ?? "",
        at: r.respondedAt ?? r._creationTime,
      }));

    return {
      reviewLink: business.reviewLink ?? null,
      requestsSent: sent,
      responses: responded.length,
      positive,
      negative,
      avgRating,
      recentNegative,
    };
  },
});

/** Set the public review link the positive path sends customers to (manager). */
export const setReviewLink = mutation({
  args: { slug: v.string(), reviewLink: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug, reviewLink }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const trimmed = reviewLink.trim();
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        appError("INVALID_INPUT", "Enter a full link, e.g. https://g.page/…");
      }
    }
    await ctx.db.patch(business._id, { reviewLink: trimmed || undefined });
    return null;
  },
});
