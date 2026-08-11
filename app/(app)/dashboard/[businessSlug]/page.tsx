"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBusiness } from "@/components/dashboard/business-context";
import { WidgetKeyCard } from "@/components/dashboard/widget-key-card";

/** One emphasized word in the greeting. */
function Em({ children }: { children: React.ReactNode }) {
  return <span className="italic text-ember">{children}</span>;
}

// -----------------------------------------------------------------------------
// The dashboard home: the install lifecycle status, a 2×2 metric grid, this
// month's usage, and an onboarding checklist — all wired to analytics.overview
// + the business context.
// -----------------------------------------------------------------------------

export default function OverviewPage() {
  const b = useBusiness();
  const stats = useQuery(api.analytics.overview, { slug: b.slug });

  const loading = stats === undefined;
  const tier = b.tier ?? "starter";

  const noActivity =
    !loading &&
    stats.conversations === 0 &&
    stats.upcomingBookings === 0 &&
    stats.totalLeads === 0;

  // Greeting reflects the real state of the account.
  let greet: React.ReactNode = b.name;
  let greetSub = "";
  if (!loading) {
    if (noActivity) {
      greet = <>Your assistant is <Em>ready</Em>.</>;
      greetSub =
        "It hasn’t spoken to anyone yet — a few steps and it can start answering for you.";
    } else if (stats.openLeads > 0) {
      const n = stats.openLeads;
      greet = (
        <>
          {n} {n === 1 ? "lead" : "leads"} <Em>need</Em> you.
        </>
      );
      greetSub = `${stats.conversationsThisMonth} conversation${stats.conversationsThisMonth === 1 ? "" : "s"} this month · ${stats.upcomingBookings} upcoming booking${stats.upcomingBookings === 1 ? "" : "s"}.`;
    } else {
      greet = <>Your assistant is <Em>humming</Em>.</>;
      greetSub = `${stats.conversationsThisMonth} conversation${stats.conversationsThisMonth === 1 ? "" : "s"} this month · ${stats.upcomingBookings} upcoming booking${stats.upcomingBookings === 1 ? "" : "s"}.`;
    }
  }

  const cards = loading
    ? []
    : [
        {
          v: stats.conversationsThisMonth,
          label: "Conversations",
          sub:
            stats.conversationsThisMonth > 0
              ? `${stats.conversationsThisWeek} this week`
              : "Add your first answer",
        },
        {
          v: stats.upcomingBookings,
          label: "Bookings",
          sub:
            stats.upcomingBookings > 0
              ? `${stats.bookingsThisWeek} in the next 7 days`
              : "Connect a calendar",
        },
        {
          v: stats.openLeads,
          label: "Open leads",
          sub:
            stats.openLeads > 0
              ? `${stats.totalLeads} total`
              : "Share your assistant",
        },
        {
          v: stats.wonLeads,
          label: "Won",
          sub:
            stats.totalLeads > 0
              ? `${Math.round((stats.wonLeads / stats.totalLeads) * 100)}% of leads`
              : "Nothing closed yet",
        },
      ];

  const steps = loading
    ? []
    : [
        {
          t: "Teach it about your business",
          d: "Hours, services, pricing, service area",
          done: stats.knowledgeReady,
          href: `/dashboard/${b.slug}/business/knowledge`,
        },
        {
          t: "Connect your calendar",
          d: "So it can book without asking you",
          done: stats.calendarConnected,
          href: `/dashboard/${b.slug}/business/schedule`,
        },
        {
          t: "Put it on your website",
          d: "One line of code, or share a link",
          done: stats.conversations > 0,
          href: "#install",
        },
      ];
  const allDone = steps.length > 0 && steps.every((s) => s.done);

  return (
    <div className="max-w-2xl">
      <p className="font-mono text-[11px] tracking-wide text-faint">
        /{b.slug} · {tier}
      </p>

      <h1 className="mt-4 max-w-[20ch] font-display text-3xl leading-[1.16] text-bone">
        {greet}
      </h1>
      {greetSub && (
        <p className="mt-2.5 max-w-[42ch] text-sm leading-relaxed text-muted">
          {greetSub}
        </p>
      )}

      {/* Install lifecycle status. */}
      <div className="mt-7 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.07em]">
        <span>
          <span
            className={
              b.status === "live"
                ? "text-emerald-400"
                : b.status === "paused"
                  ? "text-ember-deep"
                  : "text-ember"
            }
          >
            {b.status}
          </span>
          <span className="text-faint"> · {tier} plan</span>
        </span>
        {b.status !== "live" && (
          <Link
            href={`/dashboard/${b.slug}/go-live`}
            className="text-faint transition-colors hover:text-bone"
          >
            GO LIVE →
          </Link>
        )}
      </div>

      {/* 2×2 metric grid */}
      <div className="mt-7 grid grid-cols-2 gap-3">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="min-h-[128px] rounded-xl border border-line bg-surface/40"
              />
            ))
          : cards.map((c) => {
              const idle = c.v === 0;
              return (
                <div
                  key={c.label}
                  className={`relative flex min-h-[128px] flex-col overflow-hidden rounded-xl border p-4 ${
                    idle ? "border-line bg-surface/40" : "border-line bg-surface"
                  }`}
                >
                  {!idle && (
                    <span className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-ember to-transparent" />
                  )}
                  <div
                    className={`font-display text-[2.4rem] leading-none ${
                      idle ? "text-faint" : "text-bone"
                    }`}
                  >
                    {c.v}
                  </div>
                  <div className="mt-auto pt-3 font-mono text-[10px] uppercase tracking-[0.11em] text-muted">
                    {c.label}
                  </div>
                  <div
                    className={`mt-1 text-[11.5px] leading-snug ${
                      idle ? "text-ember/90" : "text-faint"
                    }`}
                  >
                    {c.sub}
                  </div>
                </div>
              );
            })}
      </div>

      {/* Usage this month */}
      <div className="mt-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.11em] text-muted">
          <span>Usage this month</span>
          <Link
            href={`/dashboard/${b.slug}/usage`}
            className="text-ember transition-colors hover:text-flare"
          >
            Plan &amp; usage →
          </Link>
        </div>
        <div className="mt-3">
          {loading ? (
            <div className="h-8" />
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Conversations</span>
              <span className="font-mono text-sm text-bone-dim">
                {stats.conversationsThisMonth.toLocaleString()}
                {stats.conversationCap
                  ? ` / ${stats.conversationCap.toLocaleString()}`
                  : ""}
              </span>
            </div>
          )}
          {!loading && stats.conversationCap ? (
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-ember transition-[width] duration-700"
                style={{
                  width: `${Math.min(100, Math.round((stats.conversationsThisMonth / stats.conversationCap) * 100))}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Next steps / onboarding */}
      {!loading && (
        <div className="mt-8">
          <div className="border-b border-line pb-2.5 font-mono text-[10px] uppercase tracking-[0.11em] text-muted">
            {allDone ? "You’re set up" : "Next"}
          </div>
          {allDone ? (
            <p className="py-4 text-sm text-muted">
              Everything’s connected — your assistant is live. Metrics update
              here as it works.
            </p>
          ) : (
            steps.map((st, i) => (
              <Link
                key={st.t}
                href={st.href}
                className="group flex items-center gap-3.5 border-b border-line py-3.5"
              >
                <span
                  className={`w-4 flex-none font-mono text-[10.5px] ${
                    st.done ? "text-ember" : "text-faint"
                  }`}
                >
                  {st.done ? "✓" : String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm transition-colors ${
                      st.done
                        ? "text-muted line-through decoration-faint"
                        : "text-bone group-hover:text-ember"
                    }`}
                  >
                    {st.t}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-faint">
                    {st.d}
                  </span>
                </span>
                <span className="ml-auto flex-none text-faint transition-colors group-hover:text-bone">
                  →
                </span>
              </Link>
            ))
          )}
        </div>
      )}

      {/* Widget install — kept accessible from the home; the "put it on your
          website" step links here. */}
      <div id="install" className="mt-8 scroll-mt-24">
        <WidgetKeyCard />
      </div>
    </div>
  );
}
