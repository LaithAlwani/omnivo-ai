import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

// Convex Auth's HTTP routes + the Stripe billing webhook.
const http = httpRouter();
auth.addHttpRoutes(http);

// Stripe webhook. Signature verification needs the RAW body, so we read it as
// text and hand it (plus the signature header) to a Node action that verifies
// and applies the event. Ack 2xx quickly; return 400 on a bad signature so
// Stripe surfaces the failure instead of silently retrying forever.
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature", { status: 400 });
    const body = await req.text();
    const { ok } = await ctx.runAction(internal.billing.handleWebhook, {
      body,
      signature,
    });
    return new Response(null, { status: ok ? 200 : 400 });
  }),
});

export default http;
