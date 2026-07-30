"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Segment → label. Mirrors the sidebar nav (and the Business sub-tabs) so crumbs
// read the same. "business" is the grouping section; the five keys under it are
// its sub-tabs and appear as a second crumb.
const SECTION_LABELS: Record<string, string> = {
  business: "Business",
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

  // Build the trailing crumbs from the path segments after the business base,
  // each with a cumulative href. The last one is the current page (unlinked);
  // any before it (e.g. "Business" ahead of "Team") stay clickable.
  const sectionCrumbs = rest.map((seg, i) => ({
    label: SECTION_LABELS[seg] ?? seg,
    href:
      i === rest.length - 1 ? null : `${base}/${rest.slice(0, i + 1).join("/")}`,
  }));
  const hasSection = sectionCrumbs.length > 0;

  const crumbLink =
    "max-w-[18ch] shrink-0 truncate transition-colors hover:text-bone";
  const crumbCurrent = "max-w-[18ch] shrink-0 truncate text-bone";

  return (
    <nav
      aria-label="Breadcrumb"
      // Scroll horizontally rather than wrap/overflow when the trail is long on
      // a phone (e.g. Dashboard › Business › Team). Scrollbar hidden.
      className="mb-6 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-sm text-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Link href="/dashboard" className={crumbLink}>
        Dashboard
      </Link>
      <Chevron />
      {hasSection ? (
        <Link href={base} className={crumbLink}>
          {businessName}
        </Link>
      ) : (
        <span className={crumbCurrent} aria-current="page">
          {businessName}
        </span>
      )}
      {sectionCrumbs.map((crumb, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1.5">
          <Chevron />
          {crumb.href ? (
            <Link href={crumb.href} className={crumbLink}>
              {crumb.label}
            </Link>
          ) : (
            <span className={crumbCurrent} aria-current="page">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
