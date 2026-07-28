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

export function DashboardNav({
  slug,
  onSignOut,
}: {
  slug: string;
  onSignOut?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-0.5">
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
      {onSignOut && (
        <button
          onClick={onSignOut}
          className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-ember px-3 py-2 text-sm font-medium text-[#160b04] shadow-[0_8px_30px_-8px_rgba(255,92,26,0.6)] transition-colors hover:bg-flare"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 7.5 10.5 4M14 7.5H6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sign out
        </button>
      )}
    </nav>
  );
}
