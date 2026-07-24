"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function DashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {navItems(slug).map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-surface text-bone"
                : "text-bone-dim hover:bg-surface/60 hover:text-bone"
            }`}
          >
            {active && (
              <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-ember" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
