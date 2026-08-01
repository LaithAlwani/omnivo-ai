"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

// Feature flag — custom email domains stay dormant until this is explicitly
// enabled. It's a heavier, ops-y feature (Resend domain management + DNS +
// deliverability support) that only pays off once billing + real demand exist,
// so it's hidden by default. Flip it on by setting the build-time env
// NEXT_PUBLIC_ENABLE_EMAIL_DOMAINS=true (Vercel env → redeploy).
const EMAIL_DOMAINS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_EMAIL_DOMAINS === "true";

/** Custom email domain card — rendered only when the feature flag is on. The
 *  thin wrapper keeps the flag check out of the hook-calling body. */
export function EmailDomainCard() {
  if (!EMAIL_DOMAINS_ENABLED) return null;
  return <EmailDomainCardInner />;
}

// Custom sending domain, verified through Resend. Managers add their domain, add
// the DNS records we surface, then verify — after which booking/review/follow-up
// emails send from their address.
function EmailDomainCardInner() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const data = useQuery(api.emailDomains.get, { slug: b.slug });

  const addDomain = useAction(api.resend.addDomain);
  const verify = useAction(api.resend.verify);
  const remove = useAction(api.resend.remove);

  const [domain, setDomain] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState<null | "add" | "verify" | "remove">(null);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) return null;

  // Feature is Professional+.
  if (!data.available) {
    return (
      <section className="mt-8 rounded-xl border border-line bg-surface/40 p-6">
        <h2 className="text-lg text-bone">Custom email domain</h2>
        <p className="mt-1 text-sm text-muted">
          Send booking and follow-up emails from your own domain.{" "}
          <a
            href="https://omnivoai.ca/#pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ember underline hover:text-flare"
          >
            Upgrade to Professional
          </a>{" "}
          to enable it.
        </p>
      </section>
    );
  }

  async function act(kind: "add" | "verify" | "remove", fn: () => Promise<unknown>) {
    setError(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const current = data.domain;

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface/40 p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg text-bone">Custom email domain</h2>
        {current && (
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider ${
              current.status === "verified"
                ? "border-ember/40 bg-ember-soft text-ember"
                : current.status === "failed"
                  ? "border-ember-deep/50 text-ember-deep"
                  : "border-line-strong text-faint"
            }`}
          >
            {current.status}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Verify your domain so customer emails send from your address, not ours.
      </p>

      {!current ? (
        <fieldset disabled={!canEdit || busy !== null} className="mt-4 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={inputCls}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (e.g. mail.acme.com)"
            />
            <input
              className={inputCls}
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="From address (e.g. hello@mail.acme.com)"
            />
          </div>
          <input
            className={inputCls}
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="From name (e.g. Acme Salon)"
          />
          {canEdit && (
            <button
              onClick={() =>
                act("add", () =>
                  addDomain({ slug: b.slug, domain, fromName, fromEmail }),
                )
              }
              disabled={!domain || !fromEmail || !fromName}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
            >
              {busy === "add" ? "Adding…" : "Add domain"}
            </button>
          )}
        </fieldset>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-bone-dim">
            Sending as{" "}
            <span className="text-bone">
              {current.fromName} &lt;{current.fromEmail}&gt;
            </span>
          </p>

          {current.status !== "verified" && current.records.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-xs uppercase tracking-wider text-faint">
                Add these DNS records, then verify
              </p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="text-faint">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 font-mono font-normal">Type</th>
                      <th className="px-3 py-2 font-mono font-normal">Name</th>
                      <th className="px-3 py-2 font-mono font-normal">Value</th>
                    </tr>
                  </thead>
                  <tbody className="text-bone-dim">
                    {current.records.map((r, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 font-mono">{r.type}</td>
                        <td className="break-all px-3 py-2 font-mono">{r.name}</td>
                        <td className="break-all px-3 py-2 font-mono">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {current.status !== "verified" && (
                <button
                  onClick={() =>
                    act("verify", () => verify({ slug: b.slug }))
                  }
                  className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
                >
                  {busy === "verify" ? "Checking…" : "Verify"}
                </button>
              )}
              <button
                onClick={() => act("remove", () => remove({ slug: b.slug }))}
                className="h-10 rounded-full border border-line-strong px-4 text-sm text-muted transition-colors hover:text-ember-deep"
              >
                {busy === "remove" ? "Removing…" : "Remove"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
    </section>
  );
}
