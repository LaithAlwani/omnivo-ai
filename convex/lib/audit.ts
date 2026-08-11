import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Audit trail helper. Cross-tenant platform-admin actions and sensitive business
// lifecycle ops (go-live, hand-off, provisioning, connection edits) write a row
// here so operator actions are accountable. One insert; callers pass the actor
// they already resolved from authz.
// -----------------------------------------------------------------------------

export async function recordAudit(
  ctx: MutationCtx,
  entry: {
    actorUserId: Id<"users">;
    scope: "platform" | "business";
    action: string;
    businessId?: Id<"businesses">;
    targetId?: string;
    meta?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorUserId: entry.actorUserId,
    scope: entry.scope,
    businessId: entry.businessId,
    action: entry.action,
    targetId: entry.targetId,
    meta: entry.meta,
    ts: Date.now(),
  });
}
