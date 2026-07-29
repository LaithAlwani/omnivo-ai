"use client";

import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

const inputCls =
  "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

type SenderView = {
  fromName: string;
  fromEmail: string;
  host: string;
  port: number;
  username: string;
  verified: boolean;
  lastTestedAt: number | null;
} | null;

export function EmailSenderCard() {
  const b = useBusiness();
  const proPlus = b.tier !== "starter";
  const sender = useQuery(api.emailSender.getSender, { slug: b.slug });

  return (
    <div className="mt-10 rounded-xl border border-line bg-surface/40 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-bone">
            Custom email domain
          </h2>
          <p className="mt-1 text-sm text-muted">
            Send booking emails from your own domain via your SMTP.
          </p>
        </div>
        {sender && (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider ${
              sender.verified
                ? "border-emerald-500/40 text-emerald-400"
                : "border-flare/40 text-flare"
            }`}
          >
            {sender.verified ? "Verified" : "Not tested"}
          </span>
        )}
      </div>

      {!proPlus ? (
        <div className="mt-4 rounded-lg border border-ember/40 bg-ember-soft px-4 py-3 text-sm text-bone">
          A custom sending domain is available on Professional and up.{" "}
          <a
            href="https://omnivoai.ca/#pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ember underline hover:text-flare"
          >
            See plans
          </a>
        </div>
      ) : sender === undefined ? (
        <p className="mt-4 text-sm text-faint">Loading…</p>
      ) : (
        <SenderForm key={sender ? "has" : "none"} initial={sender} />
      )}
    </div>
  );
}

function SenderForm({ initial }: { initial: SenderView }) {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const save = useAction(api.emailNode.saveSender);
  const test = useAction(api.emailNode.sendTest);
  const remove = useMutation(api.emailSender.removeSender);

  const [form, setForm] = useState({
    fromName: initial?.fromName ?? b.name,
    fromEmail: initial?.fromEmail ?? "",
    host: initial?.host ?? "",
    port: initial?.port ?? 587,
    username: initial?.username ?? "",
    password: "",
  });
  const [testTo, setTestTo] = useState(initial?.fromEmail ?? "");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: val }));
    setMsg(null);
  }

  async function onSave() {
    setError(null);
    setMsg(null);
    setBusy("save");
    try {
      await save({ slug: b.slug, ...form });
      setMsg("Saved — send a test to verify.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setError(null);
    setMsg(null);
    setBusy("test");
    try {
      await test({ slug: b.slug, to: testTo });
      setMsg(`Test email sent to ${testTo}. Check the inbox.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy("remove");
    try {
      await remove({ slug: b.slug });
      setForm({
        fromName: b.name,
        fromEmail: "",
        host: "",
        port: 587,
        username: "",
        password: "",
      });
      setMsg("Removed — emails now send from the Omnivo address.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit) {
    return (
      <p className="mt-4 text-sm text-muted">
        {initial
          ? `Sending from ${initial.fromEmail}${initial.verified ? "" : " (not verified)"}.`
          : "No custom domain set."}{" "}
        Ask an owner or admin to change this.
      </p>
    );
  }

  return (
    <fieldset disabled={busy !== null} className="mt-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-bone-dim">From name</span>
          <input
            className={`${inputCls} mt-1.5`}
            value={form.fromName}
            onChange={(e) => set("fromName", e.target.value)}
            placeholder={b.name}
          />
        </label>
        <label className="block">
          <span className="text-sm text-bone-dim">From email</span>
          <input
            className={`${inputCls} mt-1.5`}
            value={form.fromEmail}
            onChange={(e) => set("fromEmail", e.target.value)}
            placeholder="bookings@yourdomain.com"
          />
        </label>
        <label className="block">
          <span className="text-sm text-bone-dim">SMTP host</span>
          <input
            className={`${inputCls} mt-1.5`}
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="smtp.yourprovider.com"
          />
        </label>
        <label className="block">
          <span className="text-sm text-bone-dim">Port</span>
          <input
            type="number"
            className={`${inputCls} mt-1.5`}
            value={form.port}
            onChange={(e) => set("port", Number(e.target.value))}
            placeholder="587"
          />
        </label>
        <label className="block">
          <span className="text-sm text-bone-dim">SMTP username</span>
          <input
            className={`${inputCls} mt-1.5`}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder="apikey / user@domain"
          />
        </label>
        <label className="block">
          <span className="text-sm text-bone-dim">SMTP password</span>
          <input
            type="password"
            className={`${inputCls} mt-1.5`}
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={initial ? "•••••• (re-enter to change)" : "••••••"}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onSave}
          disabled={
            busy !== null ||
            !form.fromEmail ||
            !form.host ||
            !form.username ||
            !form.password
          }
          className="h-11 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
        >
          {busy === "save" ? "Saving…" : "Save SMTP"}
        </button>
        {initial && (
          <button
            onClick={onRemove}
            className="h-11 rounded-full border border-line-strong px-5 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone"
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
      </div>

      {/* Test */}
      {initial && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <label className="block flex-1">
            <span className="text-sm text-bone-dim">Send a test to</span>
            <input
              className={`${inputCls} mt-1.5`}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </label>
          <button
            onClick={onTest}
            disabled={busy !== null || !testTo}
            className="h-11 rounded-full border border-line-strong px-5 text-sm text-bone transition-colors hover:border-ember/60 disabled:opacity-60"
          >
            {busy === "test" ? "Sending…" : "Send test"}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-flare">{msg}</p>}
      {error && <p className="text-sm text-ember-deep">{error}</p>}
    </fieldset>
  );
}
