"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";

const th =
  "px-3 py-2 text-left font-mono text-[0.6rem] uppercase tracking-wider text-faint";
const td = "px-3 py-2 text-bone-dim";

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="font-display text-xl text-bone">{title}</h2>
        <span className="font-mono text-xs text-faint">{count}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="p-4 text-sm text-faint">{label}</div>;
}

const btn =
  "h-9 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50";

function InstallActions({
  slug,
  businessId,
  status,
  provisioning,
  installFeeCents,
  monthlyOverrideCents,
}: {
  slug: string;
  businessId: Id<"businesses">;
  status: string;
  provisioning: string;
  installFeeCents: number | null;
  monthlyOverrideCents: number | null;
}) {
  const goLive = useMutation(api.businesses.goLive);
  const pause = useMutation(api.businesses.pause);
  const setProvisioning = useMutation(api.platform.setProvisioning);
  const setInstallTerms = useMutation(api.platform.setInstallTerms);
  const invite = useAction(api.invitations.invite);
  const [inviteEmail, setInviteEmail] = useState("");
  const [installFee, setInstallFee] = useState(
    installFeeCents != null ? String(installFeeCents / 100) : "",
  );
  const [monthly, setMonthly] = useState(
    monthlyOverrideCents != null ? String(monthlyOverrideCents / 100) : "",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    setBusy(key);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface/40 p-5">
      <div className="font-mono text-xs uppercase tracking-wider text-faint">
        Install actions
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === "live" ? (
          <button
            onClick={() => run("pause", () => pause({ slug }))}
            disabled={busy !== null}
            className={`${btn} border border-line-strong text-muted hover:text-ember-deep`}
          >
            {busy === "pause" ? "…" : "Take offline"}
          </button>
        ) : (
          <button
            onClick={() => run("golive", () => goLive({ slug }), "Now live.")}
            disabled={busy !== null}
            className={`${btn} bg-ember text-[#160b04] hover:bg-flare`}
          >
            {busy === "golive" ? "…" : "Go live"}
          </button>
        )}
        <button
          onClick={() =>
            run(
              "handoff",
              () =>
                setProvisioning({
                  businessId,
                  mode: provisioning === "installer" ? "self" : "installer",
                }),
              provisioning === "installer"
                ? "Released to the client."
                : "Now installer-managed.",
            )
          }
          disabled={busy !== null}
          className={`${btn} border border-line-strong text-bone hover:border-ember`}
        >
          {provisioning === "installer" ? "Release to client" : "Take over install"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="client@email.com"
          type="email"
          className="h-9 w-64 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
        />
        <button
          onClick={() =>
            run(
              "invite",
              () => invite({ businessId, email: inviteEmail, role: "owner" }),
              "Owner invite sent.",
            )
          }
          disabled={busy !== null || !inviteEmail.includes("@")}
          className={`${btn} border border-line-strong text-bone hover:border-ember`}
        >
          {busy === "invite" ? "…" : "Invite owner"}
        </button>
      </div>

      {provisioning === "installer" && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">
            Install terms (modeled, not charged)
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <label className="text-muted">
              Install fee $
              <input
                value={installFee}
                onChange={(e) => setInstallFee(e.target.value)}
                type="number"
                className="ml-1 h-9 w-24 rounded-lg border border-line-strong bg-surface px-2 text-bone focus-visible:border-ember"
              />
            </label>
            <label className="text-muted">
              Monthly $
              <input
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                type="number"
                placeholder="tier"
                className="ml-1 h-9 w-24 rounded-lg border border-line-strong bg-surface px-2 text-bone placeholder:text-faint focus-visible:border-ember"
              />
            </label>
            <button
              onClick={() =>
                run(
                  "terms",
                  () =>
                    setInstallTerms({
                      businessId,
                      installFeeCents: installFee
                        ? Math.round(Number(installFee) * 100)
                        : undefined,
                      monthlyOverrideCents: monthly
                        ? Math.round(Number(monthly) * 100)
                        : undefined,
                    }),
                  "Terms saved.",
                )
              }
              disabled={busy !== null}
              className={`${btn} bg-ember text-[#160b04] hover:bg-flare`}
            >
              {busy === "terms" ? "…" : "Save terms"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-bone-dim">{msg}</p>}
    </section>
  );
}

export default function PlatformBusinessDetail() {
  const { businessId } = useParams<{ businessId: string }>();
  const data = useQuery(api.platform.businessDetail, {
    businessId: businessId as Id<"businesses">,
  });

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const { business, leads, members, connections } = data;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/platform"
        className="text-sm text-muted transition-colors hover:text-bone"
      >
        ← All businesses
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-3xl text-bone">{business.name}</h1>
        <span className="font-mono text-[0.7rem] uppercase tracking-wider text-bone-dim">
          {business.tier}
        </span>
        <span className="font-mono text-[0.7rem] uppercase tracking-wider text-flare">
          {business.status}
        </span>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
        <div>
          <dt className="inline text-faint">Slug:</dt> /{business.slug}
        </div>
        <div>
          <dt className="inline text-faint">Timezone:</dt>{" "}
          {business.timezone ?? "—"}
        </div>
        <div>
          <dt className="inline text-faint">Created:</dt>{" "}
          {fmtDate(business.createdAt)}
        </div>
        <div>
          <dt className="inline text-faint">Domains:</dt>{" "}
          {business.domains.length ? business.domains.join(", ") : "—"}
        </div>
        <div>
          <dt className="inline text-faint">Provisioning:</dt>{" "}
          {business.provisioning}
        </div>
      </dl>

      <InstallActions
        slug={business.slug}
        businessId={business._id}
        status={business.status}
        provisioning={business.provisioning}
        installFeeCents={business.installFeeCents}
        monthlyOverrideCents={business.monthlyOverrideCents}
      />

      <Section title="Recent leads" count={leads.length}>
        {leads.length === 0 ? (
          <Empty label="No leads yet." />
        ) : (
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Name</th>
                <th className={th}>Contact</th>
                <th className={th}>Status</th>
                <th className={th}>Added</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l._id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 text-bone">{l.name}</td>
                  <td className={td}>{l.email ?? l.phone ?? "—"}</td>
                  <td className={td}>{l.status}</td>
                  <td className={td}>{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Team" count={members.length}>
          {members.length === 0 ? (
            <Empty label="No members." />
          ) : (
            <ul className="divide-y divide-line/60">
              {members.map((m) => (
                <li
                  key={m._id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="text-bone-dim">{m.email}</span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Connections" count={connections.length}>
          {connections.length === 0 ? (
            <Empty label="No connections." />
          ) : (
            <ul className="divide-y divide-line/60">
              {connections.map((c) => (
                <li
                  key={c._id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="text-bone-dim">
                    {c.kind} · {c.provider}
                    {!c.active && (
                      <span className="ml-2 text-xs text-faint">(inactive)</span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[0.6rem] uppercase tracking-wider ${
                      c.health === "degraded" ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {c.health}
                    {c.health === "degraded" && c.failureStreak > 0
                      ? ` ·${c.failureStreak}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
