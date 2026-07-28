// A labeled usage bar: used / cap with a percentage. cap === null means
// unlimited (no bar); cap === 0 means the feature isn't on the plan.
export function UsageMeter({
  label,
  used,
  cap,
  unit,
}: {
  label: string;
  used: number;
  cap: number | null;
  unit?: string;
}) {
  const metered = cap !== null && cap > 0;
  const pct = metered ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone =
    pct >= 90 ? "bg-ember-deep" : pct >= 75 ? "bg-flare" : "bg-ember";

  const right =
    cap === null
      ? `${used.toLocaleString()} · unlimited`
      : cap === 0
        ? "Not on your plan"
        : `${used.toLocaleString()} / ${cap.toLocaleString()}${unit ? ` ${unit}` : ""} · ${pct}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-wider text-faint">
          {label}
        </span>
        <span className="text-sm text-bone-dim">{right}</span>
      </div>
      {metered && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full ${tone} transition-[width] duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
