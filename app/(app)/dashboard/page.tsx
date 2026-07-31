"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell, SidebarLink } from "@/components/app/app-shell";
import { useConfirm } from "@/components/ui/confirm";

export default function DashboardHome() {
  const businesses = useQuery(api.businesses.listMine);
  const account = useQuery(api.accounts.myAccount);
  const router = useRouter();
  const { confirm, dialog } = useConfirm();

  const loading = businesses === undefined;
  const empty = businesses?.length === 0;

  // Project allowance lives on the account (pooled across owned projects). A
  // brand-new user has no account yet → first project is always allowed.
  const max = account?.projects.max ?? null;
  const used = account?.projects.used ?? 0;
  const atLimit = max !== null && used >= max;
  const ownedSlug =
    businesses?.find((b) => b.role === "owner")?.slug ?? businesses?.[0]?.slug;

  // Create → wizard, unless the account is at its project cap, in which case we
  // prompt an upgrade instead.
  async function handleCreate() {
    if (atLimit) {
      const ok = await confirm({
        title: "Upgrade to add a project",
        message: `Your ${account?.plan ?? "starter"} plan includes ${max} project${max === 1 ? "" : "s"}. Upgrade to Professional to run more businesses from one account.`,
        confirmLabel: "View plans",
      });
      if (ok) router.push(ownedSlug ? `/dashboard/${ownedSlug}/usage` : "/dashboard");
      return;
    }
    router.push("/create");
  }

  return (
    <AppShell
      nav={
        <SidebarLink href="/dashboard" active>
          Businesses
        </SidebarLink>
      }
    >
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl text-bone">Your businesses</h1>
            <p className="mt-2 text-muted">
              Each business is an isolated tenant — its data is visible only to
              its members.
            </p>
          </div>
          {/* Desktop: a regular button, top-right. */}
          {!loading && !empty && (
            <button
              onClick={handleCreate}
              className="hidden h-11 flex-none items-center gap-2 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare sm:inline-flex"
            >
              <PlusIcon />
              New business
            </button>
          )}
        </div>

        {loading && <p className="mt-8 text-sm text-faint">Loading…</p>}

        {/* Empty state — the first-run call to action. */}
        {empty && (
          <div className="mt-10 rounded-2xl border border-dashed border-line-strong bg-surface/30 px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-ember/40 bg-ember-soft text-ember">
              <PlusIcon />
            </span>
            <h2 className="mt-5 font-display text-2xl text-bone">
              Add your first project
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              Set up a business and its AI assistant in a couple of minutes — a
              short wizard gets it answering, booking, and capturing leads.
            </p>
            <button
              onClick={handleCreate}
              className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
            >
              <PlusIcon />
              Create a business
            </button>
          </div>
        )}

        {/* Business list */}
        {!empty && (
          <div className="mt-8 space-y-3">
            {businesses?.map((b) => (
              <Link
                key={b._id}
                href={`/dashboard/${b.slug}`}
                className="flex items-center justify-between rounded-xl border border-line bg-surface/60 px-5 py-4 transition-colors hover:border-ember/40 hover:bg-surface"
              >
                <div>
                  <p className="text-bone">{b.name}</p>
                  <p className="font-mono text-xs text-faint">
                    /{b.slug} · {b.tier} · you are {b.role}
                  </p>
                </div>
                <span className="rounded-full border border-line-strong px-3 py-1 font-mono text-xs text-muted">
                  {b.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: a fixed floating action button, bottom-right. */}
      {!loading && (
        <button
          onClick={handleCreate}
          aria-label="Create a business"
          className="fixed bottom-6 right-6 z-30 grid h-14 w-14 place-items-center rounded-full bg-ember text-[#160b04] shadow-[0_10px_30px_-6px_rgba(255,92,26,0.6)] transition-colors hover:bg-flare sm:hidden"
        >
          <PlusIcon className="h-6 w-6" />
        </button>
      )}

      {dialog}
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
