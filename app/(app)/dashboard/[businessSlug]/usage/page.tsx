"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBusiness } from "@/components/dashboard/business-context";
import { UsageMeter } from "@/components/dashboard/usage-meter";
import { plans } from "@/lib/site-config";

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

      {/* Upgrade */}
      {b.tier !== "enterprise" && (
        <div className="mt-4 rounded-xl border border-ember/40 bg-ember-soft p-5">
          <p className="text-sm text-bone">
            Need more? Upgrade for higher limits, SMS, white-label, and AI
            Employees.
          </p>
          <a
            href="https://omnivoai.ca/#pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-10 items-center rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            See plans
          </a>
        </div>
      )}
    </div>
  );
}
