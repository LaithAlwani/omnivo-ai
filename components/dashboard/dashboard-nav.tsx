"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarLink } from "@/components/app/app-shell";
import { useBusiness } from "@/components/dashboard/business-context";

// Display label for the account plan the current project is on.
const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

// Sidebar items grow with each Phase 1 slice (Team, Knowledge, Chat).
function navItems(slug: string) {
  return [
    { label: "Overview", href: `/dashboard/${slug}`, exact: true },
    { label: "Go live", href: `/dashboard/${slug}/go-live`, exact: false },
    // Branding, Locations, Team, Services & Knowledge live behind this one entry
    // now — see app/(app)/dashboard/[businessSlug]/business/ and its sub-tabs.
    { label: "Business", href: `/dashboard/${slug}/business`, exact: false },
    { label: "Bookings", href: `/dashboard/${slug}/bookings`, exact: false },
    { label: "Leads", href: `/dashboard/${slug}/leads`, exact: false },
    { label: "Integrations", href: `/dashboard/${slug}/integrations`, exact: false },
    { label: "Usage", href: `/dashboard/${slug}/usage`, exact: false },
  ];
}

/** The dashboard section links — rendered inside AppShell's sidebar `nav` slot. */
export function DashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const b = useBusiness();
  const planLabel = PLAN_LABEL[b.tier] ?? b.tier;

  return (
    <>
      {/* Plan tag — the account tier this project is on. Links to Plan & usage. */}
      <Link
        href={`/dashboard/${slug}/usage`}
        className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-ember/40 bg-ember-soft px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-ember transition-colors hover:border-ember/70"
        title="View plan & usage"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ember" />
        {planLabel} plan
      </Link>

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
