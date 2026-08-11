import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOwnerOrPlatform } from "./lib/authz";
import { recordAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { roleValidator } from "./schema";

// -----------------------------------------------------------------------------
// Membership invitations. An owner or installer emails a link carrying a hashed,
// single-use token. Accepting either adds the caller as a member or — for an
// installer "claim" — transfers ownership from the placeholder shell user
// (created by platform.provisionForClient) to the real signed-up user. Mirrors
// the custom password-reset flow (passwordReset.ts).
// -----------------------------------------------------------------------------

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Send an invitation. Owner (of the business) or a platform admin may invite. */
export const invite = action({
  args: {
    businessId: v.id("businesses"),
    email: v.string(),
    role: roleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) appError("INVALID_INPUT", "Enter a valid email.");
    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    const info: { businessName: string } = await ctx.runMutation(
      internal.invitations.store,
      {
        businessId: args.businessId,
        email,
        role: args.role,
        tokenHash,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      },
    );

    const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
    await ctx.runAction(internal.emailNode.sendInviteEmail, {
      to: email,
      url: `${siteUrl}/accept-invite?token=${token}`,
      businessName: info.businessName,
      role: args.role,
    });
    return null;
  },
});

/** Authorize + persist an invitation (clearing any prior one for the same
 *  business+email). */
export const store = internalMutation({
  args: {
    businessId: v.id("businesses"),
    email: v.string(),
    role: roleValidator,
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.object({ businessName: v.string() }),
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) appError("NOT_FOUND", "That business doesn't exist.");
    const actorUserId = await requireOwnerOrPlatform(ctx, business);

    const prior = await ctx.db
      .query("invitations")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    for (const row of prior) {
      if (row.email === args.email) await ctx.db.delete(row._id);
    }

    await ctx.db.insert("invitations", {
      businessId: args.businessId,
      email: args.email,
      role: args.role,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      invitedByUserId: actorUserId,
    });
    await recordAudit(ctx, {
      actorUserId,
      scope: "business",
      businessId: args.businessId,
      action: "invite.sent",
      meta: { email: args.email, role: args.role },
    });
    return { businessName: business.name };
  },
});

/** Accept an invitation (caller must be signed in). Returns the business slug to
 *  redirect to. */
export const accept = action({
  args: { token: v.string() },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args): Promise<{ slug: string }> => {
    const tokenHash = await sha256Hex(args.token);
    const slug: string | null = await ctx.runMutation(
      internal.invitations.consume,
      { tokenHash },
    );
    if (slug === null) {
      appError("INVALID_CREDENTIALS", "This invite is invalid or has expired.");
    }
    return { slug };
  },
});

/** Consume the token: add the caller as a member, or transfer ownership from the
 *  installer's placeholder shell user (a "claim"). Single-use. */
export const consume = internalMutation({
  args: { tokenHash: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { tokenHash }) => {
    const caller = await getAuthUserId(ctx);
    if (!caller) appError("UNAUTHENTICATED", "Sign in to accept this invite.");

    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!invite) return null;
    await ctx.db.delete(invite._id);
    if (invite.expiresAt < Date.now()) return null;

    const business = await ctx.db.get(invite.businessId);
    if (!business) return null;

    // Installer claim: the current owner is the placeholder shell user (created
    // by provisionForClient, carrying the client's email). Transfer to the
    // caller instead of adding a second owner.
    const ownerMembership = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", invite.businessId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    const ownerUser = ownerMembership
      ? await ctx.db.get(ownerMembership.userId)
      : null;
    const isClaim =
      business.provisioning === "installer" &&
      ownerMembership !== null &&
      ownerUser?.email === invite.email &&
      ownerMembership.userId !== caller;

    if (isClaim && ownerMembership) {
      const shellUserId = ownerMembership.userId;
      // Move the owner membership to the caller.
      await ctx.db.patch(ownerMembership._id, { userId: caller });
      // Reassign the account owner too — but only if the caller doesn't already
      // own an account (keeps `accounts.by_owner` unique).
      if (business.accountId) {
        const callerAccount = await ctx.db
          .query("accounts")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", caller))
          .unique();
        if (!callerAccount) {
          await ctx.db.patch(business.accountId, { ownerUserId: caller });
        }
      }
      // Retire the placeholder (no auth was ever attached to it).
      await ctx.db.delete(shellUserId);
    } else {
      // Regular teammate invite: add a membership if not already present.
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user_business", (q) =>
          q.eq("userId", caller).eq("businessId", invite.businessId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("memberships", {
          userId: caller,
          businessId: invite.businessId,
          role: invite.role,
        });
      }
    }

    await recordAudit(ctx, {
      actorUserId: caller,
      scope: "business",
      businessId: invite.businessId,
      action: isClaim ? "invite.claimed" : "invite.accepted",
    });
    return business.slug;
  },
});
