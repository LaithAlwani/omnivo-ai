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
    </div>
  );
}
