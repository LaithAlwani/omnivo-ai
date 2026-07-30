"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";
import { SlotPicker } from "@/components/dashboard/slot-picker";
import { useConfirm } from "@/components/ui/confirm";
import { ModuleGate } from "@/components/dashboard/module-gate";

const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

type RescheduleTarget = {
  bookingId: Id<"bookings">;
  staffId: Id<"staff">;
  serviceId: Id<"services"> | null;
};

export default function BookingsPage() {
  return (
    <ModuleGate module="booking">
      <BookingsInner />
    </ModuleGate>
  );
}

function BookingsInner() {
  const b = useBusiness();
  const staff = useQuery(api.staff.list, { slug: b.slug });
  const services = useQuery(api.services.list, { slug: b.slug });
  const book = useAction(api.bookings.book);
  const cancel = useMutation(api.bookings.cancel);
  const { confirm, dialog } = useConfirm();
  const [nowMs] = useState(() => Date.now());
  const upcoming = useQuery(api.bookings.listUpcoming, {
    slug: b.slug,
    fromMs: nowMs,
  });

  const bookable = staff?.filter((s) => s.bookable && s.active) ?? [];
  const activeServices = services?.filter((s) => s.active) ?? [];

  const [staffSel, setStaffSel] = useState<"any" | Id<"staff">>("any");
  const [serviceSel, setServiceSel] = useState<"" | Id<"services">>("");
  const [slot, setSlot] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<RescheduleTarget | null>(null);

  async function onBook() {
    if (slot == null || !name || !email) return;
    setError(null);
    setPending(true);
    setDone(null);
    try {
      const res = await book({
        slug: b.slug,
        staffId: staffSel,
        start: slot,
        serviceId: serviceSel || undefined,
        customerName: name,
        customerEmail: email,
        customerPhone: phone || undefined,
      });
      const who = staff?.find((s) => s._id === res.staffId)?.name ?? "staff";
      setDone(`Booked ${who} for ${fmtDay(res.start)} at ${fmtTime(res.start)}.`);
      setSlot(null);
      setName("");
      setEmail("");
      setPhone("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function onCancel(bookingId: Id<"bookings">, label: string) {
    const ok = await confirm({
      title: "Cancel booking?",
      message: `${label} will be cancelled. The customer should be notified.`,
      confirmLabel: "Cancel booking",
      destructive: true,
    });
    if (ok) {
      try {
        await cancel({ slug: b.slug, bookingId });
      } catch (err) {
        setError(errorText(err));
      }
    }
  }

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-3xl text-bone">Bookings</h1>
      <p className="mt-1 text-sm text-muted">
        {isManagerRole(b.role)
          ? "All appointments across your team."
          : "Your appointments."}{" "}
        Times shown in your local timezone.
      </p>

      {/* New booking (with the wider date picker) takes two-thirds; Upcoming
          takes the last third on desktop. Stacks on mobile. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* New booking */}
        <div className="min-w-0 rounded-xl border border-line bg-surface/40 p-6">
          <h2 className="text-lg text-bone">New booking</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {activeServices.length > 0 && (
              <label className="block text-sm text-bone-dim">
                Service
                <select
                  value={serviceSel}
                  onChange={(e) => {
                    setServiceSel(e.target.value as "" | Id<"services">);
                    setSlot(null);
                  }}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">Any / unspecified</option>
                  {activeServices.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name} · {s.durationMinutes}m
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm text-bone-dim">
              Staff
              <select
                value={staffSel}
                onChange={(e) => {
                  setStaffSel(e.target.value as "any" | Id<"staff">);
                  setSlot(null);
                }}
                className={`${inputCls} mt-1`}
              >
                <option value="any">Any available</option>
                {bookable.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5">
            <p className="text-sm text-bone-dim">Pick a day</p>
            <div className="mt-2">
              <SlotPicker
                slug={b.slug}
                staffId={staffSel}
                serviceId={serviceSel || undefined}
                selected={slot}
                onSelect={setSlot}
              />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
              <input
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
              />
            </div>
          </div>

          <button
            onClick={onBook}
            disabled={pending || slot == null || !name || !email}
            className="mt-5 h-11 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-50"
          >
            {pending ? "Booking…" : "Book appointment"}
          </button>
          {done && <p className="mt-3 text-sm text-flare">{done}</p>}
          {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
        </div>

        {/* Upcoming */}
        <div>
          <h2 className="text-lg text-bone">Upcoming</h2>
          <div className="mt-4 divide-y divide-line rounded-xl border border-line">
            {upcoming === undefined && (
              <p className="px-4 py-4 text-sm text-faint">Loading…</p>
            )}
            {upcoming?.length === 0 && (
              <p className="px-4 py-4 text-sm text-faint">No upcoming bookings.</p>
            )}
            {upcoming?.map((bk) => (
              <div key={bk._id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm text-bone">{bk.customerName}</p>
                  <p className="font-mono text-xs text-faint">
                    {fmtDay(bk.start)} · {fmtTime(bk.start)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  with {bk.staffName} · {bk.customerEmail}
                </p>
                <div className="mt-2 flex gap-4">
                  <button
                    onClick={() =>
                      setReschedule({
                        bookingId: bk._id,
                        staffId: bk.staffId,
                        serviceId: bk.serviceId,
                      })
                    }
                    className="text-xs text-muted transition-colors hover:text-bone"
                  >
                    Reschedule
                  </button>
                  <button
                    onClick={() =>
                      onCancel(
                        bk._id,
                        `${bk.customerName}'s booking on ${fmtDay(bk.start)}`,
                      )
                    }
                    className="text-xs text-muted transition-colors hover:text-ember-deep"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {reschedule && (
        <RescheduleModal
          slug={b.slug}
          target={reschedule}
          onClose={() => setReschedule(null)}
        />
      )}
      {dialog}
    </div>
  );
}

function RescheduleModal({
  slug,
  target,
  onClose,
}: {
  slug: string;
  target: RescheduleTarget;
  onClose: () => void;
}) {
  const reschedule = useMutation(api.bookings.reschedule);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(start: number) {
    setError(null);
    setPending(true);
    try {
      await reschedule({ slug, bookingId: target.bookingId, newStart: start });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl border border-line-strong bg-surface p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-bone">Reschedule</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center text-muted hover:text-bone"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Pick a new time for the same staff member.
        </p>
        <div className={`mt-4 ${pending ? "pointer-events-none opacity-60" : ""}`}>
          <SlotPicker
            slug={slug}
            staffId={target.staffId}
            serviceId={target.serviceId ?? undefined}
            selected={null}
            onSelect={pick}
          />
        </div>
        {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}
      </div>
    </div>
  );
}
