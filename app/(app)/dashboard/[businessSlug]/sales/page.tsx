"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBusiness } from "@/components/dashboard/business-context";
import { ModuleGate } from "@/components/dashboard/module-gate";

export default function SalesPage() {
  return (
    <ModuleGate module="salesAssistant">
      <SalesInner />
    </ModuleGate>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface/40 p-5">
      <div className="font-mono text-xs uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl text-bone">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

const STAGES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

function SalesInner() {
  const b = useBusiness();
  const data = useQuery(api.sales.metrics, { slug: b.slug });

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const maxStage = Math.max(1, ...STAGES.map((s) => data.byStatus[s.key]));

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">Sales</h1>
      <p className="mt-1 text-sm text-muted">
        Your assistant qualifies, books, and follows up with leads so none go
        cold. Here&rsquo;s how the pipeline is converting.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total leads" value={data.total} />
        <Stat label="Hot leads" value={data.hotLeads} hint="flagged by the AI" />
        <Stat label="Appointments" value={data.appointmentsBooked} hint="AI-booked" />
        <Stat
          label="Conversion"
          value={`${Math.round(data.conversion * 100)}%`}
          hint="leads → won"
        />
      </div>

      {/* Pipeline funnel */}
      <div className="mt-6 rounded-xl border border-line bg-surface/40 p-6">
        <div className="font-mono text-xs uppercase tracking-wider text-faint">
          Pipeline
        </div>
        <div className="mt-4 space-y-3">
          {STAGES.map((s) => {
            const count = data.byStatus[s.key];
            return (
              <div key={s.key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-bone-dim">
                  {s.label}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-ember"
                    style={{ width: `${(count / maxStage) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-sm text-bone">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
