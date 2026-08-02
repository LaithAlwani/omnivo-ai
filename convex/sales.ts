import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMemberBySlug } from "./lib/authz";
import { entitlementsFor } from "./entitlements";
import { planForBusiness } from "./lib/accounts";
import { whiteLabelEnabled } from "./lib/tiers";
import { resolveSmsSettings, inQuietHours } from "./lib/smsSettings";

// -----------------------------------------------------------------------------
// Sales Assistant — self-contained lead conversion. Beyond the shared capture +
// booking + qualification skills (granted via the capability registry), this
// adds two workflows: a nurture cron that follows up with un-converted leads so
// none go cold, and a hot-lead alert when a promising lead is captured. Both are
// idempotent (lastFollowupAt / qualified) and mirror the reminder fan-out.
// -----------------------------------------------------------------------------

// Follow up at most this many times, no sooner than this often, and only while
// the lead is fresh enough to be worth chasing.
const MAX_FOLLOWUPS = 3;
const FOLLOWUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEAD_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const PER_TENANT_LIMIT = 200;

/** Cron tick: fan out to each project with the Sales Assistant enabled. */
export const enqueueFollowups = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(1000);
    for (const b of businesses) {
      const e = await entitlementsFor(ctx, b._id);
      if (!e.salesAssistantEnabled) continue;
      await ctx.scheduler.runAfter(0, internal.sales.followupForBusiness, {
        businessId: b._id,
      });
    }
    return null;
  },
});

/** Per-business: nurture open leads that are due for a follow-up. */
export const followupForBusiness = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const now = Date.now();
    const entitlements = await entitlementsFor(ctx, businessId);
    const business = await ctx.db.get(businessId);
    const settings = resolveSmsSettings(business?.smsSettings);

    // Open pipeline = new + contacted (won/lost/qualified are settled).
    const open = [
      ...(await ctx.db
        .query("leads")
        .withIndex("by_business_status", (q) =>
          q.eq("businessId", businessId).eq("status", "new"),
        )
        .take(PER_TENANT_LIMIT)),
      ...(await ctx.db
        .query("leads")
        .withIndex("by_business_status", (q) =>
          q.eq("businessId", businessId).eq("status", "contacted"),
        )
        .take(PER_TENANT_LIMIT)),
    ];

    for (const lead of open) {
      if (lead._creationTime < now - LEAD_STALE_MS) continue;
      if ((lead.followupCount ?? 0) >= MAX_FOLLOWUPS) continue;
      if (lead.lastFollowupAt && now - lead.lastFollowupAt < FOLLOWUP_INTERVAL_MS)
        continue;
      if (!lead.email && !lead.phone) continue;

      // SMS follow-up needs the module + the SMS follow-up toggle + a number;
      // else fall back to email. Quiet hours only suppress SMS — defer (don't
      // claim) so it goes out later; email follow-ups aren't time-restricted.
      const useSms =
        entitlements.smsAutomationEnabled &&
        !!lead.phone &&
        settings.leadFollowupEnabled;
      if (useSms && inQuietHours(now, business?.timezone ?? null, settings)) {
        continue;
      }

      // Claim before scheduling so an overlapping tick can't double-send.
      await ctx.db.patch(lead._id, {
        lastFollowupAt: now,
        followupCount: (lead.followupCount ?? 0) + 1,
        status: lead.status === "new" ? "contacted" : lead.status,
        updatedAt: now,
      });

      if (useSms) {
        await ctx.scheduler.runAfter(0, internal.sms.sendLeadFollowup, {
          leadId: lead._id,
        });
      } else if (lead.email) {
        await ctx.scheduler.runAfter(0, internal.emailNode.sendLeadFollowup, {
          leadId: lead._id,
        });
      }
    }
    return null;
  },
});

/** Internal: context a follow-up send action needs. */
export const followupContext = internalQuery({
  args: { leadId: v.id("leads") },
  returns: v.union(
    v.object({
      businessId: v.id("businesses"),
      businessName: v.string(),
      name: v.string(),
      email: v.union(v.string(), v.null()),
      phone: v.union(v.string(), v.null()),
      message: v.union(v.string(), v.null()),
      whiteLabel: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;
    const business = await ctx.db.get(lead.businessId);
    if (!business) return null;
    const plan = await planForBusiness(ctx, lead.businessId);
    return {
      businessId: lead.businessId,
      businessName: business.name,
      name: lead.name,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      message: lead.message ?? null,
      whiteLabel: whiteLabelEnabled(plan),
    };
  },
});

// --- Hot-lead alert ---------------------------------------------------------

/** Scheduled from lead capture when the Sales Assistant is on: flag a promising
 *  lead (has intent + a way to reach them) and alert the owner via the audit
 *  trail. Idempotent — only fires while the lead is still `new`. */
export const onLeadCaptured = internalMutation({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.status !== "new" || lead.qualified) return null;
    const hot = !!lead.message && (!!lead.email || !!lead.phone);
    if (!hot) return null;

    await ctx.db.patch(leadId, { qualified: true, updatedAt: Date.now() });

    const owner = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", lead.businessId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    if (owner) {
      await ctx.db.insert("auditLog", {
        actorUserId: owner.userId,
        scope: "business",
        businessId: lead.businessId,
        action: "sales.hot_lead",
        targetId: leadId,
        meta: {
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          message: lead.message?.slice(0, 500) ?? null,
        },
        ts: Date.now(),
      });
    }
    return null;
  },
});

// --- Dashboard --------------------------------------------------------------

/** Sales dashboard: pipeline funnel + conversion + recent hot leads. */
export const metrics = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_business", (q) => q.eq("businessId", business._id))
      .take(5000);

    const byStatus = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
    let hot = 0;
    for (const l of leads) {
      byStatus[l.status] += 1;
      if (l.qualified) hot += 1;
    }
    const total = leads.length;
    const won = byStatus.won;
    const conversion = total > 0 ? won / total : 0;

    // Appointments the assistant booked (a proxy for conversions it drove).
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_business_start", (q) => q.eq("businessId", business._id))
      .take(5000);
    const assistantBooked = bookings.filter(
      (b) => b.source === "assistant",
    ).length;

    return {
      total,
      byStatus,
      hotLeads: hot,
      appointmentsBooked: assistantBooked,
      conversion,
    };
  },
});
