import { PublicConvexProvider } from "@/components/providers/public-convex-provider";

// The embed plane — the public chat widget, loaded inside an iframe on customer
// sites. Its own route group so it gets the no-auth Convex client, never the
// dashboard's Auth runtime. Transparent background so the iframe blends in.
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicConvexProvider>{children}</PublicConvexProvider>;
}
