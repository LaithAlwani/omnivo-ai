"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import { Logo } from "@/components/layout/logo";

// The create-a-business onboarding wizard. Three quick steps that pre-configure
// the assistant so it can answer from the moment it goes live:
//   1. Business — name + url + what you do
//   2. Knowledge — services + hours (so the bot can answer)
//   3. Assistant — name, welcome message, tone
// Everything after step 1 is optional; the goal is the fastest path to a live,
// useful bot. A starter account is capped at one project — over the cap, this
// page shows an upgrade prompt instead of the form.

const STEPS = ["Business", "Knowledge", "Assistant"] as const;

const inputCls =
  "h-11 w-full rounded-lg border border-line-strong bg-surface px-4 text-sm text-bone placeholder:text-faint focus-visible:border-ember focus-visible:outline-none";
const areaCls =
  "w-full rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm leading-relaxed text-bone placeholder:text-faint focus-visible:border-ember focus-visible:outline-none";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

type Service = { name: string; description: string };

export default function CreateBusinessPage() {
  const account = useQuery(api.accounts.myAccount);
  const businesses = useQuery(api.businesses.listMine);
  const createBusiness = useAction(api.businesses.create);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [about, setAbout] = useState("");
  const [hours, setHours] = useState("");
  const [services, setServices] = useState<Service[]>([
    { name: "", description: "" },
  ]);
  const [assistantName, setAssistantName] = useState("Assistant");
  const [welcomeMsg, setWelcomeMsg] = useState(
    "Hi! How can I help you today?",
  );
  const [tone, setTone] = useState("friendly, concise, professional");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; embedKey: string } | null>(
    null,
  );

  const effectiveSlug = slug || slugify(name);
  const step0Valid = name.trim().length > 0 && SLUG_RE.test(effectiveSlug);

  async function onCreate() {
    setError(null);
    setPending(true);
    try {
      const cleanServices = services
        .map((s) => ({
          name: s.name.trim(),
          description: s.description.trim() || undefined,
        }))
        .filter((s) => s.name.length > 0);
      const res = await createBusiness({
        name: name.trim(),
        slug: effectiveSlug,
        profile: {
          assistantName,
          welcomeMsg,
          tone,
          about: about.trim() || undefined,
          hours: hours.trim() || undefined,
          services: cleanServices,
        },
      });
      setResult({ slug: res.slug, embedKey: res.embedKey });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  // --- Gate: loading / over the project limit -------------------------------
  const loadingGate = account === undefined;
  const max = account?.projects.max ?? null;
  const used = account?.projects.used ?? 0;
  const atLimit = max !== null && used >= max;
  const ownedSlug =
    businesses?.find((b) => b.role === "owner")?.slug ?? businesses?.[0]?.slug;

  return (
    <div className="flex min-h-dvh flex-col items-center px-6 py-14 sm:py-20">
      <div className="w-full max-w-xl">
        <Logo />

        {/* Success ------------------------------------------------------- */}
        {result ? (
          <div className="mt-12">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ember text-[#160b04]">
              <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="mt-5 font-display text-3xl text-bone">
              {name.trim()} is live.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Your assistant is set up and ready. Copy your embed key now — for
              security it won’t be shown again (you can rotate it later from the
              dashboard).
            </p>
            <div className="mt-6 rounded-xl border border-ember/40 bg-ember-soft p-5">
              <p className="font-mono text-xs uppercase tracking-wider text-ember">
                Embed key
              </p>
              <code className="mt-2 block break-all font-mono text-sm text-bone">
                {result.embedKey}
              </code>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={`/dashboard/${result.slug}`}
                className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
              >
                Go to {name.trim()} →
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
              >
                All businesses
              </Link>
            </div>
          </div>
        ) : loadingGate ? (
          <p className="mt-12 text-sm text-faint">Loading…</p>
        ) : atLimit ? (
          /* Over the project limit ------------------------------------- */
          <div className="mt-12">
            <span className="eyebrow">Upgrade needed</span>
            <h1 className="mt-4 font-display text-3xl text-bone">
              You’ve used your {max} project{max === 1 ? "" : "s"}.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The {account?.plan} plan includes {max} project
              {max === 1 ? "" : "s"}. Upgrade to Professional to run more
              businesses from one account — usage stays pooled across them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {ownedSlug && (
                <Link
                  href={`/dashboard/${ownedSlug}/usage`}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
                >
                  View plans →
                </Link>
              )}
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        ) : (
          /* Wizard ----------------------------------------------------- */
          <div className="mt-10">
            {/* Progress */}
            <div className="flex items-center gap-2">
              {STEPS.map((label, i) => (
                <div key={label} className="flex flex-1 flex-col gap-1.5">
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      i <= step ? "bg-ember" : "bg-line"
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider ${
                      i === step ? "text-bone-dim" : "text-faint"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-8">
              {step === 0 && (
                <div className="flex flex-col gap-5">
                  <h1 className="font-display text-3xl text-bone">
                    Let’s set up your business.
                  </h1>
                  <Field label="Business name" required>
                    <input
                      autoFocus
                      className={inputCls}
                      value={name}
                      placeholder="Bright Smile Dental"
                      onChange={(e) => {
                        setName(e.target.value);
                        if (!slugTouched) setSlug(slugify(e.target.value));
                      }}
                    />
                  </Field>
                  <Field
                    label="Dashboard URL"
                    hint="Lowercase letters, numbers, and hyphens."
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-faint">/</span>
                      <input
                        className={`${inputCls} font-mono`}
                        value={slug}
                        placeholder={slugify(name) || "your-business"}
                        onChange={(e) => {
                          setSlug(e.target.value);
                          setSlugTouched(true);
                        }}
                      />
                    </div>
                  </Field>
                  <Field label="What does your business do?" optional>
                    <textarea
                      rows={3}
                      className={areaCls}
                      value={about}
                      placeholder="A family dental clinic in Austin offering cleanings, whitening, and Invisalign."
                      onChange={(e) => setAbout(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {step === 1 && (
                <div className="flex flex-col gap-5">
                  <div>
                    <h1 className="font-display text-3xl text-bone">
                      What should it know?
                    </h1>
                    <p className="mt-2 text-sm text-muted">
                      Add a few services and your hours so the assistant can
                      answer real questions. You can refine all of this later.
                    </p>
                  </div>
                  <Field label="Services" optional>
                    <div className="flex flex-col gap-2">
                      {services.map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            className={inputCls}
                            value={s.name}
                            placeholder="Service name"
                            onChange={(e) =>
                              setServices((prev) =>
                                prev.map((x, j) =>
                                  j === i ? { ...x, name: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <input
                            className={inputCls}
                            value={s.description}
                            placeholder="Short description (optional)"
                            onChange={(e) =>
                              setServices((prev) =>
                                prev.map((x, j) =>
                                  j === i
                                    ? { ...x, description: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                          {services.length > 1 && (
                            <button
                              type="button"
                              aria-label="Remove service"
                              onClick={() =>
                                setServices((prev) =>
                                  prev.filter((_, j) => j !== i),
                                )
                              }
                              className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-line-strong text-muted transition-colors hover:border-ember-deep/60 hover:text-ember-deep"
                            >
                              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setServices((prev) => [
                            ...prev,
                            { name: "", description: "" },
                          ])
                        }
                        className="w-fit font-mono text-xs text-ember transition-colors hover:text-flare"
                      >
                        + Add service
                      </button>
                    </div>
                  </Field>
                  <Field label="Hours" optional>
                    <textarea
                      rows={2}
                      className={areaCls}
                      value={hours}
                      placeholder="Mon–Fri 9am–5pm, Sat 10am–2pm, closed Sunday"
                      onChange={(e) => setHours(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="flex flex-col gap-5">
                  <div>
                    <h1 className="font-display text-3xl text-bone">
                      Meet your assistant.
                    </h1>
                    <p className="mt-2 text-sm text-muted">
                      How it introduces itself to your visitors. Sensible
                      defaults are filled in.
                    </p>
                  </div>
                  <Field label="Assistant name">
                    <input
                      className={inputCls}
                      value={assistantName}
                      placeholder="Assistant"
                      onChange={(e) => setAssistantName(e.target.value)}
                    />
                  </Field>
                  <Field label="Welcome message">
                    <textarea
                      rows={2}
                      className={areaCls}
                      value={welcomeMsg}
                      onChange={(e) => setWelcomeMsg(e.target.value)}
                    />
                  </Field>
                  <Field label="Tone">
                    <input
                      className={inputCls}
                      value={tone}
                      placeholder="friendly, concise, professional"
                      onChange={(e) => setTone(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>

            {error && <p className="mt-5 text-sm text-ember-deep">{error}</p>}

            {/* Nav */}
            <div className="mt-8 flex items-center justify-between">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="text-sm text-muted transition-colors hover:text-bone"
                >
                  ← Back
                </button>
              ) : (
                <Link
                  href="/dashboard"
                  className="text-sm text-muted transition-colors hover:text-bone"
                >
                  Cancel
                </Link>
              )}

              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  disabled={step === 0 && !step0Valid}
                  onClick={() => setStep((s) => s + 1)}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending || !step0Valid}
                  onClick={onCreate}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
                >
                  {pending ? "Launching…" : "Launch assistant"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm text-bone-dim">
        {label}
        {required && <span className="text-ember">*</span>}
        {optional && (
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-faint">
            optional
          </span>
        )}
      </span>
      {hint && <span className="-mt-0.5 text-xs text-faint">{hint}</span>}
      {children}
    </label>
  );
}
