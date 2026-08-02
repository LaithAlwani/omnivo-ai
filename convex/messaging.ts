import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireMemberBySlug } from "./lib/authz";
import { entitlementsFor } from "./entitlements";
import { planForBusiness } from "./lib/accounts";
import { smsCap, usagePeriod } from "./lib/tiers";
import {
  resolveSmsSettings,
  type SmsSettings,
} from "./lib/smsSettings";

// -----------------------------------------------------------------------------
// Messaging (SMS) settings — per business. The SMS Automation module + the
// monthly cap gate whether SMS can send; these controls tune which events text
// and when (reminder lead time + quiet hours). Send gates read
// `settingsForBusiness`; the dashboard reads `getSettings`.
// -----------------------------------------------------------------------------

const settingsValidator = v.object({
  confirmationEnabled: v.boolean(),
  reminderEnabled: v.boolean(),
  reviewRequestEnabled: v.boolean(),
  leadFollowupEnabled: v.boolean(),
  reminderLeadHours: v.number(),
  quietStart: v.union(v.number(), v.null()),
  quietEnd: v.union(v.number(), v.null()),
});

/** Dashboard: resolved settings + whether SMS is active on this plan + usage. */
export const getSettings = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug);
    const entitlements = await entitlementsFor(ctx, business._id);
    const plan = await planForBusiness(ctx, business._id);

    let used = 0;
    if (business.accountId) {
      const counter = await ctx.db
        .query("usageCounters")
        .withIndex("by_account_period", (q) =>
          q
            .eq("accountId", business.accountId!)
            .eq("period", usagePeriod(Date.now())),
        )
        .unique();
      used = counter?.sms ?? 0;
    }

    return {
      settings: resolveSmsSettings(business.smsSettings),
      status: {
        moduleEnabled: entitlements.smsAutomationEnabled,
        cap: smsCap(plan),
        used,
        timezone: business.timezone ?? null,
      },
    };
  },
});

/** Internal: resolved settings for the send actions. */
export const settingsForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  returns: settingsValidator,
  handler: async (ctx, { businessId }): Promise<SmsSettings> => {
    const business = await ctx.db.get(businessId);
    return resolveSmsSettings(business?.smsSettings);
  },
});

/** Internal: authorize (manager) + report whether a test SMS can send. Identity
 *  forwarded from the Node test action. */
export const testContext = internalQuery({
  args: { slug: v.string() },
  returns: v.object({
    businessId: v.id("businesses"),
    moduleEnabled: v.boolean(),
    over: v.boolean(),
  }),
  handler: async (ctx, { slug }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    const entitlements = await entitlementsFor(ctx, business._id);
    const plan = await planForBusiness(ctx, business._id);
    const cap = smsCap(plan);
    let used = 0;
    if (business.accountId) {
      const counter = await ctx.db
        .query("usageCounters")
        .withIndex("by_account_period", (q) =>
          q
            .eq("accountId", business.accountId!)
            .eq("period", usagePeriod(Date.now())),
        )
        .unique();
      used = counter?.sms ?? 0;
    }
    return {
      businessId: business._id,
      moduleEnabled: entitlements.smsAutomationEnabled,
      over: cap !== null && used >= cap,
    };
  },
});

/** Update the SMS settings (manager only). */
export const updateSettings = mutation({
  args: { slug: v.string(), settings: settingsValidator },
  returns: v.null(),
  handler: async (ctx, { slug, settings }) => {
    const { business } = await requireMemberBySlug(ctx, slug, "admin");
    // Normalize/clamp before storing so the send path can trust the values.
    await ctx.db.patch(business._id, {
      smsSettings: resolveSmsSettings(settings),
    });
    return null;
  },
});
