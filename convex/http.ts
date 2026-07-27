import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

// Convex Auth's HTTP routes + the calendar OAuth callback + Twilio SMS status.
const http = httpRouter();
auth.addHttpRoutes(http);

// Twilio delivery-status callback (set as StatusCallback on each send). Twilio
// POSTs form-encoded fields; we only need to surface failures in the logs and
// acknowledge with 200 so Twilio doesn't retry.
http.route({
  path: "/twilio/status",
  method: "POST",
  handler: httpAction(async (_ctx, req) => {
    try {
      const form = new URLSearchParams(await req.text());
      const status = form.get("MessageStatus");
      if (status === "failed" || status === "undelivered") {
        console.error(
          `[sms] delivery ${status} sid=${form.get("MessageSid")} error=${form.get("ErrorCode")}`,
        );
      }
    } catch {
      // Malformed callback body — nothing actionable; still ack.
    }
    return new Response(null, { status: 200 });
  }),
});

// Google and Microsoft both redirect here after consent. The signed `state`
// proves which business + staff + provider to connect; we exchange the code and
// bounce back to the app.
http.route({
  path: "/calendar/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    const appUrl = process.env.SITE_URL ?? "http://localhost:3000";

    if (err || !code || !state) {
      return Response.redirect(`${appUrl}/dashboard?calendar=error`, 302);
    }
    try {
      const { slug } = await ctx.runAction(internal.calendar.completeConnect, {
        code,
        state,
      });
      return Response.redirect(
        `${appUrl}/dashboard/${slug}/schedule?calendar=connected`,
        302,
      );
    } catch {
      return Response.redirect(`${appUrl}/dashboard?calendar=error`, 302);
    }
  }),
});

export default http;
