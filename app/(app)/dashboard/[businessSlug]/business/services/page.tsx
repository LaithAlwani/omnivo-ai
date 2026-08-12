"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";
import { useConfirm } from "@/components/ui/confirm";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

const browserTz =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

function centsToInput(cents: number | undefined): string {
  return cents == null ? "" : (cents / 100).toString();
}
function inputToCents(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function fmtPrice(cents: number | undefined): string {
  if (cents == null) return "—";
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export default function ServicesPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);

  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="font-display text-3xl text-bone">Services</h1>
        <p className="mt-1 text-sm text-muted">
          What you offer, with optional duration and price. The assistant lists
          these by name so it can answer &ldquo;what do you do?&rdquo; and quote
          your prices.
        </p>
        {!canEdit && (
          <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
            View-only — ask an owner or admin to make changes.
          </p>
        )}
      </div>

      <Timezone slug={b.slug} current={b.timezone ?? null} canEdit={canEdit} />
      <ServiceList slug={b.slug} canEdit={canEdit} />
    </div>
  );
}

function Timezone({
  slug,
  current,
  canEdit,
}: {
  slug: string;
  current: string | null;
  canEdit: boolean;
}) {
  const setTz = useMutation(api.businesses.setTimezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <section>
      <h2 className="text-lg text-bone">Business timezone</h2>
      <p className="mt-1 text-sm text-muted">
        The timezone the assistant uses to read dates like &ldquo;next
        Tuesday&rdquo;.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          disabled={!canEdit}
          defaultValue={current ?? browserTz}
          onBlur={async (e) => {
            const next = e.target.value.trim();
            if (!next || next === (current ?? "")) return;
            setError(null);
            setSaved(false);
            try {
              await setTz({ slug, timezone: next });
              setSaved(true);
            } catch (err) {
              setError(errorText(err));
            }
          }}
          className={`${inputCls} w-72 font-mono text-xs`}
        />
        {saved && <span className="text-sm text-flare">Saved ✓</span>}
        {!current && (
          <span className="text-xs text-faint">
            Defaulting to your browser&rsquo;s zone until set.
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
    </section>
  );
}

function ServiceList({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const services = useQuery(api.services.list, { slug });
  const add = useMutation(api.services.add);

  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await add({
        slug,
        name,
        durationMinutes: Number(duration),
        priceCents: inputToCents(price) ?? undefined,
      });
      setName("");
      setDuration("30");
      setPrice("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg text-bone">Service menu</h2>

      <div className="mt-4 space-y-3">
        {services === undefined && (
          <p className="text-sm text-faint">Loading…</p>
        )}
        {services?.length === 0 && (
          <p className="rounded-xl border border-line px-4 py-4 text-sm text-faint">
            No services yet. Add one below — e.g. &ldquo;Haircut · 30 min&rdquo;.
          </p>
        )}
        {services?.map((s) => (
          <ServiceCard key={s._id} slug={slug} service={s} canEdit={canEdit} />
        ))}
      </div>

      {canEdit && (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-faint">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Haircut"
              className={`${inputCls} min-w-0`}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-xs text-faint">
            Minutes
            <input
              required
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-xs text-faint">
            Price ($)
            <input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="—"
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !name}
            className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
    </section>
  );
}

function ServiceCard({
  slug,
  service,
  canEdit,
}: {
  slug: string;
  service: Doc<"services">;
  canEdit: boolean;
}) {
  const update = useMutation(api.services.update);
  const remove = useMutation(api.services.remove);
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
    <div
      className={`rounded-xl border border-line px-4 py-3 ${
        service.active ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <input
            defaultValue={service.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== service.name)
                act(() => update({ slug, serviceId: service._id, name: v }));
            }}
            className={`${inputCls} h-9 min-w-0 flex-1 font-medium`}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-bone">
            {service.name}
          </span>
        )}

        <label className="flex items-center gap-1 text-xs text-faint">
          {canEdit ? (
            <input
              type="number"
              min={5}
              step={5}
              defaultValue={service.durationMinutes}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n && n !== service.durationMinutes)
                  act(() =>
                    update({ slug, serviceId: service._id, durationMinutes: n }),
                  );
              }}
              className={`${inputCls} h-9 w-20`}
            />
          ) : (
            <span className="text-bone-dim">{service.durationMinutes}</span>
          )}
          min
        </label>

        <label className="flex items-center gap-1 text-xs text-faint">
          $
          {canEdit ? (
            <input
              type="number"
              min={0}
              step="0.01"
              defaultValue={centsToInput(service.priceCents)}
              placeholder="—"
              onBlur={(e) => {
                const cents = inputToCents(e.target.value);
                if (cents !== (service.priceCents ?? null))
                  act(() =>
                    update({
                      slug,
                      serviceId: service._id,
                      priceCents: cents,
                    }),
                  );
              }}
              className={`${inputCls} h-9 w-24`}
            />
          ) : (
            <span className="text-bone-dim">{fmtPrice(service.priceCents)}</span>
          )}
        </label>

        {canEdit && (
          <>
            <button
              onClick={() =>
                act(() =>
                  update({
                    slug,
                    serviceId: service._id,
                    active: !service.active,
                  }),
                )
              }
              className="text-xs text-muted transition-colors hover:text-bone"
            >
              {service.active ? "Active" : "Hidden"}
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Remove service?",
                  message: `"${service.name}" will be removed from the menu.`,
                  confirmLabel: "Remove",
                  destructive: true,
                });
                if (ok) act(() => remove({ slug, serviceId: service._id }));
              }}
              className="text-xs text-muted transition-colors hover:text-ember-deep"
            >
              Remove
            </button>
          </>
        )}
      </div>

      {service.description && (
        <p className="mt-2 text-xs text-faint">{service.description}</p>
      )}
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      {dialog}
    </div>
  );
}
