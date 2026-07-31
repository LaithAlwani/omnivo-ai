"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";
import { EmailDomainCard } from "@/components/dashboard/email-domain-card";

type Branding = {
  primaryColor: string;
  accentColor: string;
  position: "left" | "right";
  assistantName: string;
  welcomeMsg: string;
  tone: string;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm text-bone-dim">{label}</span>
      {hint && <span className="ml-2 text-xs text-faint">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

export default function BrandingPage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const updateBranding = useMutation(api.businesses.updateBranding);

  const [form, setForm] = useState<Branding>({
    primaryColor: b.branding.primaryColor,
    accentColor: b.branding.accentColor,
    position: b.branding.position,
    assistantName: b.branding.assistantName,
    welcomeMsg: b.branding.welcomeMsg,
    tone: b.branding.tone,
  });
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Branding>(key: K, value: Branding[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function onSave() {
    setError(null);
    setPending(true);
    try {
      await updateBranding({ slug: b.slug, branding: form });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl text-bone">Branding</h1>
      <p className="mt-1 text-sm text-muted">
        How your assistant looks and introduces itself on your site.
      </p>

      {!canEdit && (
        <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
          You have view-only access — ask an owner or admin to change branding.
        </p>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Editor */}
        <fieldset disabled={!canEdit || pending} className="space-y-5">
          <Field label="Assistant name">
            <input
              className={inputCls}
              value={form.assistantName}
              onChange={(e) => set("assistantName", e.target.value)}
              placeholder="Assistant"
            />
          </Field>

          <Field label="Welcome message" hint="first thing visitors see">
            <textarea
              className={`${inputCls} h-auto py-2.5`}
              rows={2}
              value={form.welcomeMsg}
              onChange={(e) => set("welcomeMsg", e.target.value)}
              placeholder="Hi! How can I help you today?"
            />
          </Field>

          <Field label="Tone" hint="guides how the assistant writes">
            <input
              className={inputCls}
              value={form.tone}
              onChange={(e) => set("tone", e.target.value)}
              placeholder="friendly, concise, professional"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value)}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line-strong"
                />
                <input
                  className={inputCls}
                  value={form.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value)}
                />
              </div>
            </Field>
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line-strong"
                />
                <input
                  className={inputCls}
                  value={form.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                />
              </div>
            </Field>
          </div>

          <Field label="Bubble position">
            <div className="inline-flex rounded-lg border border-line-strong p-1">
              {(["left", "right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => set("position", pos)}
                  className={`rounded-md px-4 py-1.5 text-sm capitalize transition-colors ${
                    form.position === pos
                      ? "bg-ember text-[#160b04]"
                      : "text-bone-dim hover:text-bone"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </Field>

          {canEdit && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={onSave}
                disabled={pending}
                className="h-11 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
              {saved && <span className="text-sm text-flare">Saved ✓</span>}
              {error && <span className="text-sm text-ember-deep">{error}</span>}
            </div>
          )}
        </fieldset>

        {/* Live preview */}
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-faint">
            Live preview
          </p>
          <WidgetPreview branding={form} />
        </div>
      </div>

      <EmailDomainCard />

      {/* Deleting is irreversible and owner-only. */}
      {b.role === "owner" && <DangerZone slug={b.slug} name={b.name} />}
    </div>
  );
}

function DangerZone({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const deleteBusiness = useMutation(api.businesses.deleteBusiness);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    setPending(true);
    try {
      await deleteBusiness({ slug });
      router.push("/dashboard");
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <div className="mt-14 rounded-xl border border-ember-deep/40 bg-ember-deep/[0.06] p-6">
      <h2 className="font-display text-xl text-bone">Danger zone</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
        Permanently delete <span className="text-bone">{name}</span> and
        everything in it — team members, bookings, leads, services, knowledge,
        integrations, calendars, and all history. Other members lose access and
        the embedded assistant stops working. This cannot be undone.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 h-10 rounded-full border border-ember-deep/60 px-5 text-sm text-ember-deep transition-colors hover:bg-ember-deep hover:text-bone"
        >
          Delete this business
        </button>
      ) : (
        <div className="mt-5">
          <label className="block text-sm text-bone-dim">
            Type <span className="font-mono text-bone">{name}</span> to confirm
          </label>
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={name}
            className="mt-2 h-11 w-full max-w-sm rounded-lg border border-line-strong bg-surface px-4 text-sm text-bone placeholder:text-faint focus-visible:border-ember-deep focus-visible:outline-none"
          />
          {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={onDelete}
              disabled={pending || confirmText !== name}
              className="h-10 rounded-full bg-ember-deep px-5 text-sm font-medium text-bone transition-colors hover:bg-ember disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setConfirmText("");
                setError(null);
              }}
              className="h-10 rounded-full px-4 text-sm text-muted transition-colors hover:text-bone"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetPreview({ branding }: { branding: Branding }) {
  const alignment = branding.position === "right" ? "items-end" : "items-start";
  return (
    <div className="mt-3 flex min-h-[22rem] flex-col justify-end gap-3 overflow-hidden rounded-xl border border-line bg-[#0a0806] bg-grid p-5">
      <div className={`flex flex-col gap-3 ${alignment}`}>
        {/* Chat panel */}
        <div className="w-full max-w-[17rem] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-xl">
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ background: branding.primaryColor }}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 text-xs font-semibold text-white">
              {(branding.assistantName || "A").charAt(0).toUpperCase()}
            </span>
            <span className="text-sm font-medium text-white">
              {branding.assistantName || "Assistant"}
            </span>
          </div>
          <div className="px-4 py-4">
            <div
              className="max-w-[85%] rounded-2xl rounded-bl-md px-3 py-2 text-sm text-white"
              style={{
                background: `color-mix(in srgb, ${branding.accentColor} 22%, transparent)`,
                border: `1px solid color-mix(in srgb, ${branding.accentColor} 45%, transparent)`,
              }}
            >
              {branding.welcomeMsg || "Hi! How can I help you today?"}
            </div>
          </div>
        </div>
        {/* Bubble */}
        <span
          className="grid h-14 w-14 place-items-center rounded-full shadow-lg"
          style={{ background: branding.primaryColor }}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
