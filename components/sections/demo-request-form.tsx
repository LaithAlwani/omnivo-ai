"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PublicConvexProvider } from "@/components/providers/public-convex-provider";

// The marketing "Book a demo" form. Name + email are required; subject, phone,
// and the message are optional. Everything is validated here for instant
// feedback and again on the server (which is the real gate). On submit it calls
// the tenant-less `demoRequests.submit` action, which emails the team and sends
// the requester a copy.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Fields = {
  name: string;
  email: string;
  subject: string;
  phone: string;
  message: string;
};

type FieldErrors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", email: "", subject: "", phone: "", message: "" };

/** Pull the user-readable message out of a ConvexError ({ code, message }). */
function serverErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data?: unknown }).data;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
  }
  return "Something went wrong sending your request. Please try again.";
}

function validate(f: Fields): FieldErrors {
  const errors: FieldErrors = {};
  if (!f.name.trim()) errors.name = "Please enter your name.";
  else if (f.name.trim().length > 120) errors.name = "That name is too long.";

  if (!f.email.trim()) errors.email = "Please enter your email.";
  else if (!EMAIL_RE.test(f.email.trim()))
    errors.email = "Please enter a valid email address.";

  if (f.message.length > 4000)
    errors.message = "Please keep this under 4000 characters.";

  return errors;
}

const inputClass =
  "h-12 w-full rounded-lg border border-line-strong bg-ink/50 px-4 text-sm text-bone transition-colors placeholder:text-faint focus-visible:border-ember focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-soft aria-[invalid=true]:border-ember-deep aria-[invalid=true]:ring-ember-deep/15";

/** The machined panel the form (and its success state) live inside. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* Ember core — the engine running hot behind the glass */}
      <div
        aria-hidden
        className="glow-ember pointer-events-none absolute -inset-6 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-line-strong bg-surface/80 shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {/* Panel header — the engine readout */}
        <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ember" />
            </span>
            <span className="font-mono text-xs tracking-wide text-bone-dim">
              request · demo
            </span>
          </div>
          <span className="font-mono text-[0.7rem] text-faint">~15 min</span>
        </div>
        <div className="px-6 py-6 sm:px-7 sm:py-7">{children}</div>
      </div>
    </div>
  );
}

function DemoForm() {
  const submit = useAction(api.demoRequests.submit);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  function update<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    // Clear a field's error as soon as the user edits it.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const found = validate(fields);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await submit({
        name: fields.name.trim(),
        email: fields.email.trim(),
        subject: fields.subject.trim() || undefined,
        phone: fields.phone.trim() || undefined,
        message: fields.message.trim() || undefined,
      });
      setSent(true);
    } catch (err) {
      setFormError(serverErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Panel>
        <div className="flex flex-col items-center py-6 text-center">
          <span className="relative flex h-14 w-14 items-center justify-center">
            <span className="glow-ember absolute inset-0 blur-md" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-ember text-[#160b04]">
              <svg viewBox="0 0 16 16" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
          <h2 className="mt-5 font-display text-2xl text-bone">Request received</h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
            Thanks, {fields.name.trim() || "there"} — a copy is on its way to{" "}
            <span className="text-bone">{fields.email.trim()}</span>. We&rsquo;ll reply
            within one business day.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label="Name" required error={errors.name}>
          <input
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            value={fields.name}
            onChange={(e) => update("name", e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            className={inputClass}
          />
        </Field>

        <Field label="Email" required error={errors.email}>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@business.com"
            value={fields.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Phone" optional>
            <input
              type="tel"
              autoComplete="tel"
              placeholder="Optional"
              value={fields.phone}
              onChange={(e) => update("phone", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Subject" optional>
            <input
              type="text"
              placeholder="Optional"
              value={fields.subject}
              onChange={(e) => update("subject", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="What are you looking for?" optional error={errors.message}>
          <textarea
            rows={4}
            placeholder="Tell us about your business and what you'd like the assistant to handle."
            value={fields.message}
            onChange={(e) => update("message", e.target.value)}
            aria-invalid={errors.message ? true : undefined}
            className="w-full resize-none rounded-lg border border-line-strong bg-ink/50 px-4 py-3 text-sm leading-relaxed text-bone transition-colors placeholder:text-faint focus-visible:border-ember focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-soft aria-[invalid=true]:border-ember-deep aria-[invalid=true]:ring-ember-deep/15"
          />
        </Field>

        {formError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-ember-deep/30 bg-ember-deep/10 px-3.5 py-2.5 text-sm text-bone-dim"
          >
            <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 flex-none text-ember-deep" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="6.25" />
              <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
            </svg>
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="group mt-1 inline-flex h-13 w-full items-center justify-center gap-2 rounded-full bg-ember px-7 font-medium text-[#160b04] shadow-[0_8px_30px_-8px_rgba(255,92,26,0.6)] transition-all hover:bg-flare hover:shadow-[0_10px_36px_-6px_rgba(255,179,71,0.7)] disabled:opacity-60"
        >
          {pending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#160b04]/30 border-t-[#160b04]" />
              Sending…
            </>
          ) : (
            <>
              Request a demo
              <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>

        <p className="text-center font-mono text-xs text-faint">
          We&rsquo;ll reply within one business day.
        </p>
      </form>
    </Panel>
  );
}

function Field({
  label,
  required,
  optional,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between px-0.5 text-xs font-medium text-bone-dim">
        <span className="flex items-center gap-1.5">
          {label}
          {required && <span className="text-ember">*</span>}
        </span>
        {optional && (
          <span className="font-mono text-[0.68rem] uppercase tracking-wider text-faint">
            optional
          </span>
        )}
      </span>
      {children}
      {error && <span className="px-0.5 text-xs text-ember-deep">{error}</span>}
    </label>
  );
}

export function DemoRequestForm() {
  // The marketing layout has no Convex provider (the site is otherwise static),
  // so this form brings its own no-auth public client.
  return (
    <PublicConvexProvider>
      <DemoForm />
    </PublicConvexProvider>
  );
}
