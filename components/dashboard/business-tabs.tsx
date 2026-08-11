"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBusiness } from "@/components/dashboard/business-context";

// The sub-tabs for the Business section. Segments match the moved route folders
// under app/(app)/dashboard/[businessSlug]/business/.
const TABS = [
  { label: "Branding", segment: "branding" },
  { label: "Locations", segment: "locations" },
  { label: "Team", segment: "team" },
  { label: "Services", segment: "services" },
  { label: "Schedule", segment: "schedule" },
  { label: "Knowledge", segment: "knowledge" },
  { label: "Playground", segment: "playground" },
] as const;

/** Horizontal sub-tab bar for the Business section, rendered by the section
 *  layout above each page. On a phone the five tabs don't fit, so the row
 *  scrolls horizontally (scrollbar hidden) and the active tab is scrolled into
 *  view — it never widens the page. Active state mirrors the sidebar's
 *  `startsWith` matching. */
export function BusinessTabs() {
  const b = useBusiness();
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the current tab visible when the bar is scrolled on narrow screens.
  // `block: "nearest"` keeps it from nudging the page vertically.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Business sections"
      className="mb-8 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const href = `/dashboard/${b.slug}/business/${tab.segment}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={tab.segment}
            ref={active ? activeRef : undefined}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative shrink-0 scroll-mx-6 whitespace-nowrap px-3.5 py-3 text-sm transition-colors ${
              active ? "text-bone" : "text-bone-dim hover:text-bone"
            }`}
          >
            {tab.label}
            {/* Active underline, sitting on top of the nav's bottom hairline. */}
            <span
              className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${
                active ? "bg-ember" : "bg-transparent"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
