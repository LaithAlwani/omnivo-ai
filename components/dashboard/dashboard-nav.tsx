"use client";

import { usePathname } from "next/navigation";
import { SidebarLink } from "@/components/app/app-shell";

// Sidebar items grow with each Phase 1 slice (Team, Knowledge, Chat).
function navItems(slug: string) {
  return [
    { label: "Overview", href: `/dashboard/${slug}`, exact: true },
    { label: "Branding", href: `/dashboard/${slug}/branding`, exact: false },
    { label: "Team", href: `/dashboard/${slug}/team`, exact: false },
    { label: "Services", href: `/dashboard/${slug}/services`, exact: false },
    { label: "Schedule", href: `/dashboard/${slug}/schedule`, exact: false },
    { label: "Bookings", href: `/dashboard/${slug}/bookings`, exact: false },
    { label: "Leads", href: `/dashboard/${slug}/leads`, exact: false },
    { label: "Knowledge", href: `/dashboard/${slug}/knowledge`, exact: false },
    { label: "Assistant", href: `/dashboard/${slug}/assistant`, exact: false },
  ];
}

/** The dashboard section links — rendered inside AppShell's sidebar `nav` slot. */
export function DashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <>
      {navItems(slug).map((item) => (
        <SidebarLink
          key={item.href}
          href={item.href}
          active={
            item.exact ? pathname === item.href : pathname.startsWith(item.href)
          }
        >
          {item.label}
        </SidebarLink>
      ))}
    </>
  );
}
