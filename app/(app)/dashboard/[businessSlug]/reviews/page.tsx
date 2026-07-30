"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";
import { ModuleGate } from "@/components/dashboard/module-gate";

export default function ReviewsPage() {
  return (
    <ModuleGate module="reviewManagement">
      <ReviewsInner />
    </ModuleGate>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-surface/40 p-5">
      <div className="font-mono text-xs uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl text-bone">{value}</div>
    </div>
  );
}

function ReviewsInner() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const data = useQuery(api.reviews.metrics, { slug: b.slug });
  const setLink = useMutation(api.reviews.setReviewLink);

  const [link, setLink_] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const linkValue = link ?? data.reviewLink ?? "";

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await setLink({ slug: b.slug, reviewLink: linkValue });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">Reviews</h1>
      <p className="mt-1 text-sm text-muted">
        After each visit the assistant asks customers how it went. Happy ones are
        sent to your public review page; unhappy ones reach you privately.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Requests sent" value={data.requestsSent} />
        <Stat label="Responses" value={data.responses} />
        <Stat label="Positive" value={data.positive} />
        <Stat
          label="Avg rating"
          value={data.avgRating != null ? data.avgRating.toFixed(1) : "—"}
        />
      </div>

      {/* Public review link */}
      <div className="mt-6 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Public review link
        </div>
        <p className="mt-1 text-sm text-muted">
          Where happy customers are sent (e.g. your Google review link).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={linkValue}
            disabled={!canEdit}
            onChange={(e) => {
              setLink_(e.target.value);
              setSaved(false);
            }}
            placeholder="https://g.page/r/…/review"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          />
          {canEdit && (
            <button
              onClick={save}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
            >
              Save
            </button>
          )}
        </div>
        {saved && <p className="mt-2 text-sm text-flare">Saved ✓</p>}
        {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      </div>

      {/* Recent private feedback */}
      <div className="mt-6">
        <h2 className="text-lg text-bone">Private feedback</h2>
        <p className="mt-1 text-sm text-muted">
          What customers who weren&rsquo;t fully happy told us.
        </p>
        <div className="mt-3 divide-y divide-line rounded-xl border border-line">
          {data.recentNegative.length === 0 ? (
            <p className="px-4 py-4 text-sm text-faint">
              No private feedback yet.
            </p>
          ) : (
            data.recentNegative.map((r) => (
              <div key={r._id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-bone">{r.customerName}</span>
                  {r.rating != null && (
                    <span className="font-mono text-xs text-faint">
                      {r.rating}★
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-bone-dim">{r.feedback}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
