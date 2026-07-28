"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/layout/logo";
import { BusinessSwitcher } from "@/components/dashboard/business-switcher";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { BusinessProvider } from "@/components/dashboard/business-context";

export default function BusinessDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const businesses = useQuery(api.businesses.listMine);
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const [navOpen, setNavOpen] = useState(false);

  const current = businesses?.find((b) => b.slug === businessSlug);

  useEffect(() => {
    if (businesses !== undefined && !current) router.replace("/dashboard");
  }, [businesses, current, router]);

  // Close the mobile drawer on navigation + lock scroll while it's open.
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);

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
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-bone md:hidden"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
              </svg>
            </button>
            <Logo />
            <span className="hidden text-faint sm:inline">/</span>
            <BusinessSwitcher currentSlug={businessSlug} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-56 shrink-0 border-r border-line p-4 md:flex md:flex-col">
            <DashboardNav slug={businessSlug} onSignOut={() => void signOut()} />
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile nav drawer */}
      <AnimatePresence>
        {navOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-ink p-4 shadow-[0_0_60px_-10px_rgba(0,0,0,0.9)]"
            >
              <div className="mb-5 flex items-center justify-between">
                <Logo />
                <button
                  onClick={() => setNavOpen(false)}
                  aria-label="Close menu"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-bone"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <DashboardNav slug={businessSlug} onSignOut={() => void signOut()} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </BusinessProvider>
  );
}
