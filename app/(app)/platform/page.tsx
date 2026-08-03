"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const th =
  "px-4 py-3 text-left font-mono text-[0.65rem] uppercase tracking-wider text-faint";

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Tier({ tier }: { tier: string }) {
  return (
    <span className="font-mono text-[0.7rem] uppercase tracking-wider text-bone-dim">
      {tier}
    </span>
  );
}

function Status({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "text-emerald-400"
      : status === "suspended"
        ? "text-red-400"
        : "text-flare";
  return (
    <span className={`font-mono text-[0.7rem] uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  );
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const tok = (t: number) =>
  t >= 1_000_000 ? `${(t / 1_000_000).toFixed(2)}M` : `${Math.round(t / 1000)}K`;

function Margin({ cents }: { cents: number }) {
  const tone =
    cents > 0 ? "text-emerald-400" : cents < 0 ? "text-red-400" : "text-faint";
  return <span className={`font-mono ${tone}`}>{usd(cents)}</span>;
}

function CostMargin() {
  const data = useQuery(api.platform.costMargin, {});
  if (data === undefined) {
    return <div className="p-6 text-sm text-faint">Loading…</div>;
  }
  const active = data.rows.filter((r) => r.ourCostCents > 0 || r.conversations > 0);
  if (active.length === 0) {
    return <div className="p-6 text-sm text-faint">No AI usage this period.</div>;
  }
  return (
    <table className="w-full min-w-[40rem] text-sm">
      <thead>
        <tr className="border-b border-line">
          <th className={th}>Business</th>
          <th className={`${th} text-right`}>Convos</th>
          <th className={`${th} text-right`}>Billable tokens</th>
          <th className={`${th} text-right`}>Revenue</th>
          <th className={`${th} text-right`}>Our cost</th>
          <th className={`${th} text-right`}>Margin</th>
        </tr>
      </thead>
      <tbody>
        {active.map((r) => (
          <tr
            key={r._id}
            className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface/40"
          >
            <td className="px-4 py-3">
              <Link
                href={`/platform/${r._id}`}
                className="font-medium text-bone transition-colors hover:text-ember"
              >
                {r.name}
              </Link>
              <div className="text-xs text-faint">/{r.slug}</div>
            </td>
            <td className="px-4 py-3 text-right text-bone-dim">
              {r.conversations.toLocaleString()}
            </td>
            <td className="px-4 py-3 text-right text-bone-dim">
              {tok(r.billableTokens)}
              {r.overageCents > 0 && (
                <span className="ml-1 text-[0.65rem] uppercase text-flare">
                  over
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-right text-bone-dim">
              {usd(r.revenueCents)}
            </td>
            <td className="px-4 py-3 text-right text-bone-dim">
              {usd(r.ourCostCents)}
            </td>
            <td className="px-4 py-3 text-right">
              <Margin cents={r.marginCents} />
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-line font-medium">
          <td className="px-4 py-3 text-bone">Total</td>
          <td className="px-4 py-3" />
          <td className="px-4 py-3 text-right text-bone">
            {tok(data.totals.billableTokens)}
          </td>
          <td className="px-4 py-3 text-right text-bone">
            {usd(data.totals.revenueCents)}
          </td>
          <td className="px-4 py-3 text-right text-bone">
            {usd(data.totals.ourCostCents)}
          </td>
          <td className="px-4 py-3 text-right">
            <Margin cents={data.totals.marginCents} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default function PlatformHome() {
  const businesses = useQuery(api.platform.listBusinesses);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl text-bone">Businesses</h1>
      <p className="mt-1 text-sm text-muted">
        {businesses === undefined ? "…" : businesses.length} tenant
        {businesses?.length === 1 ? "" : "s"} on the platform.
      </p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-line">
        {businesses === undefined ? (
          <div className="p-6 text-sm text-faint">Loading…</div>
        ) : businesses.length === 0 ? (
          <div className="p-6 text-sm text-faint">No businesses yet.</div>
        ) : (
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Business</th>
                <th className={th}>Tier</th>
                <th className={th}>Status</th>
                <th className={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr
                  key={b._id}
                  className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/${b._id}`}
                      className="font-medium text-bone transition-colors hover:text-ember"
                    >
                      {b.name}
                    </Link>
                    <div className="text-xs text-faint">/{b.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Tier tier={b.tier} />
                  </td>
                  <td className="px-4 py-3">
                    <Status status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-bone-dim">
                    {fmtDate(b.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mt-12 font-display text-2xl text-bone">
        AI cost &amp; margin
      </h2>
      <p className="mt-1 text-sm text-muted">
        This month&rsquo;s AI usage per tenant — credit revenue vs. our estimated
        model spend. Negative margin flags an unprofitable client.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <CostMargin />
      </div>
    </div>
  );
}
