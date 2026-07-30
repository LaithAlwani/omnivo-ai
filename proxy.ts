import { NextResponse } from "next/server";
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Next 16 middleware (formerly middleware.ts). Two jobs:
//   1. Hostname split — app.omnivoai.ca serves the portal, omnivoai.ca serves
//      marketing. Each plane's routes are redirected to the host they belong to.
//   2. Auth gating — the portal (dashboard) requires a session.
//
// The hostname split only fires on the real production hosts, so it stays inert
// on localhost and *.vercel.app previews, where everything is path-based.

const APEX = "omnivoai.ca";
const APP_HOST = `app.${APEX}`;

// Portal / authenticated plane — lives on app.omnivoai.ca.
const isAppRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/platform(.*)",
  "/signin(.*)",
  "/forgot-password(.*)",
  "/reset-password(.*)",
]);
// Cross-origin infra that must stay reachable on the apex regardless of host.
const isSharedRoute = createRouteMatcher([
  "/embed(.*)",
  "/r/(.*)", // public review-response pages
  "/widget.js",
  "/api(.*)",
]);

const isProtected = createRouteMatcher(["/dashboard(.*)", "/platform(.*)"]);
const isSignIn = createRouteMatcher(["/signin(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const host = request.headers.get("host") ?? "";
  const { pathname, search } = request.nextUrl;

  const onAppHost = host === APP_HOST;
  const onApexHost = host === APEX || host === `www.${APEX}`;

  // ---- 1. Hostname split (production hosts only) --------------------------
  if (onAppHost) {
    // The portal's front door is the dashboard.
    if (pathname === "/") {
      return nextjsMiddlewareRedirect(request, "/dashboard");
    }
    // Anything that isn't a portal or shared route belongs on the apex.
    if (!isAppRoute(request) && !isSharedRoute(request)) {
      return NextResponse.redirect(
        new URL(pathname + search, `https://${APEX}`)
      );
    }
  } else if (onApexHost) {
    // Portal routes don't belong on the marketing host — send them to the app.
    if (isAppRoute(request)) {
      return NextResponse.redirect(
        new URL(pathname + search, `https://${APP_HOST}`)
      );
    }
  }

  // ---- 2. Auth gating (all hosts) ----------------------------------------
  const authed = await convexAuth.isAuthenticated();
  if (isProtected(request) && !authed) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
  if (isSignIn(request) && authed) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
});

export const config = {
  // Guardrail #4: never run on static assets — keeps the marketing CDN path clean.
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?|txt|xml)$).*)",
  ],
};
