"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function BusinessSwitcher({ currentSlug }: { currentSlug: string }) {
  const businesses = useQuery(api.businesses.listMine);
  const [open, setOpen] = useState(false);
  const current = businesses?.find((b) => b.slug === currentSlug);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-bone transition-colors hover:border-line-strong"
      >
        <span className="max-w-[14ch] truncate">{current?.name ?? "…"}</span>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute left-0 top-full z-20 mt-1.5 w-60 rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] max-sm:fixed max-sm:inset-x-3 max-sm:top-17 max-sm:mt-0 max-sm:w-auto">
            {businesses?.map((b) => (
              <Link
                key={b._id}
                href={`/dashboard/${b.slug}`}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  b.slug === currentSlug
                    ? "bg-ember-soft text-bone"
                    : "text-bone-dim hover:bg-surface-2"
                }`}
              >
                <span className="max-w-[16ch] truncate">{b.name}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-wider text-faint">
                  {b.tier}
                </span>
              </Link>
            ))}
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="mt-1 block border-t border-line px-3 py-2 text-sm text-muted transition-colors hover:text-ember"
            >
              + New business…
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
