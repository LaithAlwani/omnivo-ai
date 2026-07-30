"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  MODULE_CATALOG,
  type Entitlements,
  type ModuleKey,
} from "@/convex/modules/registry";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

export default function ModulesPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const entitlements = useQuery(api.entitlements.get, { slug: b.slug });
  const setModule = useMutation(api.entitlements.setModule);

  const [busy, setBusy] = useState<ModuleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: ModuleKey, enabled: boolean) {
    setError(null);
    setBusy(key);
    try {
      await setModule({ slug: b.slug, module: key, enabled });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const isOn = (key: ModuleKey) =>
    entitlements ? entitlements[`${key}Enabled` as keyof Entitlements] : false;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl text-bone">Modules</h1>
      <p className="mt-1 text-sm text-muted">
        Your AI Employee gains skills as you switch on modules. Each adds its own
        tools and workflows to the same assistant — customers still hire one
        employee, not many.
      </p>
      {!canEdit && (
        <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
          View-only — ask an owner or admin to change modules.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-ember-deep">{error}</p>}

      <div className="mt-6 space-y-3">
        {MODULE_CATALOG.map((m) => {
          const on = isOn(m.key);
          return (
            <div
              key={m.key}
              className={`rounded-xl border p-5 transition-colors ${
                on ? "border-ember/40 bg-ember-soft/40" : "border-line bg-surface/40"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-lg text-bone">{m.name}</h2>
                    <span className="font-mono text-xs text-faint">
                      +${m.price}/mo
                    </span>
                    {on && (
                      <span className="rounded-full border border-ember/40 bg-ember-soft px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-ember">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-bone-dim">{m.blurb}</p>
                  <p className="mt-1 text-xs text-faint">{m.grants}</p>
                </div>
                <button
                  type="button"
                  disabled={!canEdit || busy === m.key}
                  onClick={() => toggle(m.key, !on)}
                  aria-pressed={on}
                  title={on ? "Disable" : "Enable"}
                  className="mt-1 shrink-0 disabled:opacity-50"
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
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-faint">
        Billing for modules is handled with your subscription. Toggling here
        changes what your assistant can do right away.
      </p>
    </div>
  );
}
