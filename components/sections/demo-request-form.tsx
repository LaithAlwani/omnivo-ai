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

const fieldClass =
  "h-12 w-full rounded-full border border-line-strong bg-surface px-5 text-sm text-bone placeholder:text-faint focus-visible:border-ember focus-visible:outline-none aria-[invalid=true]:border-ember-deep";

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
      <div
        role="status"
        className="mx-auto mt-10 max-w-md rounded-2xl border border-ember/25 bg-ember-soft px-6 py-8 text-center"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-ember text-[#160b04]">
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-xl text-bone">Request received</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Thanks, {fields.name.trim() || "there"} — we sent a copy to{" "}
          <span className="text-bone">{fields.email.trim()}</span>. We&rsquo;ll reply
          within one business day.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto mt-10 flex max-w-md flex-col gap-4 text-left"
    >
      <Field label="Name" required error={errors.name}>
        <input
          type="text"
          autoComplete="name"
          placeholder="Jane Doe"
          value={fields.name}
          onChange={(e) => update("name", e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          className={fieldClass}
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
          className={fieldClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" optional>
          <input
            type="tel"
            autoComplete="tel"
            placeholder="Optional"
            value={fields.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={fieldClass}
          />
        </Field>
        <Field label="Subject" optional>
          <input
            type="text"
            placeholder="Optional"
            value={fields.subject}
            onChange={(e) => update("subject", e.target.value)}
            className={fieldClass}
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
          className="w-full rounded-2xl border border-line-strong bg-surface px-5 py-3.5 text-sm leading-relaxed text-bone placeholder:text-faint focus-visible:border-ember focus-visible:outline-none aria-[invalid=true]:border-ember-deep"
        />
      </Field>

      {formError && (
        <p role="alert" className="text-sm text-ember-deep">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-13 w-full items-center justify-center rounded-full bg-ember px-7 font-medium text-[#160b04] shadow-[0_8px_30px_-8px_rgba(255,92,26,0.6)] transition-all hover:bg-flare disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request a demo"}
      </button>
    </form>
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
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-bone-dim">
        {label}
        {required && <span className="text-ember">*</span>}
        {optional && <span className="font-mono text-[0.7rem] text-faint">optional</span>}
      </span>
      {children}
      {error && (
        <span className="px-1 text-xs text-ember-deep">{error}</span>
      )}
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
