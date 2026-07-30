"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import { useConfirm } from "@/components/ui/confirm";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

export default function LocationsPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const locations = useQuery(api.locations.list, { slug: b.slug });
  const account = useQuery(api.accounts.myAccount, {});

  const addLocation = useMutation(api.locations.add);
  const updateLocation = useMutation(api.locations.update);
  const removeLocation = useMutation(api.locations.remove);

  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = account?.locationLimitPerProject ?? null;
  const activeCount = locations?.filter((l) => l.active).length ?? 0;
  const atLimit = limit !== null && activeCount >= limit;

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addLocation({
        slug: b.slug,
        name,
        address: address || undefined,
        timezone: timezone || undefined,
        phone: phone || undefined,
      });
      setName("");
      setAddress("");
      setTimezone("");
      setPhone("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">Locations</h1>
      <p className="mt-1 text-sm text-muted">
        Bookable sites within {b.name}. Team members and bookings are scoped to a
        location, so the assistant books at the right one.
        {limit !== null && (
          <>
            {" "}
            Your plan includes{" "}
            <span className="text-bone-dim">
              {limit} location{limit === 1 ? "" : "s"}
            </span>{" "}
            per project.
          </>
        )}
      </p>
      {!canEdit && (
        <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
          View-only — ask an owner or admin to make changes.
        </p>
      )}

      <div className="mt-6 divide-y divide-line rounded-xl border border-line">
        {locations === undefined && (
          <p className="px-4 py-4 text-sm text-faint">Loading…</p>
        )}
        {locations?.map((l) => (
          <div key={l._id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-bone">
                  {l.name}
                  {!l.active && (
                    <span className="ml-2 text-xs text-faint">(inactive)</span>
                  )}
                </p>
                {l.address && (
                  <p className="truncate text-xs text-faint">{l.address}</p>
                )}
                <p className="mt-0.5 font-mono text-[11px] text-faint">
                  {l.timezone ?? "no timezone"}
                  {l.phone ? ` · ${l.phone}` : ""}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      act(() =>
                        updateLocation({
                          slug: b.slug,
                          locationId: l._id,
                          active: !l.active,
                        }),
                      )
                    }
                    className="text-xs text-muted transition-colors hover:text-bone"
                  >
                    {l.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Remove location?",
                        message: `${l.name} will be permanently deleted.`,
                        confirmLabel: "Remove",
                        destructive: true,
                      });
                      if (ok)
                        act(() =>
                          removeLocation({ slug: b.slug, locationId: l._id }),
                        );
                    }}
                    className="text-xs text-muted transition-colors hover:text-ember-deep"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            {canEdit && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  defaultValue={l.name}
                  placeholder="Name"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (!next || next === l.name) return;
                    act(() =>
                      updateLocation({
                        slug: b.slug,
                        locationId: l._id,
                        name: next,
                      }),
                    );
                  }}
                  className={`${inputCls} h-8 text-xs`}
                />
                <input
                  defaultValue={l.address ?? ""}
                  placeholder="Address"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next === (l.address ?? "")) return;
                    act(() =>
                      updateLocation({
                        slug: b.slug,
                        locationId: l._id,
                        address: next,
                      }),
                    );
                  }}
                  className={`${inputCls} h-8 text-xs`}
                />
                <input
                  defaultValue={l.timezone ?? ""}
                  placeholder="Timezone (e.g. America/Toronto)"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next === (l.timezone ?? "")) return;
                    act(() =>
                      updateLocation({
                        slug: b.slug,
                        locationId: l._id,
                        timezone: next,
                      }),
                    );
                  }}
                  className={`${inputCls} h-8 text-xs`}
                />
                <input
                  defaultValue={l.phone ?? ""}
                  placeholder="Phone"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next === (l.phone ?? "")) return;
                    act(() =>
                      updateLocation({
                        slug: b.slug,
                        locationId: l._id,
                        phone: next,
                      }),
                    );
                  }}
                  className={`${inputCls} h-8 text-xs`}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <>
          <form onSubmit={onAdd} className="mt-4 grid gap-2 sm:grid-cols-2">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. Downtown)"
              className={inputCls}
              disabled={atLimit}
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address (optional)"
              className={inputCls}
              disabled={atLimit}
            />
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Timezone (e.g. America/Toronto)"
              className={inputCls}
              disabled={atLimit}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className={inputCls}
              disabled={atLimit}
            />
            <button
              type="submit"
              disabled={pending || !name || atLimit}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
            >
              {pending ? "Adding…" : "Add location"}
            </button>
          </form>
          {atLimit && (
            <p className="mt-2 text-sm text-muted">
              You&rsquo;ve reached your plan&rsquo;s location limit.{" "}
              <a
                href="https://omnivoai.ca/#pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ember underline hover:text-flare"
              >
                Upgrade
              </a>{" "}
              to add more.
            </p>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      {dialog}
    </div>
  );
}
