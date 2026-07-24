"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";
import { useConfirm } from "@/components/ui/confirm";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_OPTIONS = [15, 30, 45, 60, 90];

type Interval = { start: number; end: number };
type Week = { intervals: Interval[] }[];

function defaultWeekdays(): Week {
  // Mon–Fri 9:00–17:00 as a friendly starting point.
  return Array.from({ length: 7 }, (_, d) => ({
    intervals: d >= 1 && d <= 5 ? [{ start: 540, end: 1020 }] : [],
  }));
}

function toTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function toMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const browserTz =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

export default function SchedulePage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const staff = useQuery(api.staff.list, { slug: b.slug });
  const [selected, setSelected] = useState<Id<"staff"> | null>(null);

  const current = staff?.find((s) => s._id === selected) ?? staff?.[0];
  const staffId = current?._id ?? null;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">Schedule</h1>
      <p className="mt-1 text-sm text-muted">
        Weekly availability per staff member. The assistant offers open slots
        from these hours.
      </p>

      {staff === undefined ? (
        <p className="mt-6 text-sm text-faint">Loading…</p>
      ) : staff.length === 0 ? (
        <p className="mt-6 text-sm text-faint">
          Add staff on the Team page first.
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {staff.map((s) => (
              <button
                key={s._id}
                onClick={() => setSelected(s._id)}
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  s._id === staffId
                    ? "border-ember bg-ember-soft text-bone"
                    : "border-line text-bone-dim hover:border-line-strong"
                }`}
              >
                {s.name}
                {!s.bookable && (
                  <span className="ml-1.5 text-xs text-faint">· not bookable</span>
                )}
              </button>
            ))}
          </div>

          {staffId && (
            <AvailabilityEditor
              key={staffId}
              slug={b.slug}
              staffId={staffId}
              canEdit={canEdit}
            />
          )}
        </>
      )}
    </div>
  );
}

function AvailabilityEditor({
  slug,
  staffId,
  canEdit,
}: {
  slug: string;
  staffId: Id<"staff">;
  canEdit: boolean;
}) {
  const stored = useQuery(api.availability.get, { slug, staffId });
  const save = useMutation(api.availability.update);

  const [tz, setTz] = useState<string | null>(null);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [week, setWeek] = useState<Week | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from the loaded rule (once).
  if (week === null && stored !== undefined) {
    if (stored) {
      setTz(stored.timezone);
      setSlotMinutes(stored.slotMinutes);
      setWeek(stored.week);
    } else {
      setTz(browserTz);
      setWeek(defaultWeekdays());
    }
  }

  if (!week || tz === null) {
    return <p className="mt-6 text-sm text-faint">Loading…</p>;
  }

  function setDay(d: number, intervals: Interval[]) {
    setWeek((w) => (w ? w.map((x, i) => (i === d ? { intervals } : x)) : w));
    setSaved(false);
  }

  async function onSave() {
    if (!week) return;
    setError(null);
    setPending(true);
    try {
      await save({
        slug,
        staffId,
        availability: { timezone: tz!, slotMinutes, week },
      });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <CalendarConnect slug={slug} staffId={staffId} />

      <p className="mb-2 text-sm text-bone-dim">Weekly hours</p>
      <fieldset disabled={!canEdit || pending} className="space-y-2">
        {DAYS.map((label, d) => (
          <div
            key={d}
            className="flex flex-wrap items-start gap-3 rounded-lg border border-line px-4 py-3"
          >
            <span className="w-10 shrink-0 pt-1.5 text-sm text-bone-dim">
              {label}
            </span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {week[d].intervals.length === 0 && (
                <span className="py-1.5 text-sm text-faint">Closed</span>
              )}
              {week[d].intervals.map((iv, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={toTime(iv.start)}
                    onChange={(e) =>
                      setDay(
                        d,
                        week[d].intervals.map((x, j) =>
                          j === i ? { ...x, start: toMins(e.target.value) } : x,
                        ),
                      )
                    }
                    className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
                  />
                  <span className="text-faint">–</span>
                  <input
                    type="time"
                    value={toTime(iv.end)}
                    onChange={(e) =>
                      setDay(
                        d,
                        week[d].intervals.map((x, j) =>
                          j === i ? { ...x, end: toMins(e.target.value) } : x,
                        ),
                      )
                    }
                    className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDay(
                        d,
                        week[d].intervals.filter((_, j) => j !== i),
                      )
                    }
                    aria-label="Remove"
                    className="grid h-8 w-8 place-items-center text-muted hover:text-ember-deep"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setDay(d, [
                    ...week[d].intervals,
                    { start: 540, end: 1020 },
                  ])
                }
                className="rounded-full border border-line-strong px-3 py-1 text-xs text-bone-dim hover:border-ember/50 hover:text-bone"
              >
                + Add hours
              </button>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-bone-dim">
          Slot length
          <select
            disabled={!canEdit}
            value={slotMinutes}
            onChange={(e) => {
              setSlotMinutes(Number(e.target.value));
              setSaved(false);
            }}
            className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone"
          >
            {SLOT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-bone-dim">
          Timezone
          <input
            disabled={!canEdit}
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              setSaved(false);
            }}
            className="h-9 w-56 rounded-lg border border-line-strong bg-surface px-2 font-mono text-xs text-bone"
          />
        </label>
      </div>

      {canEdit && (
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={pending}
            className="h-11 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save availability"}
          </button>
          {saved && <span className="text-sm text-flare">Saved ✓</span>}
          {error && <span className="text-sm text-ember-deep">{error}</span>}
        </div>
      )}

      <TimeOff slug={slug} staffId={staffId} canEdit={canEdit} />
    </div>
  );
}

const fmtRange = (startMs: number, endMs: number) => {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${s.toLocaleString([], opts)} → ${e.toLocaleString([], opts)}`;
};

// datetime-local <-> ms (interpreted in the browser's local zone).
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function TimeOff({
  slug,
  staffId,
  canEdit,
}: {
  slug: string;
  staffId: Id<"staff">;
  canEdit: boolean;
}) {
  const blackouts = useQuery(api.blackouts.list, { slug, staffId });
  const add = useMutation(api.blackouts.add);
  const remove = useMutation(api.blackouts.remove);
  const { confirm, dialog } = useConfirm();

  const now = new Date();
  const [start, setStart] = useState(toLocalInput(now.getTime() + 3_600_000));
  const [end, setEnd] = useState(toLocalInput(now.getTime() + 7_200_000));
  const [reason, setReason] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await add({
        slug,
        staffId: everyone ? undefined : staffId,
        start: new Date(start).getTime(),
        end: new Date(end).getTime(),
        reason: reason || undefined,
      });
      setReason("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-10 border-t border-line pt-6">
      <p className="text-sm text-bone-dim">Time off &amp; holidays</p>
      <p className="mt-1 text-xs text-faint">
        Blocks these times from booking — for this staff member, or the whole
        business.
      </p>

      <div className="mt-3 space-y-2">
        {blackouts?.length === 0 && (
          <p className="text-xs text-faint">No time off scheduled.</p>
        )}
        {blackouts?.map((bo) => (
          <div
            key={bo._id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-bone-dim">
                {fmtRange(bo.start, bo.end)}
                {bo.staffId == null && (
                  <span className="ml-2 rounded-full border border-line-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                    Whole business
                  </span>
                )}
              </p>
              {bo.reason && <p className="truncate text-xs text-faint">{bo.reason}</p>}
            </div>
            {canEdit && (
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Remove time off?",
                    message: "These times will open back up for booking.",
                    confirmLabel: "Remove",
                    destructive: true,
                  });
                  if (ok)
                    remove({ slug, blackoutId: bo._id }).catch((e) =>
                      setError(errorText(e)),
                    );
                }}
                className="shrink-0 text-xs text-muted transition-colors hover:text-ember-deep"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <form onSubmit={onAdd} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-faint">
            From
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-faint">
            To
            <input
              type="datetime-local"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
            />
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          />
          <label className="flex items-center gap-2 text-xs text-bone-dim">
            <input
              type="checkbox"
              checked={everyone}
              onChange={(e) => setEveryone(e.target.checked)}
              className="h-4 w-4 accent-ember"
            />
            Whole business
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-full border border-line-strong px-4 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add time off"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      {dialog}
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
};

function CalendarConnect({
  slug,
  staffId,
}: {
  slug: string;
  staffId: Id<"staff">;
}) {
  const status = useQuery(api.calendar.status, { slug, staffId });
  const getAuthUrl = useAction(api.calendar.getAuthUrl);
  const disconnect = useAction(api.calendar.disconnect);
  const sync = useAction(api.calendar.syncBusy);
  const [busy, setBusy] = useState<
    null | "google" | "microsoft" | "sync" | "disconnect"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  async function connect(provider: "google" | "microsoft") {
    setError(null);
    setBusy(provider);
    try {
      const { url } = await getAuthUrl({ slug, staffId, provider });
      window.location.href = url;
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  async function run(
    kind: "sync" | "disconnect",
    fn: () => Promise<unknown>,
  ) {
    setError(null);
    setBusy(kind);
    setSynced(false);
    try {
      await fn();
      if (kind === "sync") setSynced(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const connectedLabel =
    status?.provider != null ? PROVIDER_LABEL[status.provider] : "Calendar";

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-bone">
            {status?.connected ? connectedLabel : "Calendar"}
          </p>
          <p className="mt-0.5 text-xs text-faint">
            {status === undefined
              ? "…"
              : status.connected
                ? `Connected${status.email ? ` · ${status.email}` : ""} — busy times block slots and bookings sync to it.`
                : "Not connected — link Google or Outlook so external events block slots and bookings appear on it."}
          </p>
        </div>
        {status !== undefined && !status.canManage && !status.connected && (
          <span className="text-xs text-faint">
            {status.hasLogin
              ? "This employee connects their own calendar."
              : "An owner connects this calendar."}
          </span>
        )}
        {status !== undefined && status.canManage && (
          <div className="flex items-center gap-2">
            {status.connected ? (
              <>
                <button
                  onClick={() => run("sync", () => sync({ slug, staffId }))}
                  disabled={busy !== null}
                  className="rounded-full border border-line-strong px-3.5 py-1.5 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone disabled:opacity-50"
                >
                  {busy === "sync" ? "Syncing…" : synced ? "Synced ✓" : "Sync now"}
                </button>
                <button
                  onClick={() =>
                    run("disconnect", () => disconnect({ slug, staffId }))
                  }
                  disabled={busy !== null}
                  className="text-sm text-muted transition-colors hover:text-ember-deep disabled:opacity-50"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => connect("google")}
                  disabled={busy !== null}
                  className="rounded-full bg-ember px-4 py-1.5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
                >
                  {busy === "google" ? "Redirecting…" : "Connect Google"}
                </button>
                <button
                  onClick={() => connect("microsoft")}
                  disabled={busy !== null}
                  className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium text-bone transition-colors hover:border-ember/50 disabled:opacity-60"
                >
                  {busy === "microsoft" ? "Redirecting…" : "Connect Outlook"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
    </div>
  );
}
