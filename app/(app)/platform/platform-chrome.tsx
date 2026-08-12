"use client";

import { usePathname } from "next/navigation";
import { AppShell, SidebarLink } from "@/components/app/app-shell";

function PlatformNav() {
  const pathname = usePathname();
  return (
    <>
      <SidebarLink
        href="/platform"
        active={pathname === "/platform" || /^\/platform\/[^/]+$/.test(pathname)}
      >
        Businesses
      </SidebarLink>
      <SidebarLink href="/platform/new" active={pathname === "/platform/new"}>
        New tenant
      </SidebarLink>
    </>
  );
}

/** Client chrome for the operator portal. Access is enforced by the server
 *  layout (throws unauthorized() for non-admins), so this just renders shell. */
export function PlatformChrome({ children }: { children: React.ReactNode }) {
  return <AppShell nav={<PlatformNav />}>{children}</AppShell>;
}
