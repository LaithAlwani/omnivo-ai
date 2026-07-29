"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

type Preset = {
  role: string;
  name: string;
  persona: string;
  welcomeMsg: string;
  canBook: boolean;
  canCaptureLeads: boolean;
};

const PRESETS: Preset[] = [
  {
    role: "receptionist",
    name: "Reception",
    persona:
      "You are a warm, efficient receptionist. Answer questions about the business, check availability, and book appointments. Confirm the details before booking.",
    welcomeMsg: "Hi! I can answer questions and get you booked in — how can I help?",
    canBook: true,
    canCaptureLeads: true,
  },
  {
    role: "sales",
    name: "Sales",
    persona:
      "You are a friendly sales rep. Understand what the visitor needs, highlight the most relevant services, and capture their contact details for follow-up. Be helpful, never pushy.",
    welcomeMsg: "Hey! Looking for the right fit? Tell me what you need.",
    canBook: false,
    canCaptureLeads: true,
  },
  {
    role: "reviews",
    name: "Reviews",
    persona:
      "You warmly thank customers and invite happy ones to leave a review, sharing the link when asked. If someone is unhappy, capture their feedback for the team instead.",
    welcomeMsg: "Thanks for visiting! Mind sharing how it went?",
    canBook: false,
    canCaptureLeads: true,
  },
];

export default function EmployeesPage() {
  const b = useBusiness();
  const proPlus = b.tier !== "starter";
  const canEdit = isManagerRole(b.role);
  const employees = useQuery(api.employees.list, { slug: b.slug });
  const create = useMutation(api.employees.createEmployee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPreset(p: Preset) {
    setError(null);
    setBusy(true);
    try {
      await create({
        slug: b.slug,
        name: p.name,
        role: p.role,
        persona: p.persona,
        welcomeMsg: p.welcomeMsg,
        canBook: p.canBook,
        canCaptureLeads: p.canCaptureLeads,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">AI Employees</h1>
      <p className="mt-1 text-sm text-muted">
        Compose assistant roles from your toolkit. Your widget serves the{" "}
        <span className="text-bone-dim">default</span> employee.
      </p>

      {!proPlus ? (
        <div className="mt-6 rounded-lg border border-ember/40 bg-ember-soft px-4 py-3 text-sm text-bone">
          AI Employees are available on Professional and up.{" "}
          <a
            href="https://omnivoai.ca/#pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ember underline hover:text-flare"
          >
            See plans
          </a>
        </div>
      ) : (
        <>
          {canEdit && (
            <div className="mt-6">
              <p className="font-mono text-xs uppercase tracking-wider text-faint">
                Add from a template
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.role}
                    onClick={() => addPreset(p)}
                    disabled={busy}
                    className="rounded-full border border-line-strong px-4 py-2 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone disabled:opacity-60"
                  >
                    + {p.name}
                  </button>
                ))}
              </div>
              {error && (
                <p className="mt-2 text-sm text-ember-deep">{error}</p>
              )}
            </div>
          )}

          <div className="mt-8 space-y-4">
            {employees === undefined ? (
              <p className="text-sm text-faint">Loading…</p>
            ) : employees.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface/40 p-6 text-sm text-faint">
                No employees yet. Add one from a template above — the first one
                becomes your default.
              </p>
            ) : (
              employees.map((e) => (
                <EmployeeCard key={e._id} employee={e} canEdit={canEdit} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        on
          ? "border-ember/50 bg-ember-soft text-bone"
          : "border-line-strong text-faint hover:text-bone-dim"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ember" : "bg-faint"}`}
      />
      {label}
    </button>
  );
}

function EmployeeCard({
  employee,
  canEdit,
}: {
  employee: Doc<"aiEmployees">;
  canEdit: boolean;
}) {
  const b = useBusiness();
  const update = useMutation(api.employees.updateEmployee);
  const setDefault = useMutation(api.employees.setDefault);
  const remove = useMutation(api.employees.removeEmployee);

  const [form, setForm] = useState({
    name: employee.name,
    role: employee.role,
    persona: employee.persona,
    welcomeMsg: employee.welcomeMsg,
    canBook: employee.canBook,
    canCaptureLeads: employee.canCaptureLeads,
    active: employee.active,
  });
  const [busy, setBusy] = useState<null | "save" | "default" | "remove">(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: val }));
    setSaved(false);
  }

  async function onSave() {
    setError(null);
    setBusy("save");
    try {
      await update({ slug: b.slug, employeeId: employee._id, ...form });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface/40 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg text-bone">
            {form.name || "Unnamed"}
          </span>
          {employee.isDefault && (
            <span className="rounded-full border border-ember/40 bg-ember-soft px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-ember">
              Default
            </span>
          )}
          {!employee.active && (
            <span className="font-mono text-[0.6rem] uppercase tracking-wider text-faint">
              Inactive
            </span>
          )}
        </div>
        {canEdit && !employee.isDefault && (
          <button
            onClick={async () => {
              setBusy("default");
              try {
                await setDefault({ slug: b.slug, employeeId: employee._id });
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy !== null}
            className="text-xs text-ember transition-colors hover:text-flare disabled:opacity-60"
          >
            Set default
          </button>
        )}
      </div>

      {/* How to target this specific employee from a widget snippet. */}
      <p className="mt-2 break-all font-mono text-[0.65rem] text-faint">
        Widget target:{" "}
        <span className="text-bone-dim">data-employee=&quot;{employee._id}&quot;</span>
      </p>

      <fieldset disabled={!canEdit || busy !== null} className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Name"
          />
          <input
            className={inputCls}
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="Role (e.g. receptionist)"
          />
        </div>
        <textarea
          className={`${inputCls} h-auto py-2.5`}
          rows={3}
          value={form.persona}
          onChange={(e) => set("persona", e.target.value)}
          placeholder="Instructions — who this employee is and how it should behave"
        />
        <textarea
          className={`${inputCls} h-auto py-2.5`}
          rows={2}
          value={form.welcomeMsg}
          onChange={(e) => set("welcomeMsg", e.target.value)}
          placeholder="Welcome message"
        />
        <div className="flex flex-wrap gap-2">
          <Toggle
            label="Can book"
            on={form.canBook}
            onChange={(v) => set("canBook", v)}
          />
          <Toggle
            label="Can capture leads"
            on={form.canCaptureLeads}
            onChange={(v) => set("canCaptureLeads", v)}
          />
          <Toggle
            label="Active"
            on={form.active}
            onChange={(v) => set("active", v)}
          />
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={onSave}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={async () => {
                setBusy("remove");
                try {
                  await remove({ slug: b.slug, employeeId: employee._id });
                } finally {
                  setBusy(null);
                }
              }}
              className="h-10 rounded-full border border-line-strong px-4 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone"
            >
              Delete
            </button>
            {saved && <span className="text-sm text-flare">Saved ✓</span>}
            {error && <span className="text-sm text-ember-deep">{error}</span>}
          </div>
        )}
      </fieldset>
    </div>
  );
}
