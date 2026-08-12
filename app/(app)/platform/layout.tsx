import { unauthorized } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { PlatformChrome } from "./platform-chrome";

// Server guard for the cross-tenant operator portal. Unauthenticated users are
// already bounced to /signin by the middleware; here we reject a signed-in user
// who isn't a platform admin with a real 401 (renders app/unauthorized.tsx).
// Every underlying query also enforces requirePlatformAdmin, so this is UX, not
// the security boundary.
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await convexAuthNextjsToken();
  const me = await fetchQuery(api.platform.me, {}, token ? { token } : {});
  if (!me) unauthorized();

  return <PlatformChrome>{children}</PlatformChrome>;
}
