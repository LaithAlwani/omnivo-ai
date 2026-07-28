"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { appError } from "./lib/errors";
import nodemailer from "nodemailer";

// Node-runtime email sending (Nodemailer over SMTP). Kept in its own file so no
// query/mutation ever imports Node built-ins. Configure on the deployment:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//   MAIL_FROM  (e.g. "Omnivo AI <no-reply@yourdomain.com>")
// TLS mode is derived from the port (465 = implicit TLS, 587/25/2525 = STARTTLS)
// so it can't be mismatched.

export const sendPasswordResetEmail = internalAction({
  args: { to: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (_ctx, { to, url }) => {
    const host = process.env.SMTP_HOST;
    if (!host) {
      appError(
        "CONFIG",
        "SMTP is not configured — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM on the Convex deployment.",
      );
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
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

    await transport.sendMail({
      from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
      to,
      subject: "Reset your Omnivo AI password",
      text: `Reset your Omnivo AI password using this link (valid for 30 minutes):\n\n${url}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: resetEmailHtml(url),
    });

    return null;
  },
});

function resetEmailHtml(url: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0c0a08;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ece4d8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#17130e;border:1px solid rgba(236,228,216,0.12);border-radius:14px;overflow:hidden;">
          <tr><td style="padding:32px 32px 8px;">
            <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#ff5c1a;font-weight:600;">Omnivo AI</div>
            <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#ece4d8;font-weight:600;">Reset your password</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#9c9184;">Click the button below to choose a new password. This link is valid for 30 minutes.</p>
            <a href="${url}" style="display:inline-block;background:#ff5c1a;color:#160b04;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:999px;">Reset password</a>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6357;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
