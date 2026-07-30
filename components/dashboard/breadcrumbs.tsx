"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Section segment → label. Mirrors the sidebar nav so crumbs read the same.
const SECTION_LABELS: Record<string, string> = {
  branding: "Branding",
  locations: "Locations",
  team: "Team",
  services: "Services",
  schedule: "Schedule",
  bookings: "Bookings",
  leads: "Leads",
  reviews: "Reviews",
  sales: "Sales",
  knowledge: "Knowledge",
  assistant: "AI Employee",
  modules: "Modules",
  integrations: "Integrations",
  usage: "Plan & usage",
};

function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-faint"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Breadcrumbs({
  businessName,
  slug,
}: {
  businessName: string;
  slug: string;
}) {
  const pathname = usePathname();
  const base = `/dashboard/${slug}`;
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length).split("/").filter(Boolean)
    : [];
  const section = rest[0];
  const sectionLabel = section ? (SECTION_LABELS[section] ?? section) : null;

  const crumbLink =
    "max-w-[18ch] truncate transition-colors hover:text-bone";
  const crumbCurrent = "max-w-[18ch] truncate text-bone";

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 flex items-center gap-1.5 text-sm text-muted"
    >
      <Link href="/dashboard" className={crumbLink}>
        Dashboard
      </Link>
      <Chevron />
      {sectionLabel ? (
        <Link href={base} className={crumbLink}>
          {businessName}
        </Link>
      ) : (
        <span className={crumbCurrent} aria-current="page">
          {businessName}
        </span>
      )}
      {sectionLabel && (
        <>
          <Chevron />
          <span className={crumbCurrent} aria-current="page">
            {sectionLabel}
          </span>
        </>
      )}
    </nav>
  );
}
