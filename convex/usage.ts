import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { emailCap, smsCap, usagePeriod } from "./lib/tiers";
import { planForBusiness } from "./lib/accounts";

// -----------------------------------------------------------------------------
// Metered-usage counters (conversations live in conversations.ts; SMS + email
// here). Usage is POOLED across the account: one usageCounters row per account
// per "YYYY-MM". Increments are O(1) reads. Most callers hold only a businessId,
// so they resolve the owning account first.
// -----------------------------------------------------------------------------

/** The account a business belongs to (null before the backfill migration). */
async function accountIdFor(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
): Promise<Id<"accounts"> | null> {
  const business = await ctx.db.get(businessId);
  return business?.accountId ?? null;
}

/** Bump one field of this month's pooled counter (creating the row if needed). */
async function bump(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  field: "sms" | "email",
): Promise<void> {
  const accountId = await accountIdFor(ctx, businessId);
  if (!accountId) return;
  const period = usagePeriod(Date.now());
  const counter = await ctx.db
    .query("usageCounters")
    .withIndex("by_account_period", (q) =>
      q.eq("accountId", accountId).eq("period", period),
    )
    .unique();
  if (counter) {
    await ctx.db.patch(counter._id, { [field]: (counter[field] ?? 0) + 1 });
  } else {
    await ctx.db.insert("usageCounters", {
      accountId,
      period,
      conversations: 0,
      [field]: 1,
    });
  }
}

/** Where an account stands against a pooled monthly cap for `field`. */
async function capStatus(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  period: string,
  field: "sms" | "email",
): Promise<{ over: boolean; used: number; cap: number | null }> {
  const plan = await planForBusiness(ctx, businessId);
  const cap = field === "sms" ? smsCap(plan) : emailCap(plan);
  const accountId = await accountIdFor(ctx, businessId);
  let used = 0;
  if (accountId) {
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_account_period", (q) =>
        q.eq("accountId", accountId).eq("period", period),
      )
      .unique();
    used = counter?.[field] ?? 0;
  }
  return { over: cap !== null && used >= cap, used, cap };
}

/** Bump this month's email counter by one (platform-sent emails only). */
export const recordEmail = internalMutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    await bump(ctx, businessId, "email");
    return null;
  },
});

/** Whether the account has hit its monthly email cap. */
export const emailCapStatus = internalQuery({
  args: { businessId: v.id("businesses"), period: v.string() },
  returns: v.object({
    over: v.boolean(),
    used: v.number(),
    cap: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { businessId, period }) =>
    await capStatus(ctx, businessId, period, "email"),
});
