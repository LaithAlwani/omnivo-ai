"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProvider } from "convex/react";

// A plain (no-auth) Convex client for the public embed widget. The widget never
// signs a user in — it authenticates the tenant with the publishable embed key
// on every call — so it deliberately skips the Convex Auth provider.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function PublicConvexProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
