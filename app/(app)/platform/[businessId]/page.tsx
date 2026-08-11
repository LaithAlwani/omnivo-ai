"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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
function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

export default function PlatformBusinessDetail() {
  const { businessId } = useParams<{ businessId: string }>();
  const data = useQuery(api.platform.businessDetail, {
    businessId: businessId as Id<"businesses">,
  });

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const { business, staff, upcoming, leads, members, connections } = data;

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
      </dl>

      <Section title="Upcoming bookings" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <Empty label="No upcoming bookings." />
        ) : (
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>When</th>
                <th className={th}>Customer</th>
                <th className={th}>With</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((b) => (
                <tr key={b._id} className="border-b border-line/60 last:border-0">
                  <td className={td}>{fmtDateTime(b.start)}</td>
                  <td className="px-3 py-2 text-bone">
                    {b.customerName}
                    <div className="text-xs text-faint">{b.customerEmail}</div>
                  </td>
                  <td className={td}>{b.staffName}</td>
                  <td className={td}>{b.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

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
        <Section title="Staff" count={staff.length}>
          {staff.length === 0 ? (
            <Empty label="No staff." />
          ) : (
            <ul className="divide-y divide-line/60">
              {staff.map((s) => (
                <li
                  key={s._id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="text-bone">
                    {s.name}
                    {s.title ? (
                      <span className="text-faint"> · {s.title}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">
                    {s.active ? (s.bookable ? "bookable" : "active") : "inactive"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

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
