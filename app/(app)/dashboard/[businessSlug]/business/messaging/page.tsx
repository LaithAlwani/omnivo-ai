"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

type Settings = {
  confirmationEnabled: boolean;
  reminderEnabled: boolean;
  reviewRequestEnabled: boolean;
  leadFollowupEnabled: boolean;
  reminderLeadHours: number;
  quietStart: number | null;
  quietEnd: number | null;
};

type ToggleKey =
  | "confirmationEnabled"
  | "reminderEnabled"
  | "reviewRequestEnabled"
  | "leadFollowupEnabled";

const EVENTS: { key: ToggleKey; label: string; hint: string }[] = [
  { key: "confirmationEnabled", label: "Booking confirmation", hint: "Text the customer when they book." },
  { key: "reminderEnabled", label: "Booking reminder", hint: "Text before the appointment." },
  { key: "reviewRequestEnabled", label: "Review request", hint: "Text after the visit to ask for a review (else email)." },
  { key: "leadFollowupEnabled", label: "Lead follow-up", hint: "Text un-converted leads to nurture them (else email)." },
];

const hourLabel = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;

export default function MessagingPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const data = useQuery(api.messaging.getSettings, { slug: b.slug });
  const update = useMutation(api.messaging.updateSettings);
  const sendTest = useAction(api.sms.sendTest);

  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data && form === null) setForm(data.settings);
  }, [data, form]);

  if (data === undefined || form === null) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const quietOn = form.quietStart !== null && form.quietEnd !== null;

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setError(null);
    setBusy(true);
    try {
      await update({ slug: b.slug, settings: form });
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTestMsg(null);
    setError(null);
    try {
      await sendTest({ slug: b.slug, to: testTo });
      setTestMsg("Sent ✓ — check the phone.");
    } catch (e) {
      setTestMsg(errorText(e));
    }
  }

  const capLabel =
    data.status.cap === null ? "unlimited" : data.status.cap.toLocaleString();

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl text-bone">Messaging</h1>
      <p className="mt-1 text-sm text-muted">
        Control which texts your assistant sends and when. Texts come from your
        Omnivo AI number and count toward your monthly SMS allowance.
      </p>

      {/* Status */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/50 p-5">
        <span
          className={`rounded-full border px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider ${
            data.status.moduleEnabled
              ? "border-ember/40 bg-ember-soft text-ember"
              : "border-line-strong text-faint"
          }`}
        >
          SMS {data.status.moduleEnabled ? "on" : "off"}
        </span>
        <span className="text-sm text-bone-dim">
          {data.status.used.toLocaleString()} of {capLabel} used this month
        </span>
        {data.status.timezone && (
          <span className="text-xs text-faint">· {data.status.timezone}</span>
        )}
      </div>

      {!data.status.moduleEnabled && (
        <p className="mt-3 rounded-lg border border-line bg-surface/40 px-4 py-3 text-sm text-muted">
          SMS isn&rsquo;t active on your plan. It&rsquo;s included on every tier —
          check Plan &amp; usage.
        </p>
      )}

      <fieldset disabled={!canEdit || busy} className="mt-6 space-y-6">
        {/* Per-event toggles */}
        <section className="rounded-xl border border-line bg-surface/40 p-6">
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            What to text
          </div>
          <div className="mt-4 space-y-3">
            {EVENTS.map((ev) => (
              <label
                key={ev.key}
                className="flex cursor-pointer items-start justify-between gap-4"
              >
                <span>
                  <span className="text-sm text-bone">{ev.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">{ev.hint}</span>
                </span>
                <Toggle
                  on={form[ev.key]}
                  onChange={(v) => set(ev.key, v)}
                />
              </label>
            ))}
          </div>
        </section>

        {/* Reminder timing */}
        <section className="rounded-xl border border-line bg-surface/40 p-6">
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            Reminder timing
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-bone-dim">
            Send the reminder
            <select
              value={form.reminderLeadHours}
              onChange={(e) => set("reminderLeadHours", Number(e.target.value))}
              className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
            >
              {[1, 2, 3, 6, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
            before the appointment.
          </label>
        </section>

        {/* Quiet hours */}
        <section className="rounded-xl border border-line bg-surface/40 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-xs uppercase tracking-wider text-faint">
                Quiet hours
              </div>
              <p className="mt-1 text-xs text-faint">
                Don&rsquo;t send review or follow-up texts overnight (your
                timezone). Confirmations and reminders are unaffected.
              </p>
            </div>
            <Toggle
              on={quietOn}
              onChange={(v) => {
                if (v) {
                  set("quietStart", 21);
                  set("quietEnd", 8);
                } else {
                  set("quietStart", null);
                  set("quietEnd", null);
                }
              }}
            />
          </div>
          {quietOn && (
            <div className="mt-4 flex items-center gap-2 text-sm text-bone-dim">
              From
              <HourSelect
                value={form.quietStart ?? 21}
                onChange={(h) => set("quietStart", h)}
              />
              to
              <HourSelect
                value={form.quietEnd ?? 8}
                onChange={(h) => set("quietEnd", h)}
              />
            </div>
          )}
        </section>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-flare">Saved ✓</span>}
          </div>
        )}
      </fieldset>

      {/* Send a test */}
      {canEdit && (
        <section className="mt-6 rounded-xl border border-line bg-surface/40 p-6">
          <div className="font-mono text-xs uppercase tracking-wider text-faint">
            Send a test
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="+1 555 123 4567"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
            />
            <button
              onClick={test}
              disabled={!testTo}
              className="h-10 rounded-full border border-line-strong px-4 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone disabled:opacity-60"
            >
              Send test
            </button>
          </div>
          {testMsg && <p className="mt-2 text-sm text-bone-dim">{testMsg}</p>}
        </section>
      )}

      {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
    </div>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className="mt-0.5 shrink-0"
    >
      <span
        className={`relative block h-6 w-11 rounded-full transition-colors ${
          on ? "bg-ember" : "bg-surface-2 border border-line-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-bone transition-transform ${
            on ? "left-0.5 translate-x-5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function HourSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (h: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-bone focus-visible:border-ember"
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </select>
  );
}
