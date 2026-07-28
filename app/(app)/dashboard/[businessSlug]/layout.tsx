"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/app-shell";
import { BusinessSwitcher } from "@/components/dashboard/business-switcher";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { BusinessProvider } from "@/components/dashboard/business-context";

export default function BusinessDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const businesses = useQuery(api.businesses.listMine);
  const router = useRouter();

  const current = businesses?.find((b) => b.slug === businessSlug);

  useEffect(() => {
    if (businesses !== undefined && !current) router.replace("/dashboard");
  }, [businesses, current, router]);

  if (businesses === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-faint">
        Loading…
      </div>
    );
  }
  if (!current) return null;

  return (
    <BusinessProvider value={current}>
      <AppShell
        nav={<DashboardNav slug={businessSlug} />}
        headerExtra={
          <>
            <span className="hidden text-faint md:inline">/</span>
            {/* Below md the "/" is hidden and the switcher is pushed to the far
                right; at md+ it sits next to the logo. */}
            <div className="ml-auto md:ml-0">
              <BusinessSwitcher currentSlug={businessSlug} />
            </div>
          </>
        }
      >
        <Breadcrumbs businessName={current.name} slug={businessSlug} />
        {children}
      </AppShell>
    </BusinessProvider>
  );
}
