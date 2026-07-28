"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBusiness } from "@/components/dashboard/business-context";
import { UsageMeter } from "@/components/dashboard/usage-meter";
import { plans } from "@/lib/site-config";

const FEATURES = [
  { key: "sms", label: "SMS reminders & follow-ups" },
  { key: "whiteLabel", label: "White-label branding" },
  { key: "aiEmployees", label: "AI Employees" },
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
          <div>
            <UsageMeter
              label="Conversations"
              used={data.conversations.used}
              cap={data.conversations.cap}
            />
            {data.conversations.remaining !== null && (
              <p className="mt-1 text-xs text-faint">
                {data.conversations.remaining.toLocaleString()} left this month
              </p>
            )}
          </div>
          <div>
            <UsageMeter label="SMS" used={data.sms.used} cap={data.sms.cap} />
            {data.sms.cap !== 0 && data.sms.remaining !== null && (
              <p className="mt-1 text-xs text-faint">
                {data.sms.remaining.toLocaleString()} left this month
              </p>
            )}
          </div>
        </div>
        <p className="mt-5 text-xs text-faint">
          Usage resets at the start of each month.
        </p>
      </div>

      {/* Included features */}
      <div className="mt-4 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Included in your plan
        </div>
        <ul className="mt-4 space-y-2.5">
          {FEATURES.map((f) => {
            const on = data.limits[f.key];
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
