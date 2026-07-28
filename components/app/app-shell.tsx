"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/layout/logo";

export type PlatformRole = "support" | "superadmin";

/** Human label for a platform operator role. */
export function platformRoleLabel(role: PlatformRole): string {
  return role === "superadmin" ? "Platform Super Admin" : "Platform Support";
}

/** A section link for the sidebar `nav` slot, with the active-rail marker. */
export function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`relative rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-surface text-bone"
          : "text-bone-dim hover:bg-surface/60 hover:text-bone"
      }`}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-ember" />
      )}
      {children}
    </Link>
  );
}

// The shared app-plane shell: a fixed-height header + a collapsible sidebar
// (desktop rail / mobile drawer). The sidebar's `nav` is page-specific; the
// operator role tag, cross-plane link, and sign-out are common and rendered
// here. Used by the dashboard, the business picker, and the platform portal.
export function AppShell({
  nav,
  headerExtra,
  children,
}: {
  nav?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const platform = useQuery(api.platform.me);
  const { signOut } = useAuthActions();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onPlatform = pathname.startsWith("/platform");

  // Close the drawer on navigation + lock scroll while it's open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const sidebar = (
    <div className="flex min-h-0 flex-1 flex-col">
      {platform && (
        <span className="mb-3 inline-flex w-fit rounded-full border border-ember/40 bg-ember-soft px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-ember">
          {platformRoleLabel(platform.role)}
        </span>
      )}

      {/* Section links scroll if they outgrow the rail; the actions stay pinned. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {nav}
      </div>

      <div className="mt-3 flex shrink-0 flex-col gap-1 border-t border-line pt-3">
        {/* Cross-plane link: from the app it points into the platform portal;
            once inside the portal it flips to point back to the dashboard. */}
        {platform &&
          (onPlatform ? (
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-2 text-sm text-bone-dim transition-colors hover:bg-surface/60 hover:text-bone"
            >
              ← Dashboard
            </Link>
          ) : (
            <Link
              href="/platform"
              className="rounded-lg px-3 py-2 text-sm text-bone-dim transition-colors hover:bg-surface/60 hover:text-bone"
            >
              Platform ↗
            </Link>
          ))}
        <button
          onClick={() => void signOut()}
          className="flex items-center justify-center gap-2 rounded-lg bg-ember px-3 py-2 text-sm font-medium text-[#160b04] shadow-[0_8px_30px_-8px_rgba(255,92,26,0.6)] transition-colors hover:bg-flare"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 7.5 10.5 4M14 7.5H6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-bone md:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>
          <Logo />
        </div>
        {headerExtra}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-line p-4 md:flex md:flex-col">
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
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
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-bone"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {sidebar}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
