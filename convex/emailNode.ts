"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";
import { usagePeriod, whiteLabelEnabled } from "./lib/tiers";
import { sendEmail as resendSend } from "./lib/resend";
import nodemailer from "nodemailer";

/** Escape user/business-provided text before interpolating into email HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Node-runtime email sending (Nodemailer over SMTP). Kept in its own file so no
// query/mutation ever imports Node built-ins. A single platform SMTP account
// sends for every tenant; configure on the deployment:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//   MAIL_FROM  (e.g. "Omnivo AI <no-reply@yourdomain.com>")
// TLS mode is derived from the port (465 = implicit TLS, 587/25/2525 = STARTTLS)
// so it can't be mismatched.

/** Build a transport from env, or throw CONFIG if SMTP isn't set up. */
function makeTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) {
    appError(
      "CONFIG",
      "SMTP is not configured — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM on the Convex deployment.",
    );
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host,
    port,
    // Match TLS to the port: 465 uses implicit TLS; 587/25/2525 upgrade via
    // STARTTLS. Deriving this (instead of a separate flag) prevents the
    // "wrong version number" mismatch.
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

/** The bare email address from MAIL_FROM ("Name <addr>" or "addr"). */
function fromAddress(): string {
  const raw = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "";
  const m = raw.match(/<([^>]+)>/);
  return m ? m[1] : raw;
}

const quote = (name: string) => `"${name.replace(/["\r\n]/g, "")}"`;

/** Send through the platform SMTP account (Nodemailer). `fromName` overrides the
 *  display name while keeping the platform address. */
async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName?: string;
}): Promise<void> {
  const { fromName, ...mail } = opts;
  await makeTransport().sendMail({
    from: fromName
      ? `${quote(fromName)} <${fromAddress()}>`
      : (process.env.MAIL_FROM ?? process.env.SMTP_USER),
    ...mail,
  });
}

/** Deliver a business-scoped email: enforce the pooled monthly email cap, then
 *  send via the tenant's verified custom domain (Resend) when they have one, or
 *  the platform SMTP account otherwise. Both paths run on our infrastructure, so
 *  both count against the allowance. Returns whether it was sent. */
async function deliverBusinessEmail(
  ctx: ActionCtx,
  opts: {
    businessId: Id<"businesses">;
    to: string;
    fromName: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<boolean> {
  const { over } = await ctx.runQuery(internal.usage.emailCapStatus, {
    businessId: opts.businessId,
    period: usagePeriod(Date.now()),
  });
  if (over) return false;

  const domain = await ctx.runQuery(internal.emailDomains.configForBusiness, {
    businessId: opts.businessId,
  });
  if (domain) {
    await resendSend({
      from: `${quote(domain.fromName)} <${domain.fromEmail}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  } else {
    await sendEmail({
      to: opts.to,
      fromName: opts.fromName,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  }
  await ctx.runMutation(internal.usage.recordEmail, {
    businessId: opts.businessId,
  });
  return true;
}

// --- Password reset -----------------------------------------------------------

export const sendPasswordResetEmail = internalAction({
  args: { to: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (_ctx, { to, url }) => {
    await sendEmail({
      to,
      subject: "Reset your Omnivo AI password",
      text: `Reset your Omnivo AI password using this link (valid for 30 minutes):\n\n${url}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: resetEmailHtml(url),
    });
    return null;
  },
});

// --- Booking confirmation + reminder -----------------------------------------

export const sendBookingConfirmation = internalAction({
  args: { bookingId: v.id("bookings") },
  returns: v.null(),
  handler: (ctx, { bookingId }) => notifyBooking(ctx, bookingId, "confirmation"),
});

export const sendBookingReminder = internalAction({
  args: { bookingId: v.id("bookings") },
  returns: v.null(),
  handler: (ctx, { bookingId }) => notifyBooking(ctx, bookingId, "reminder"),
});

/** Public base for review-response links (the customer-facing apex host). */
function reviewUrl(token: string): string {
  const base = process.env.SITE_URL ?? "https://omnivoai.ca";
  return `${base.replace(/\/$/, "")}/r/${token}`;
}

/** Email a completed-booking customer a review request (Review Management). */
export const sendReviewRequest = internalAction({
  args: { requestId: v.id("reviewRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }): Promise<null> => {
    const info = await ctx.runQuery(internal.reviews.requestContext, {
      requestId,
    });
    if (!info || info.alreadySent || !info.customerEmail) return null;

    const url = reviewUrl(info.token);
    const intro = `Hi ${info.customerName}, thanks for visiting ${info.businessName}! We'd love to hear how it went.`;
    const sent = await deliverBusinessEmail(ctx, {
      businessId: info.businessId,
      to: info.customerEmail,
      fromName: info.businessName,
      subject: `How was your visit to ${info.businessName}?`,
      text: `${intro}\n\nShare your feedback: ${url}\n\n${info.businessName}${info.whiteLabel ? "" : "\n\nPowered by Omnivo AI"}`,
      html: emailShell(
        `<h1 style="margin:16px 0 8px;font-size:22px;color:#ece4d8;">How did we do?</h1>
         <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#b8ac9c;">${escapeHtml(intro)}</p>
         <a href="${url}" style="display:inline-block;background:#ff5c1a;color:#160b04;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:9999px;font-size:14px;">Leave feedback</a>`,
        { brand: info.businessName, poweredBy: !info.whiteLabel },
      ),
    });
    if (!sent) return null;
    await ctx.runMutation(internal.reviews.markSent, { requestId });
    return null;
  },
});

/** Email an open lead a nurture follow-up (Sales Assistant). */
export const sendLeadFollowup = internalAction({
  args: { leadId: v.id("leads") },
  returns: v.null(),
  handler: async (ctx, { leadId }): Promise<null> => {
    const info = await ctx.runQuery(internal.sales.followupContext, { leadId });
    if (!info || !info.email) return null;

    const intro = `Hi ${info.name}, this is ${info.businessName} following up${info.message ? ` about "${info.message.slice(0, 80)}"` : ""}. We'd love to help — just reply and we'll take it from there.`;
    await deliverBusinessEmail(ctx, {
      businessId: info.businessId,
      to: info.email,
      fromName: info.businessName,
      subject: `Still interested? — ${info.businessName}`,
      text: `${intro}\n\n${info.businessName}`,
      html: emailShell(
        `<h1 style="margin:16px 0 8px;font-size:22px;color:#ece4d8;">Still interested?</h1>
         <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#b8ac9c;">${escapeHtml(intro)}</p>`,
        { brand: info.businessName, poweredBy: !info.whiteLabel },
      ),
    });
    return null;
  },
});

/** Hydrate the booking, apply the gates, compose, send. Email isn't tier-gated
 *  (unlike SMS) — every customer with an email gets booking notices. */
async function notifyBooking(
  ctx: ActionCtx,
  bookingId: Id<"bookings">,
  kind: "confirmation" | "reminder",
): Promise<null> {
  const info = await ctx.runQuery(internal.bookings.notificationContext, {
    bookingId,
  });
  if (!info || info.status !== "confirmed") return null;
  if (!info.customerEmail) return null;

  const when = formatWhen(info.start, info.timezone);
  const subject =
    kind === "confirmation"
      ? `Your appointment with ${info.businessName} is confirmed`
      : `Reminder: your appointment with ${info.businessName}`;
  const heading =
    kind === "confirmation" ? "You're booked" : "Appointment reminder";
  const intro =
    kind === "confirmation"
      ? `Hi ${info.customerName}, your appointment with ${info.businessName} is confirmed.`
      : `Hi ${info.customerName}, this is a reminder of your upcoming appointment with ${info.businessName}.`;

  const lines = [
    `When: ${when}`,
    info.serviceName ? `Service: ${info.serviceName}` : null,
    info.staffName ? `With: ${info.staffName}` : null,
  ].filter(Boolean);

  // White-label (Professional+) drops the Omnivo attribution; every booking
  // email is branded as the business either way, since it goes to *their*
  // customer.
  const whiteLabel = whiteLabelEnabled(info.tier);

  // Sends via the tenant's verified custom domain (Resend) if set, else the
  // platform SMTP account — both metered against the pooled email allowance.
  await deliverBusinessEmail(ctx, {
    businessId: info.businessId,
    to: info.customerEmail,
    fromName: info.businessName,
    subject,
    text: `${intro}\n\n${lines.join("\n")}\n\nSee you then!\n${info.businessName}${whiteLabel ? "" : "\n\nPowered by Omnivo AI"}`,
    html: bookingEmailHtml({
      brand: info.businessName,
      poweredBy: !whiteLabel,
      heading,
      intro,
      when,
      serviceName: info.serviceName,
      staffName: info.staffName,
    }),
  });
  return null;
}

function formatWhen(startMs: number, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? "UTC",
    timeZoneName: "short",
  }).format(new Date(startMs));
}

// --- Templates ---------------------------------------------------------------

/** Shared branded card shell. `brand` sets the eyebrow (defaults to Omnivo AI);
 *  `poweredBy` appends the attribution footer for non-white-label tenants. */
function emailShell(
  inner: string,
  opts?: { brand?: string; poweredBy?: boolean },
): string {
  const brand = escapeHtml(opts?.brand ?? "Omnivo AI");
  const footer = opts?.poweredBy
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(236,228,216,0.10);font-size:11px;color:#6b6357;">Powered by Omnivo AI</div>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0c0a08;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ece4d8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#17130e;border:1px solid rgba(236,228,216,0.12);border-radius:14px;overflow:hidden;">
          <tr><td style="padding:32px 32px 28px;">
            <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#ff5c1a;font-weight:600;">${brand}</div>
            ${inner}
            ${footer}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function bookingEmailHtml(opts: {
  brand: string;
  poweredBy: boolean;
  heading: string;
  intro: string;
  when: string;
  serviceName: string | null;
  staffName: string | null;
}): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;font-size:13px;color:#9c9184;width:88px;vertical-align:top;">${label}</td><td style="padding:7px 0;font-size:15px;color:#ece4d8;font-weight:500;">${escapeHtml(value)}</td></tr>`;
  const rows = [
    row("When", opts.when),
    opts.serviceName ? row("Service", opts.serviceName) : "",
    opts.staffName ? row("With", opts.staffName) : "",
  ].join("");

  return emailShell(
    `
    <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#ece4d8;font-weight:600;">${escapeHtml(opts.heading)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#9c9184;">${escapeHtml(opts.intro)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid rgba(236,228,216,0.12);border-bottom:1px solid rgba(236,228,216,0.12);margin:0 0 20px;">
      ${rows}
    </table>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6357;">Need to change or cancel? Reply to this email and we'll help.</p>
  `,
    { brand: opts.brand, poweredBy: opts.poweredBy },
  );
}

function resetEmailHtml(url: string): string {
  return emailShell(`
    <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#ece4d8;font-weight:600;">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#9c9184;">Click the button below to choose a new password. This link is valid for 30 minutes.</p>
    <a href="${url}" style="display:inline-block;background:#ff5c1a;color:#160b04;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px;">Reset password</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6357;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `);
}
