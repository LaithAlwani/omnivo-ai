"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/layout/logo";
import { AppShell, SidebarLink } from "@/components/app/app-shell";

function PlatformNav() {
  const pathname = usePathname();
  return (
    <SidebarLink href="/platform" active={pathname.startsWith("/platform")}>
      Businesses
    </SidebarLink>
  );
}

// The cross-tenant operator portal. Access is gated here for UX, but every
// underlying query independently enforces requirePlatformAdmin server-side — so
// this screen is convenience, not the real boundary.
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useQuery(api.platform.me);

  if (me === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-faint">
        Loading…
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-sm">
          <Logo />
          <h1 className="mt-8 font-display text-2xl text-bone">
            No platform access
          </h1>
          <p className="mt-2 text-sm text-muted">
            This area is for Omnivo operators only.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-block text-sm text-ember transition-colors hover:text-flare"
          >
            ← Back to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <AppShell nav={<PlatformNav />}>{children}</AppShell>;
}
