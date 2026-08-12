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
  replyTo?: string;
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

// --- Membership invitation ----------------------------------------------------

export const sendInviteEmail = internalAction({
  args: {
    to: v.string(),
    url: v.string(),
    businessName: v.string(),
    role: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, { to, url, businessName, role }) => {
    const intro = `You've been invited to ${businessName} on Omnivo AI as ${role === "owner" ? "the owner" : `a ${role}`}. Accept to get access.`;
    await sendEmail({
      to,
      subject: `You're invited to ${businessName} on Omnivo AI`,
      text: `${intro}\n\nAccept your invitation:\n${url}\n\n(This link expires in 7 days.)`,
      html: emailShell(
        `<h1 style="margin:16px 0 8px;font-size:20px;color:#ece4d8;">You're invited</h1>
         <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#b8ac9c;">${escapeHtml(intro)}</p>
         <a href="${url}" style="display:inline-block;background:#ff5c1a;color:#160b04;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:9999px;font-size:14px;">Accept invitation</a>`,
      ),
    });
    return null;
  },
});

// --- Connection health alert --------------------------------------------------

/** Operational alert to the business owner when a connection goes degraded — a
 *  plain system notice (not cap-gated / not from the tenant's domain). Phase C
 *  retargets this to the installer. */
export const sendConnectionDegraded = internalAction({
  args: {
    to: v.string(),
    businessName: v.string(),
    kind: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, { to, businessName, kind, error }) => {
    const label =
      kind === "booking"
        ? "booking"
        : kind === "crmInbound"
          ? "customer-lookup"
          : kind;
    const intro = `We couldn't reach the ${label} connection for ${businessName} after several attempts (${error}). Until it's back, your assistant will stop offering that and instead capture leads for your team to follow up.`;
    const action = "Please check the endpoint URL and credentials in your Omnivo dashboard.";
    await sendEmail({
      to,
      subject: `Action needed: your ${label} connection looks down`,
      text: `${intro}\n\n${action}\n\nOmnivo AI`,
      html: emailShell(
        `<h1 style="margin:16px 0 8px;font-size:20px;color:#ece4d8;">A connection needs attention</h1>
         <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#b8ac9c;">${escapeHtml(intro)}</p>
         <p style="margin:0;font-size:14px;line-height:1.55;color:#b8ac9c;">${escapeHtml(action)}</p>`,
      ),
    });
    return null;
  },
});

// --- Lead fallback (no CRM connected) ----------------------------------------

/** When a lead is captured but no outbound CRM is connected, email it to the
 *  responsible party (owner, or installer for installer-managed tenants) so it's
 *  never lost — with a nudge to connect a CRM, or have LA Digital set one up.
 *  Not cap-gated: when there's no CRM this is the only place the lead lands. */
export const sendLeadFallback = internalAction({
  args: {
    to: v.string(),
    businessName: v.string(),
    slug: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    // No transport configured (e.g. local/tests) → nothing to send; skip quietly.
    if (!process.env.SMTP_HOST) return null;

    const base = process.env.SITE_URL ?? "http://localhost:3000";
    const connectUrl = `${base}/dashboard/${args.slug}/integrations`;

    const rows: [string, string][] = [["Name", args.name]];
    if (args.email) rows.push(["Email", args.email]);
    if (args.phone) rows.push(["Phone", args.phone]);
    if (args.message) rows.push(["Message", args.message]);

    const detailsText = rows.map(([k, val]) => `${k}: ${val}`).join("\n");
    const nudgeText = `This lead isn't being saved to a CRM yet. Connect one to route new leads automatically: ${connectUrl}\n\nPrefer it done for you? LA Digital can set up a CRM and booking system — just reply to this email.`;

    // Best-effort: a fallback notification failing must never crash the capture
    // path that scheduled it (mirrors the demo-request client copy).
    try {
      await sendEmail({
        to: args.to,
        replyTo: supportAddress(),
        subject: `New lead for ${args.businessName}: ${args.name}`,
        text: `Your Omnivo assistant just captured a new lead.\n\n${detailsText}\n\n${nudgeText}\n\nOmnivo AI`,
        html: emailShell(
          `<h1 style="margin:16px 0 8px;font-size:20px;color:#ece4d8;">New lead for ${escapeHtml(args.businessName)}</h1>
         <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#b8ac9c;">Your Omnivo assistant just captured a lead:</p>
         <table style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#ece4d8;">
           ${rows.map(([k, val]) => `<tr><td style="padding:2px 12px 2px 0;color:#8c8175;">${escapeHtml(k)}</td><td>${escapeHtml(val)}</td></tr>`).join("")}
         </table>
         <p style="margin:0;font-size:13px;line-height:1.55;color:#b8ac9c;">This lead isn't being saved to a CRM yet. <a href="${connectUrl}" style="color:#ff5c1a;">Connect one</a> to route new leads automatically — or reply and LA Digital can set up a CRM and booking system for you.</p>`,
        ),
      });
    } catch (err) {
      console.error("lead-fallback email failed:", err);
    }
    return null;
  },
});

// --- Demo request (marketing "Book a demo" form) ------------------------------

/** Where new demo requests are routed. Overridable per-deployment. */
function supportAddress(): string {
  return process.env.SUPPORT_EMAIL ?? "support@omnivoai.ca";
}

/** Notify the team of a new demo request and send the requester a copy. The team
 *  notification is the one that must land, so it's awaited first; the requester's
 *  copy is best-effort and never fails the submission on its own. */
export const sendDemoRequest = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    phone: v.string(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const heading = args.subject
      ? `Demo request — ${args.name}: ${args.subject}`
      : `Demo request — ${args.name}`;

    // Team notification. Reply-To is the requester so a reply goes straight back
    // to them, not to the platform address.
    await sendEmail({
      to: supportAddress(),
      replyTo: args.email,
      subject: heading,
      text: demoRequestTeamText(args),
      html: demoRequestTeamHtml(args),
    });

    // Requester's copy — best effort. A bad address here shouldn't surface as a
    // failure once the team has already been notified.
    try {
      await sendEmail({
        to: args.email,
        subject: "We got your demo request — Omnivo AI",
        text: demoRequestClientText(args),
        html: demoRequestClientHtml(args),
      });
    } catch (err) {
      console.error("demo-request client copy failed:", err);
    }
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

/** Hydrate the booking, apply the gates, compose, send. Every customer with an
 *  email gets booking notices. */
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

/** Escape then turn newlines into <br> for multi-line values in HTML emails. */
function escapeMultiline(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

type DemoRequest = {
  name: string;
  email: string;
  subject: string;
  phone: string;
  message: string;
};

/** Internal notification — the branded card the team receives. */
function demoRequestTeamHtml(r: DemoRequest): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;font-size:13px;color:#9c9184;width:88px;vertical-align:top;">${label}</td><td style="padding:7px 0;font-size:15px;color:#ece4d8;font-weight:500;">${escapeHtml(value)}</td></tr>`;
  const rows = [
    row("Name", r.name),
    // Keep the address clickable for a quick reply.
    `<tr><td style="padding:7px 0;font-size:13px;color:#9c9184;width:88px;vertical-align:top;">Email</td><td style="padding:7px 0;font-size:15px;font-weight:500;"><a href="mailto:${escapeHtml(r.email)}" style="color:#ff8a4c;text-decoration:none;">${escapeHtml(r.email)}</a></td></tr>`,
    r.phone ? row("Phone", r.phone) : "",
    r.subject ? row("Subject", r.subject) : "",
  ].join("");

  const messageBlock = r.message
    ? `<div style="margin:4px 0 0;font-size:13px;color:#9c9184;">Message</div>
       <div style="margin:6px 0 0;padding:14px 16px;background:#0c0a08;border:1px solid rgba(236,228,216,0.12);border-radius:10px;font-size:14px;line-height:1.6;color:#ece4d8;">${escapeMultiline(r.message)}</div>`
    : "";

  return emailShell(`
    <h1 style="margin:16px 0 8px;font-size:22px;line-height:1.2;color:#ece4d8;font-weight:600;">New demo request</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#9c9184;">Someone asked to see Omnivo AI on their business. Reply to this email to reach them directly.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid rgba(236,228,216,0.12);border-bottom:1px solid rgba(236,228,216,0.12);margin:0 0 ${messageBlock ? "20px" : "4px"};">
      ${rows}
    </table>
    ${messageBlock}
  `);
}

function demoRequestTeamText(r: DemoRequest): string {
  return [
    "New demo request",
    "",
    `Name: ${r.name}`,
    `Email: ${r.email}`,
    r.phone ? `Phone: ${r.phone}` : null,
    r.subject ? `Subject: ${r.subject}` : null,
    r.message ? `\nMessage:\n${r.message}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Confirmation copy — what the requester receives, echoing their details. */
function demoRequestClientHtml(r: DemoRequest): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;font-size:13px;color:#9c9184;width:88px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:#ece4d8;">${escapeHtml(value)}</td></tr>`;
  const rows = [
    r.subject ? row("Subject", r.subject) : "",
    r.phone ? row("Phone", r.phone) : "",
    r.message ? row("Message", r.message) : "",
  ].join("");
  const recap = rows
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid rgba(236,228,216,0.12);border-bottom:1px solid rgba(236,228,216,0.12);margin:0 0 20px;">${rows}</table>`
    : "";

  return emailShell(`
    <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#ece4d8;font-weight:600;">Thanks, ${escapeHtml(r.name)} — we got it.</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#9c9184;">Your demo request is in. We&rsquo;ll reply within one business day to set up a fifteen-minute walkthrough on your own business. Here&rsquo;s what you sent us:</p>
    ${recap}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6357;">Need to add something? Just reply to this email.</p>
  `);
}

function demoRequestClientText(r: DemoRequest): string {
  return [
    `Thanks, ${r.name} — we got your demo request.`,
    "",
    "We'll reply within one business day to set up a fifteen-minute walkthrough on your own business.",
    "",
    "What you sent us:",
    `- Name: ${r.name}`,
    `- Email: ${r.email}`,
    r.phone ? `- Phone: ${r.phone}` : null,
    r.subject ? `- Subject: ${r.subject}` : null,
    r.message ? `- Message: ${r.message}` : null,
    "",
    "Need to add something? Just reply to this email.",
    "",
    "Omnivo AI",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function resetEmailHtml(url: string): string {
  return emailShell(`
    <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#ece4d8;font-weight:600;">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#9c9184;">Click the button below to choose a new password. This link is valid for 30 minutes.</p>
    <a href="${url}" style="display:inline-block;background:#ff5c1a;color:#160b04;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px;">Reset password</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6357;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `);
}
