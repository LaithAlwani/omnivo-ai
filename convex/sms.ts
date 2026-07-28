import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Transactional SMS (Twilio REST). A single *platform* Twilio account sends for
// every tenant. Configure once on the Convex deployment:
//
//   TWILIO_ACCOUNT_SID          (always required — identifies the account)
//   Auth, in order of preference:
//     TWILIO_API_KEY + TWILIO_API_SECRET   (recommended: scoped, rotatable)
//     TWILIO_AUTH_TOKEN                     (fallback: the primary token)
//   Sender, in order of preference:
//     TWILIO_MESSAGING_SERVICE_SID (MG…)   (recommended: number pool + 10DLC)
//     TWILIO_FROM                           (fallback: one E.164 number)
//
// Delivery receipts POST back to /twilio/status (see http.ts).
//
// `fetch` runs in the default Convex runtime, so no "use node" here — which
// keeps this file free of Node built-ins and safe to colocate with the actions.
// -----------------------------------------------------------------------------

// SMS is a paid-plan feature (Professional and up) — enforced server-side, never
// trusted from the client.
function smsEnabled(tier: "starter" | "professional" | "enterprise"): boolean {
  return tier !== "starter";
}

// Best-effort E.164 normalization. Returns null when we can't be confident, so
// we skip rather than hand Twilio a number it will reject.
function toE164(raw: string): string | null {
  const t = raw.trim();
  if (t.startsWith("+")) {
    const digits = t.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }
  const digits = t.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`; // assume NANP
  return null;
}

function formatWhen(startMs: number, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? "UTC",
  }).format(new Date(startMs));
}

/** Send one SMS via the platform Twilio account. Throws CONFIG if unconfigured. */
async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) {
    appError(
      "CONFIG",
      "SMS is not configured — set TWILIO_ACCOUNT_SID on the Convex deployment.",
    );
  }

  // Auth: prefer a scoped API key/secret; fall back to the account auth token.
  // The URL always targets the account SID either way.
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  let authUser: string;
  let authPass: string;
  if (apiKey && apiSecret) {
    authUser = apiKey;
    authPass = apiSecret;
  } else if (authToken) {
    authUser = accountSid;
    authPass = authToken;
  } else {
    appError(
      "CONFIG",
      "SMS auth is not configured — set TWILIO_API_KEY + TWILIO_API_SECRET (recommended) or TWILIO_AUTH_TOKEN.",
    );
  }

  const params = new URLSearchParams({ To: to, Body: body });
  // Sender: prefer a Messaging Service (number pool + 10DLC/compliance); fall
  // back to a single From number.
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else if (from) {
    params.set("From", from);
  } else {
    appError(
      "CONFIG",
      "SMS sender is not configured — set TWILIO_MESSAGING_SERVICE_SID (recommended) or TWILIO_FROM.",
    );
  }

  // Ask Twilio to POST delivery status back so failures surface in our logs.
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (siteUrl) params.set("StatusCallback", `${siteUrl}/twilio/status`);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${authUser}:${authPass}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    appError(
      "CONFIG",
      `Twilio rejected the message (${res.status}). ${detail.slice(0, 300)}`,
    );
  }
}

/** Shared: hydrate a booking, apply the gates, compose, send. */
async function notifyBooking(
  ctx: ActionCtx,
  bookingId: Id<"bookings">,
  kind: "confirmation" | "reminder",
): Promise<null> {
  const info = await ctx.runQuery(internal.bookings.notificationContext, {
    bookingId,
  });
  // Gates: booking still active, plan allows SMS, and we have a usable number.
  if (!info || info.status !== "confirmed") return null;
  if (!smsEnabled(info.tier)) return null;
  if (!info.customerPhone) return null;
  const to = toE164(info.customerPhone);
  if (!to) return null;

  const when = formatWhen(info.start, info.timezone);
  const withWhom = info.staffName ? ` with ${info.staffName}` : "";
  const what = info.serviceName ? ` (${info.serviceName})` : "";

  const body =
    kind === "confirmation"
      ? `${info.businessName}: you're booked${what} for ${when}${withWhom}. See you then! — reply to this number to reschedule.`
      : `Reminder from ${info.businessName}: your appointment${what} is ${when}${withWhom}. See you soon!`;

  await sendSms(to, body);
  return null;
}

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
