"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

function Check({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ${
        on ? "bg-ember text-[#160b04]" : "border border-line-strong text-faint"
      }`}
    >
      {on ? "✓" : ""}
    </span>
  );
}

export default function GoLivePage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role) && b.provisioning !== "installer";
  const readiness = useQuery(api.businesses.readiness, { slug: b.slug });
  const setDomains = useMutation(api.businesses.setDomains);
  const goLive = useMutation(api.businesses.goLive);
  const pause = useMutation(api.businesses.pause);

  const [domainsText, setDomainsText] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDomains = (b.domains ?? []).join("\n");
  const editValue = domainsText ?? currentDomains;

  async function run(key: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (readiness === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const live = readiness.status === "live";

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl text-bone">Go live</h1>
      <p className="mt-1 text-sm text-muted">
        Your assistant serves visitors once it&rsquo;s live. Finish the checklist,
        then flip it on.
      </p>

      {b.provisioning === "installer" && (
        <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
          This account is managed by your installer — they&rsquo;ll take it live for
          you.
        </p>
      )}

      {/* Status */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-surface/50 p-5">
        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            Status
          </div>
          <div
            className={`mt-1 font-display text-2xl ${
              live ? "text-emerald-400" : "text-ember"
            }`}
          >
            {readiness.status}
          </div>
        </div>
        {canEdit &&
          (live ? (
            <button
              onClick={() => run("pause", () => pause({ slug: b.slug }))}
              disabled={busy !== null}
              className="h-10 rounded-full border border-line-strong px-5 text-sm text-muted transition-colors hover:text-ember-deep disabled:opacity-50"
            >
              {busy === "pause" ? "…" : "Take offline"}
            </button>
          ) : (
            <button
              onClick={() => run("golive", () => goLive({ slug: b.slug }))}
              disabled={busy !== null || !readiness.ready}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-50"
            >
              {busy === "golive" ? "…" : "Go live"}
            </button>
          ))}
      </div>

      {/* Checklist */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Checklist
        </div>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <Check on={readiness.knowledgePresent} />
            <span className="text-bone">Business knowledge added</span>
            <Link
              href={`/dashboard/${b.slug}/business/knowledge`}
              className="ml-auto text-xs text-ember hover:text-flare"
            >
              Edit →
            </Link>
          </li>
          <li className="flex items-center gap-3">
            <Check on={readiness.domainsSet} />
            <span className="text-bone">Website domain allow-listed</span>
          </li>
        </ul>
      </div>

      {/* Optional: connect booking / CRM */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Connect your tools · optional
        </div>
        <p className="mt-2 text-sm text-muted">
          The assistant can go live answering questions and capturing leads on its
          own. Connect your booking system or CRM so it can also book and sync
          leads — or, if you don&rsquo;t have one yet, LA Digital can set booking
          and CRM up for you.
        </p>
        <Link
          href={`/dashboard/${b.slug}/integrations`}
          className="mt-3 inline-block text-xs text-ember hover:text-flare"
        >
          Manage connections →
        </Link>
      </div>

      {/* Domains editor */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Allowed website domains
        </div>
        <p className="mt-1 text-sm text-muted">
          The widget only runs on these sites. One host per line (e.g.
          <span className="text-bone-dim"> example.com</span>).
        </p>
        <textarea
          disabled={!canEdit || busy !== null}
          value={editValue}
          onChange={(e) => setDomainsText(e.target.value)}
          rows={3}
          className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          placeholder="example.com&#10;shop.example.com"
        />
        {canEdit && (
          <button
            onClick={() =>
              run("domains", async () => {
                const domains = editValue
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const saved = await setDomains({ slug: b.slug, domains });
                setDomainsText(saved.join("\n"));
              })
            }
            disabled={busy !== null}
            className="mt-3 h-9 rounded-full bg-ember px-4 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-50"
          >
            {busy === "domains" ? "Saving…" : "Save domains"}
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-ember-deep">{error}</p>}
    </div>
  );
}
