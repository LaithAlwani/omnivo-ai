"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import { useBusiness } from "@/components/dashboard/business-context";
import { UsageMeter } from "@/components/dashboard/usage-meter";
import { plans } from "@/lib/site-config";

const SELECTABLE_PLANS = plans.filter((p) => p.slug !== "enterprise");

const FEATURES = [
  { key: "whiteLabel", label: "White-label branding" },
  { key: "customEmailDomain", label: "Custom email domain" },
] as const;

function Check({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ember" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

export default function UsagePage() {
  const b = useBusiness();
  const data = useQuery(api.tiers.planUsage, { slug: b.slug });
  const plan = plans.find((p) => p.slug === b.tier);
  const setPlan = useMutation(api.accounts.setPlan);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = b.role === "owner";

  async function changePlan(target: string) {
    setError(null);
    setBusy(target);
    try {
      await setPlan({
        slug: b.slug,
        plan: target as "starter" | "professional" | "premium",
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl text-bone">Plan &amp; usage</h1>
      <p className="mt-1 text-sm text-muted">
        Your current plan, what&rsquo;s included, and this month&rsquo;s usage.
      </p>

      {/* Current plan */}
      <div className="mt-6 flex items-baseline justify-between rounded-xl border border-line bg-surface/50 p-6">
        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            Current plan
          </div>
          <div className="mt-1 font-display text-2xl text-bone">
            {plan?.name ?? data.tier}
          </div>
        </div>
        {plan && (
          <div className="text-right">
            <span className="font-display text-2xl text-bone">{plan.price}</span>
            <span className="text-sm text-muted">{plan.cadence}</span>
          </div>
        )}
      </div>

      {/* Usage this period */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Usage · {data.period}
        </div>
        <div className="mt-4 space-y-5">
          <UsageMeter
            label="Conversations"
            used={data.conversations.used}
            cap={data.conversations.cap}
          />
          <UsageMeter
            label="Emails"
            used={data.emails.used}
            cap={data.emails.cap}
          />
          <UsageMeter label="SMS" used={data.sms.used} cap={data.sms.cap} />
        </div>
        <p className="mt-5 text-xs text-faint">
          Conversation, email, and SMS usage is pooled across your account and
          resets at the start of each month.
        </p>
        {(() => {
          const overCents =
            data.conversations.overageCents +
            data.emails.overageCents +
            data.sms.overageCents;
          if (overCents <= 0) return null;
          return (
            <p className="mt-3 rounded-lg border border-ember/40 bg-ember-soft/40 px-3 py-2 text-xs text-bone-dim">
              You&rsquo;re over your monthly allowance. Estimated overage this
              period:{" "}
              <span className="text-bone">${(overCents / 100).toFixed(2)}</span>.
            </p>
          );
        })()}
      </div>

      {/* Included features */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Included in your plan
        </div>
        <ul className="mt-4 space-y-2.5">
          {FEATURES.map((f) => {
            const on = data.features[f.key];
            return (
              <li key={f.key} className="flex items-center gap-2.5 text-sm">
                <Check on={on} />
                <span className={on ? "text-bone" : "text-faint line-through"}>
                  {f.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Change plan */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Change plan
        </div>
        <p className="mt-1 text-sm text-muted">
          Each tier bundles more modules, higher limits, and more locations.
          Changing your plan updates what your assistant can do right away.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {SELECTABLE_PLANS.map((p) => {
            const current = p.slug === b.tier;
            return (
              <div
                key={p.slug}
                className={`rounded-xl border p-4 ${
                  current
                    ? "border-ember/50 bg-ember-soft/40"
                    : "border-line bg-surface/50"
                }`}
              >
                <div className="font-display text-lg text-bone">{p.name}</div>
                <div className="mt-0.5">
                  <span className="font-display text-xl text-bone">{p.price}</span>
                  <span className="text-xs text-faint">{p.cadence}</span>
                </div>
                <button
                  disabled={!isOwner || current || busy !== null}
                  onClick={() => changePlan(p.slug)}
                  className={`mt-3 h-9 w-full rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                    current
                      ? "border border-line-strong text-faint"
                      : "bg-ember text-[#160b04] hover:bg-flare"
                  }`}
                >
                  {current
                    ? "Current"
                    : busy === p.slug
                      ? "Switching…"
                      : "Switch"}
                </button>
              </div>
            );
          })}
        </div>
        {!isOwner && (
          <p className="mt-3 text-xs text-faint">
            Only the account owner can change the plan.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
        <p className="mt-3 text-xs text-faint">
          Multi-location or agency?{" "}
          <a href="/book" className="text-ember underline hover:text-flare">
            Talk to us about Enterprise
          </a>
          .
        </p>
      </div>
    </div>
  );
}
