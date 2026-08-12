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
          Members sign in and manage {b.name}. Owners and admins can add
          teammates and set their roles.
        </p>
        {!canEdit && (
          <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
            View-only — ask an owner or admin to make changes.
          </p>
        )}
      </div>

      <Members slug={b.slug} canEdit={canEdit} callerRole={b.role} />
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
  const addMember = useMutation(api.team.addMember);
  const updateRole = useMutation(api.team.updateMemberRole);
  const removeMember = useMutation(api.team.removeMember);

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
                  {m.isSelf && (
                    <span className="ml-2 text-xs text-faint">(you)</span>
                  )}
                </p>
                {m.name && (
                  <p className="truncate font-mono text-xs text-faint">
                    {m.email}
                  </p>
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
