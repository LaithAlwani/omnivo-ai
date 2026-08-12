"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";
import { useConfirm } from "@/components/ui/confirm";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

const STATUSES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;
type Status = (typeof STATUSES)[number]["key"];

const STATUS_STYLE: Record<Status, string> = {
  new: "border-ember bg-ember-soft text-bone",
  contacted: "border-line-strong text-bone-dim",
  qualified: "border-line-strong text-bone-dim",
  won: "border-flare/50 text-flare",
  lost: "border-line text-faint",
};

const SOURCE_LABEL: Record<string, string> = {
  dashboard: "Manual",
  assistant: "Assistant",
  widget: "Widget",
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

type Lead = ReturnType<typeof useLeads>[number];
function useLeads(slug: string, status: Status | "all") {
  return (
    useQuery(api.leads.list, {
      slug,
      status: status === "all" ? undefined : status,
    }) ?? []
  );
}

export default function LeadsPage() {
  const b = useBusiness();
  const canDelete = isManagerRole(b.role);
  const counts = useQuery(api.leads.counts, { slug: b.slug });
  const [filter, setFilter] = useState<Status | "all">("all");
  const leads = useLeads(b.slug, filter);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl text-bone">Leads</h1>
      <p className="mt-1 text-sm text-muted">
        Captured interest — from the assistant, the widget, or added by hand.
        Move each through the pipeline as you work it.
      </p>

      <AddLead slug={b.slug} />

      <div className="mt-8 flex flex-wrap gap-2">
        <FilterTab
          label="All"
          count={counts?.total}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {STATUSES.map((s) => (
          <FilterTab
            key={s.key}
            label={s.label}
            count={counts?.[s.key]}
            active={filter === s.key}
            onClick={() => setFilter(s.key)}
          />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {leads.length === 0 && (
          <p className="rounded-xl border border-line px-4 py-6 text-sm text-faint">
            No leads {filter === "all" ? "yet" : `in “${filter}”`}.
          </p>
        )}
        {leads.map((l) => (
          <LeadCard
            key={l._id}
            slug={b.slug}
            lead={l}
            canDelete={canDelete}
          />
        ))}
      </div>
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? "border-ember bg-ember-soft text-bone"
          : "border-line text-bone-dim hover:border-line-strong"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 text-xs text-faint">{count}</span>
      )}
    </button>
  );
}

function AddLead({ slug }: { slug: string }) {
  const create = useMutation(api.leads.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await create({
        slug,
        name,
        email: email || undefined,
        phone: phone || undefined,
        message: message || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-6 h-10 rounded-full border border-line-strong px-5 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
      >
        + Add lead
      </button>
    );
  }

  return (
    <form
      onSubmit={onAdd}
      className="mt-6 space-y-3 rounded-xl border border-line bg-surface/40 p-5"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={inputCls}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={inputCls}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className={inputCls}
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What are they interested in?"
        rows={2}
        className={`${inputCls} h-auto w-full py-2`}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !name}
          className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add lead"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted transition-colors hover:text-bone"
        >
          Cancel
        </button>
        {error && <span className="text-sm text-ember-deep">{error}</span>}
      </div>
    </form>
  );
}

function LeadCard({
  slug,
  lead,
  canDelete,
}: {
  slug: string;
  lead: Lead;
  canDelete: boolean;
}) {
  const setStatus = useMutation(api.leads.setStatus);
  const update = useMutation(api.leads.update);
  const remove = useMutation(api.leads.remove);
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-bone">{lead.name}</p>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
              {SOURCE_LABEL[lead.source] ?? lead.source}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-faint">
            {[lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact info"}
            {" · "}
            {fmtDate(lead.createdAt)}
          </p>
          {lead.serviceName && (
            <p className="mt-0.5 text-xs text-bone-dim">
              Interested in {lead.serviceName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={lead.status}
              onChange={(e) =>
                act(() =>
                  setStatus({
                    slug,
                    leadId: lead._id as Id<"leads">,
                    status: e.target.value as Status,
                  }),
                )
              }
              className={`h-8 appearance-none rounded-full border bg-transparent pl-3 pr-7 text-xs capitalize outline-none focus:border-ember ${
                STATUS_STYLE[lead.status as Status]
              }`}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key} className="bg-surface capitalize text-bone">
                  {s.label}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 12 12"
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 opacity-70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {canDelete && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete lead?",
                  message: `${lead.name} will be permanently removed.`,
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (ok) act(() => remove({ slug, leadId: lead._id as Id<"leads"> }));
              }}
              className="text-xs text-muted transition-colors hover:text-ember-deep"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {lead.message && (
        <p className="mt-2 rounded-lg bg-surface/60 px-3 py-2 text-xs text-bone-dim">
          {lead.message}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          defaultValue={lead.notes ?? ""}
          placeholder="Internal notes…"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (lead.notes ?? ""))
              act(() =>
                update({ slug, leadId: lead._id as Id<"leads">, notes: v }),
              );
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-xs text-bone placeholder:text-faint outline-none focus:border-ember"
        />
      </div>
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      {dialog}
    </div>
  );
}
