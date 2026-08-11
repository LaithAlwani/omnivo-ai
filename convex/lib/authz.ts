import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "./errors";

// -----------------------------------------------------------------------------
// Authorization — the single place identity turns into permission. Every
// tenant-scoped function starts with one of these. Three planes, kept separate:
//   - requireMember       → dashboard (per-business membership)
//   - requirePlatformAdmin → cross-tenant support portal (operators only)
// (resolveTenantByKey for the public widget arrives with the widget phase.)
// -----------------------------------------------------------------------------

export type Role = Doc<"memberships">["role"];

// owner/admin are "managers"; staff is an "employee".
const RANK: Record<Role, number> = { staff: 1, admin: 2, owner: 3 };

async function currentUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) appError("UNAUTHENTICATED", "Please sign in to continue.");
  return userId;
}

/**
 * Require the caller to be a member of `businessId` at `minRole` or above.
 * Returns the caller's id + membership so handlers can branch on role.
 */
export async function requireMember(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  minRole: Role = "staff",
): Promise<{ userId: Id<"users">; membership: Doc<"memberships"> }> {
  const userId = await currentUserId(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_business", (q) =>
      q.eq("userId", userId).eq("businessId", businessId),
    )
    .unique();

  if (!membership) {
    appError("FORBIDDEN", "You're not a member of this business.");
  }
  if (RANK[membership.role] < RANK[minRole]) {
    appError("FORBIDDEN", `This action needs ${minRole} access or higher.`);
  }
  return { userId, membership };
}

export const isManager = (role: Role) => RANK[role] >= RANK.admin;

/**
 * Resolve a business by slug and require membership in one step — the common
 * shape for dashboard functions that take a `slug` argument.
 */
export async function requireMemberBySlug(
  ctx: QueryCtx,
  slug: string,
  minRole: Role = "staff",
): Promise<{
  business: Doc<"businesses">;
  userId: Id<"users">;
  membership: Doc<"memberships">;
}> {
  const business = await ctx.db
    .query("businesses")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!business) appError("NOT_FOUND", "That business doesn't exist.");
  const { userId, membership } = await requireMember(ctx, business._id, minRole);
  return { business, userId, membership };
}

/**
 * Require the caller to be a platform operator. `superadmin` gates assist/act-as;
 * `support` gates cross-tenant reads. This path bypasses tenant isolation, so
 * callers must audit every action.
 */
export async function requirePlatformAdmin(
  ctx: QueryCtx,
  minRole: Doc<"platformAdmins">["role"] = "support",
): Promise<{ userId: Id<"users">; admin: Doc<"platformAdmins"> }> {
  const userId = await currentUserId(ctx);
  const admin = await ctx.db
    .query("platformAdmins")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  if (!admin) appError("FORBIDDEN", "You don't have platform access.");
  if (minRole === "superadmin" && admin.role !== "superadmin") {
    appError("FORBIDDEN", "This action needs superadmin access.");
  }
  return { userId, admin };
}

/** Non-throwing platform check → the caller's id if they're an operator, else
 *  null. Used to let a platform admin act on any tenant without membership. */
export async function platformAdminIdOrNull(
  ctx: QueryCtx,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const admin = await ctx.db
    .query("platformAdmins")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return admin ? userId : null;
}

/** Who may edit a tenant's connections/config: a platform admin always, or a
 *  member-admin when the tenant self-manages (`provisioning !== "installer"`).
 *  An installer-provisioned tenant is edited only through the platform console.
 *  Returns the acting user's id. */
export async function requireInstallerAccess(
  ctx: QueryCtx,
  business: Doc<"businesses">,
): Promise<Id<"users">> {
  const platformId = await platformAdminIdOrNull(ctx);
  if (platformId) return platformId;
  if (business.provisioning === "installer") {
    appError(
      "FORBIDDEN",
      "This tenant is installer-managed — contact your installer to change connections.",
    );
  }
  const { userId } = await requireMember(ctx, business._id, "admin");
  return userId;
}

/** Who may run lifecycle ops (go-live / pause / invite): the business owner, or
 *  a platform admin. Returns the acting user's id. */
export async function requireOwnerOrPlatform(
  ctx: QueryCtx,
  business: Doc<"businesses">,
): Promise<Id<"users">> {
  const platformId = await platformAdminIdOrNull(ctx);
  if (platformId) return platformId;
  const { userId } = await requireMember(ctx, business._id, "owner");
  return userId;
}
