import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Plan } from "./tiers";
import { projectLimit, locationLimit } from "./tiers";

// -----------------------------------------------------------------------------
// Account resolution — the bridge from a project (business) to its owning
// account (the subscription). Usage is pooled and plan limits are enforced at
// the account level, but most internal functions only hold a `businessId`, so
// they resolve through here. During the account backfill migration a business
// may not yet carry an `accountId`; callers fall back to the legacy per-business
// `tier` for the plan and skip pooled writes only when no account exists.
// -----------------------------------------------------------------------------

/** The account row a business belongs to, or null before it's been backfilled. */
export async function accountForBusiness(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
): Promise<Doc<"accounts"> | null> {
  const business = await ctx.db.get(businessId);
  if (!business?.accountId) return null;
  return await ctx.db.get(business.accountId);
}

/** Resolve the effective plan for a business: its account's plan, falling back
 *  to the legacy per-business tier during migration, then to "starter". */
export async function planForBusiness(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
): Promise<Plan> {
  const business = await ctx.db.get(businessId);
  if (business?.accountId) {
    const account = await ctx.db.get(business.accountId);
    if (account) return account.plan;
  }
  return business?.tier ?? "starter";
}

/** The account's effective project limit (override wins over the plan default). */
export function accountProjectLimit(account: Doc<"accounts">): number | null {
  return account.projectLimitOverride !== undefined
    ? account.projectLimitOverride
    : projectLimit(account.plan);
}

/** The account's effective location limit: an explicit override wins; otherwise
 *  the plan's included count plus any extra locations bought ($19.99/mo each). */
export function accountLocationLimit(account: Doc<"accounts">): number | null {
  if (account.locationLimitOverride !== undefined) {
    return account.locationLimitOverride;
  }
  const base = locationLimit(account.plan);
  if (base === null) return null; // unlimited
  return base + (account.paidLocations ?? 0);
}
