import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { enforceDemoRequestLimit } from "./rateLimiter";

// -----------------------------------------------------------------------------
// Public surface for the marketing "Book a demo" form. There is no tenant and no
// login here — anyone on the site can submit — so the handler validates every
// field, rate-limits the tenant-less surface, then hands off to the Node email
// action which notifies the team and sends the requester a copy. Nothing is
// persisted; the request lives in the two emails it produces.
// -----------------------------------------------------------------------------

// Length caps mirror the server-side validation the form does client-side, so a
// crafted request can't push a huge payload into an email.
const MAX = {
  name: 120,
  email: 200,
  subject: 160,
  phone: 40,
  message: 4000,
} as const;

// Deliberately loose: one @, a dot in the domain, no spaces. Real validity is
// proven only by the copy landing in their inbox.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Submit a demo request. Emails the team and the requester; returns nothing. */
export const submit = action({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  // Explicit return type: this action references the generated `internal` object
  // for a cross-runtime call, which can otherwise trip TS circular inference.
  handler: async (ctx, args): Promise<null> => {
    const name = args.name.trim();
    const email = args.email.trim();
    const subject = args.subject?.trim() ?? "";
    const phone = args.phone?.trim() ?? "";
    const message = args.message?.trim() ?? "";

    if (!name) appError("INVALID_INPUT", "Please enter your name.");
    if (name.length > MAX.name) {
      appError("INVALID_INPUT", "That name is too long.");
    }
    if (!EMAIL_RE.test(email) || email.length > MAX.email) {
      appError("INVALID_INPUT", "Please enter a valid email address.");
    }
    if (subject.length > MAX.subject) {
      appError("INVALID_INPUT", "That subject is too long.");
    }
    if (phone.length > MAX.phone) {
      appError("INVALID_INPUT", "That phone number is too long.");
    }
    if (message.length > MAX.message) {
      appError("INVALID_INPUT", "That message is too long (4000 characters max).");
    }

    await enforceDemoRequestLimit(ctx, email.toLowerCase());

    await ctx.runAction(internal.emailNode.sendDemoRequest, {
      name,
      email,
      subject,
      phone,
      message,
    });
    return null;
  },
});
