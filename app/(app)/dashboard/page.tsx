"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell, SidebarLink } from "@/components/app/app-shell";

export default function DashboardHome() {
  const businesses = useQuery(api.businesses.listMine);
  const router = useRouter();

  const loading = businesses === undefined;
  const empty = businesses?.length === 0;
  const ownedSlug =
    businesses?.find((b) => b.role === "owner")?.slug ?? businesses?.[0]?.slug;

  // One business per account: if the user has one, go straight to it; the
  // account "home" is just a thin router.
  useEffect(() => {
    if (ownedSlug) router.replace(`/dashboard/${ownedSlug}`);
  }, [ownedSlug, router]);

  return (
    <AppShell
      nav={
        <SidebarLink href="/dashboard" active>
          Business
        </SidebarLink>
      }
    >
      <div className="mx-auto max-w-3xl">
        {(loading || (!empty && ownedSlug)) && (
          <p className="mt-8 text-sm text-faint">Loading…</p>
        )}

        {/* Empty state — the first-run call to action. */}
        {empty && (
          <div className="mt-10 rounded-2xl border border-dashed border-line-strong bg-surface/30 px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-ember/40 bg-ember-soft text-ember">
              <PlusIcon />
            </span>
            <h2 className="mt-5 font-display text-2xl text-bone">
              Set up your business
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              Get your AI employee live in a couple of minutes — a short wizard
              gets it answering, booking, and capturing leads. Grow later by
              adding locations, not separate businesses.
            </p>
            <button
              onClick={() => router.push("/create")}
              className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
            >
              <PlusIcon />
              Create your business
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PlusIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}
