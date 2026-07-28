"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBusiness } from "@/components/dashboard/business-context";
import { WidgetKeyCard } from "@/components/dashboard/widget-key-card";
import { UsageMeter } from "@/components/dashboard/usage-meter";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line-strong px-3 py-1 font-mono text-xs uppercase tracking-wider text-bone-dim">
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface/50 p-5">
      <div className="font-display text-3xl text-bone">{value}</div>
      <div className="mt-1 font-mono text-xs uppercase tracking-wider text-faint">
        {label}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const PIPELINE = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

export default function OverviewPage() {
  const b = useBusiness();
  const stats = useQuery(api.analytics.overview, { slug: b.slug });

  const loading = stats === undefined;
  const num = (x: number | undefined) => (loading ? "—" : String(x ?? 0));

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl text-bone">{b.name}</h1>
      <p className="mt-1 font-mono text-xs text-faint">/{b.slug}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Badge>{b.tier}</Badge>
        <Badge>{b.status}</Badge>
        <Badge>you: {b.role}</Badge>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Conversations"
          value={num(stats?.conversationsThisMonth)}
          hint={
            loading
              ? undefined
              : stats?.conversationCap
                ? `of ${stats.conversationCap.toLocaleString()} this month`
                : `this month · ${stats?.conversationsThisWeek ?? 0} this week`
          }
        />
        <Stat
          label="Upcoming bookings"
          value={num(stats?.upcomingBookings)}
          hint={
            loading
              ? undefined
              : `${stats?.bookingsThisWeek ?? 0} in the next 7 days`
          }
        />
        <Stat
          label="Open leads"
          value={num(stats?.openLeads)}
          hint={loading ? undefined : `${stats?.totalLeads ?? 0} total`}
        />
        <Stat label="Won" value={num(stats?.wonLeads)} hint="Converted leads" />
      </div>

      {/* Usage this month */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-5">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            Usage this month
          </div>
          <Link
            href={`/dashboard/${b.slug}/usage`}
            className="text-xs text-ember transition-colors hover:text-flare"
          >
            Plan &amp; usage →
          </Link>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-faint">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <UsageMeter
              label="Conversations"
              used={stats.conversationsThisMonth}
              cap={stats.conversationCap}
            />
            <UsageMeter
              label="SMS"
              used={stats.smsThisMonth}
              cap={stats.smsCap}
            />
          </div>
        )}
      </div>

      {/* Lead pipeline breakdown */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-5">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Lead pipeline
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {PIPELINE.map((s) => (
            <div key={s.key} className="min-w-16">
              <div className="font-display text-2xl text-bone">
                {loading ? "—" : (stats?.leadsByStatus[s.key] ?? 0)}
              </div>
              <div className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-faint">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!loading &&
        stats?.totalLeads === 0 &&
        stats?.upcomingBookings === 0 &&
        stats?.conversations === 0 && (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          No activity yet. Set up branding, add your team, and connect your
          knowledge from the sidebar — metrics light up here once your assistant
          goes live.
        </p>
      )}
      {stats?.capped && (
        <p className="mt-3 text-xs text-faint">
          Counts shown up to 1,000 per metric.
        </p>
      )}

      <div className="mt-8">
        <WidgetKeyCard />
      </div>
    </div>
  );
}
