"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import { AppShell, SidebarLink } from "@/components/app/app-shell";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function DashboardHome() {
  const businesses = useQuery(api.businesses.listMine);
  const createBusiness = useAction(api.businesses.create);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await createBusiness({ name, slug: slug || slugify(name) });
      setNewKey(res.embedKey);
      setName("");
      setSlug("");
      setSlugTouched(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
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
        <h1 className="font-display text-4xl text-bone">Your businesses</h1>
        <p className="mt-2 text-muted">
          Each business is an isolated tenant — its data is visible only to its
          members.
        </p>

        {/* Embed key shown once, right after creation */}
        {newKey && (
          <div className="mt-8 rounded-xl border border-ember/40 bg-ember-soft p-5">
            <p className="font-mono text-xs uppercase tracking-wider text-ember">
              Embed key — copy it now, it won&rsquo;t be shown again
            </p>
            <code className="mt-2 block break-all font-mono text-sm text-bone">
              {newKey}
            </code>
          </div>
        )}

        {/* Business list */}
        <div className="mt-8 space-y-3">
          {businesses === undefined && (
            <p className="text-sm text-faint">Loading…</p>
          )}
          {businesses?.length === 0 && (
            <p className="text-sm text-faint">
              No businesses yet — create your first one below.
            </p>
          )}
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

        {/* Create */}
        <form
          onSubmit={onCreate}
          className="mt-10 rounded-xl border border-line bg-surface/40 p-6"
        >
          <h2 className="font-display text-xl text-bone">Create a business</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
              placeholder="Business name"
              className="h-11 rounded-lg border border-line-strong bg-ink px-4 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
            />
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              required
              placeholder="url-slug"
              className="h-11 rounded-lg border border-line-strong bg-ink px-4 font-mono text-sm text-bone placeholder:text-faint focus-visible:border-ember"
            />
          </div>
          {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
          <button
            type="submit"
            disabled={pending || !name}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create business"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
