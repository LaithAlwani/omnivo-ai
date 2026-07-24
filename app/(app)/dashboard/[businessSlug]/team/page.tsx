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

const ROLES = ["owner", "admin", "staff"] as const;
type Role = (typeof ROLES)[number];

const inputCls =
  "h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

export default function TeamPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);

  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="font-display text-3xl text-bone">Team</h1>
        <p className="mt-1 text-sm text-muted">
          Members sign in and manage {b.name}. Staff are bookable calendars and
          don&rsquo;t need a login — but link a member to one so that person
          self-manages their own availability and calendar.
        </p>
        {!canEdit && (
          <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
            View-only — ask an owner or admin to make changes.
          </p>
        )}
      </div>

      <Members slug={b.slug} canEdit={canEdit} callerRole={b.role} />
      <Staff slug={b.slug} canEdit={canEdit} />
    </div>
  );
}

function Members({
  slug,
  canEdit,
  callerRole,
}: {
  slug: string;
  canEdit: boolean;
  callerRole: Role;
}) {
  const isOwner = callerRole === "owner";
  // An admin can assign admin/staff, but only an owner can grant/manage owner.
  const assignableRoles = isOwner ? ROLES : (["admin", "staff"] as const);
  const members = useQuery(api.team.listMembers, { slug });
  const staff = useQuery(api.staff.list, { slug });
  const addMember = useMutation(api.team.addMember);
  const updateRole = useMutation(api.team.updateMemberRole);
  const removeMember = useMutation(api.team.removeMember);
  const linkStaff = useMutation(api.team.linkStaff);

  const { confirm, dialog } = useConfirm();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addMember({ slug, email, role });
      setEmail("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2 className="text-lg text-bone">Members</h2>

      <div className="mt-4 divide-y divide-line rounded-xl border border-line">
        {members === undefined && (
          <p className="px-4 py-4 text-sm text-faint">Loading…</p>
        )}
        {members?.map((m) => {
          // Owners can only be managed by another owner.
          const editable = canEdit && (m.role !== "owner" || isOwner);
          return (
          <div
            key={m.membershipId}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-bone">
                {m.name ?? m.email}
                {m.isSelf && <span className="ml-2 text-xs text-faint">(you)</span>}
              </p>
              {m.name && (
                <p className="truncate font-mono text-xs text-faint">{m.email}</p>
              )}
              {canEdit && (
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-faint">
                  Calendar
                  <select
                    value={m.linkedStaffId ?? "none"}
                    onChange={(e) =>
                      act(() =>
                        linkStaff({
                          slug,
                          membershipId: m.membershipId as Id<"memberships">,
                          target:
                            e.target.value === "none" || e.target.value === "create"
                              ? (e.target.value as "none" | "create")
                              : (e.target.value as Id<"staff">),
                        }),
                      )
                    }
                    className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-xs text-bone-dim focus-visible:border-ember"
                  >
                    <option value="none">Not linked</option>
                    {staff
                      ?.filter((s) => !s.userId || s._id === m.linkedStaffId)
                      .map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name}
                        </option>
                      ))}
                    <option value="create">＋ Create calendar</option>
                  </select>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editable ? (
                <select
                  value={m.role}
                  onChange={(e) =>
                    act(() =>
                      updateRole({
                        slug,
                        membershipId: m.membershipId as Id<"memberships">,
                        role: e.target.value as Role,
                      }),
                    )
                  }
                  className={`${inputCls} capitalize`}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r} className="capitalize">
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-full border border-line-strong px-3 py-1 font-mono text-xs uppercase tracking-wider text-bone-dim">
                  {m.role}
                </span>
              )}
              {editable && !m.isSelf && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Remove member?",
                      message: `${m.name ?? m.email} will lose access to this business.`,
                      confirmLabel: "Remove",
                      destructive: true,
                    });
                    if (ok)
                      act(() =>
                        removeMember({
                          slug,
                          membershipId: m.membershipId as Id<"memberships">,
                        }),
                      );
                  }}
                  className="text-xs text-muted transition-colors hover:text-ember-deep"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      {canEdit && (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@email.com"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={`${inputCls} capitalize`}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r} className="capitalize">
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending || !email}
            className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
      {dialog}
    </section>
  );
}

function Staff({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const staff = useQuery(api.staff.list, { slug });
  const addStaff = useMutation(api.staff.add);
  const updateStaff = useMutation(api.staff.update);
  const removeStaff = useMutation(api.staff.remove);

  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [bookable, setBookable] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addStaff({ slug, name, title: title || undefined, bookable });
      setName("");
      setTitle("");
      setBookable(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2 className="text-lg text-bone">Staff &amp; calendars</h2>
      <p className="mt-1 text-sm text-muted">
        Bookable people or resources. Leave the link blank to use internal slots
        (with an optional Google/Outlook calendar on the Schedule page), or paste
        a Calendly-style link to hand booking off to it.
      </p>

      <div className="mt-4 divide-y divide-line rounded-xl border border-line">
        {staff === undefined && (
          <p className="px-4 py-4 text-sm text-faint">Loading…</p>
        )}
        {staff?.length === 0 && (
          <p className="px-4 py-4 text-sm text-faint">No staff yet.</p>
        )}
        {staff?.map((s) => (
          <div key={s._id} className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-bone">
                {s.name}
                {!s.active && (
                  <span className="ml-2 text-xs text-faint">(inactive)</span>
                )}
                {s.userId && (
                  <span className="ml-2 rounded-full border border-line-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-bone-dim">
                    Login
                  </span>
                )}
                {s.externalBookingUrl && (
                  <span className="ml-1.5 rounded-full border border-ember/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ember">
                    External
                  </span>
                )}
              </p>
              {s.title && (
                <p className="truncate text-xs text-faint">{s.title}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                label="Bookable"
                on={s.bookable}
                disabled={!canEdit || !!s.externalBookingUrl}
                onClick={() =>
                  act(() =>
                    updateStaff({ slug, staffId: s._id, bookable: !s.bookable }),
                  )
                }
              />
              {canEdit && (
                <>
                  <button
                    onClick={() =>
                      act(() =>
                        updateStaff({ slug, staffId: s._id, active: !s.active }),
                      )
                    }
                    className="text-xs text-muted transition-colors hover:text-bone"
                  >
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Remove staff?",
                        message: `${s.name} and their calendar will be permanently deleted.`,
                        confirmLabel: "Remove",
                        destructive: true,
                      });
                      if (ok) act(() => removeStaff({ slug, staffId: s._id }));
                    }}
                    className="text-xs text-muted transition-colors hover:text-ember-deep"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-xs text-faint">Calendly / link</span>
              <input
                type="url"
                defaultValue={s.externalBookingUrl ?? ""}
                placeholder="https://calendly.com/you — leave blank for internal booking"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === (s.externalBookingUrl ?? "")) return;
                  act(() =>
                    updateStaff({
                      slug,
                      staffId: s._id,
                      externalBookingUrl: next,
                    }),
                  );
                }}
                className={`${inputCls} h-8 min-w-0 flex-1 text-xs`}
              />
            </div>
          )}
          </div>
        ))}
      </div>

      {canEdit && (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-center gap-2">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Sam, or Chair 2)"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <label className="flex items-center gap-2 text-sm text-bone-dim">
            <input
              type="checkbox"
              checked={bookable}
              onChange={(e) => setBookable(e.target.checked)}
              className="h-4 w-4 accent-ember"
            />
            Bookable
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
      {dialog}
    </section>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 disabled:opacity-60"
      title={label}
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          on ? "bg-ember" : "bg-surface-2 border border-line-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-bone transition-transform ${
            on ? "left-0.5 translate-x-4" : "left-0.5"
          }`}
        />
      </span>
      <span className="text-xs text-faint">{label}</span>
    </button>
  );
}
