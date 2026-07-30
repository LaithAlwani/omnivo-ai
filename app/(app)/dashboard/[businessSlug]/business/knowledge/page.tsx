"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

type Service = { name: string; description?: string };
type Location = { name?: string; address: string; phone?: string };
type Faq = { q: string; a: string };
type Knowledge = {
  about: string;
  services: Service[];
  pricing: string;
  hours: string;
  locations: Location[];
  faq: Faq[];
  policies: string;
};

const EMPTY: Knowledge = {
  about: "",
  services: [],
  pricing: "",
  hours: "",
  locations: [],
  faq: [],
  policies: "",
};

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="text-lg text-bone">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export default function KnowledgePage() {
  const b = useBusiness();
  const canEdit = isManagerRole(b.role);
  const stored = useQuery(api.knowledge.get, { slug: b.slug });
  const save = useMutation(api.knowledge.update);

  const [form, setForm] = useState<Knowledge | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize once the stored value loads.
  if (form === null && stored !== undefined) {
    setForm(
      stored
        ? {
            about: stored.about,
            services: stored.services,
            pricing: stored.pricing,
            hours: stored.hours,
            locations: stored.locations,
            faq: stored.faq,
            policies: stored.policies,
          }
        : EMPTY,
    );
  }

  if (!form) {
    return <p className="text-sm text-faint">Loading…</p>;
  }

  function set<K extends keyof Knowledge>(key: K, value: Knowledge[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function onSave() {
    if (!form) return;
    setError(null);
    setPending(true);
    try {
      await save({ slug: b.slug, knowledge: form });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-2xl pb-16">
      <h1 className="font-display text-3xl text-bone">Knowledge</h1>
      <p className="mt-1 text-sm text-muted">
        What {b.branding.assistantName} knows about {b.name}. This is the
        assistant&rsquo;s source of truth — it answers from here.
      </p>

      {!canEdit && (
        <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
          View-only — ask an owner or admin to edit.
        </p>
      )}

      <fieldset disabled={!canEdit || pending} className="mt-8 space-y-8">
        <Section title="About" hint="A short description of the business.">
          <textarea
            rows={3}
            className={inputCls}
            value={form.about}
            onChange={(e) => set("about", e.target.value)}
            placeholder="We're a family-owned dog grooming studio in Ottawa…"
          />
        </Section>

        <Section title="Services">
          {form.services.map((s, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={s.name}
                onChange={(e) =>
                  set(
                    "services",
                    form.services.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Service name"
              />
              <input
                className={`${inputCls} min-w-0 flex-[2]`}
                value={s.description ?? ""}
                onChange={(e) =>
                  set(
                    "services",
                    form.services.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Short description (optional)"
              />
              <RemoveBtn
                onClick={() =>
                  set(
                    "services",
                    form.services.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <AddBtn
            label="Add service"
            onClick={() => set("services", [...form.services, { name: "" }])}
          />
        </Section>

        <Section title="Pricing" hint="How pricing works, in your words.">
          <textarea
            rows={2}
            className={inputCls}
            value={form.pricing}
            onChange={(e) => set("pricing", e.target.value)}
            placeholder="Full groom from $65, depending on size and coat…"
          />
        </Section>

        <Section title="Hours">
          <textarea
            rows={2}
            className={inputCls}
            value={form.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="Mon–Fri 9am–6pm, Sat 10am–4pm, closed Sundays"
          />
        </Section>

        <Section title="Locations">
          {form.locations.map((l, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={l.name ?? ""}
                onChange={(e) =>
                  set(
                    "locations",
                    form.locations.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Label (optional)"
              />
              <input
                className={`${inputCls} min-w-0 flex-[2]`}
                value={l.address}
                onChange={(e) =>
                  set(
                    "locations",
                    form.locations.map((x, j) =>
                      j === i ? { ...x, address: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Address"
              />
              <input
                className={`${inputCls} min-w-0 flex-1`}
                value={l.phone ?? ""}
                onChange={(e) =>
                  set(
                    "locations",
                    form.locations.map((x, j) =>
                      j === i ? { ...x, phone: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Phone (optional)"
              />
              <RemoveBtn
                onClick={() =>
                  set(
                    "locations",
                    form.locations.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <AddBtn
            label="Add location"
            onClick={() =>
              set("locations", [...form.locations, { address: "" }])
            }
          />
        </Section>

        <Section title="FAQ">
          {form.faq.map((f, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="flex items-start gap-2">
                <input
                  className={`${inputCls} min-w-0 flex-1`}
                  value={f.q}
                  onChange={(e) =>
                    set(
                      "faq",
                      form.faq.map((x, j) =>
                        j === i ? { ...x, q: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Question"
                />
                <RemoveBtn
                  onClick={() =>
                    set(
                      "faq",
                      form.faq.filter((_, j) => j !== i),
                    )
                  }
                />
              </div>
              <textarea
                rows={2}
                className={`${inputCls} mt-2`}
                value={f.a}
                onChange={(e) =>
                  set(
                    "faq",
                    form.faq.map((x, j) =>
                      j === i ? { ...x, a: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Answer"
              />
            </div>
          ))}
          <AddBtn
            label="Add question"
            onClick={() => set("faq", [...form.faq, { q: "", a: "" }])}
          />
        </Section>

        <Section title="Policies" hint="Cancellations, deposits, guarantees…">
          <textarea
            rows={3}
            className={inputCls}
            value={form.policies}
            onChange={(e) => set("policies", e.target.value)}
            placeholder="24-hour notice for cancellations; deposits are refundable…"
          />
        </Section>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 mt-8 flex items-center gap-3 border-t border-line bg-ink/80 py-4 backdrop-blur">
          <button
            onClick={onSave}
            disabled={pending}
            className="h-11 rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save knowledge"}
          </button>
          {saved && <span className="text-sm text-flare">Saved ✓</span>}
          {error && <span className="text-sm text-ember-deep">{error}</span>}
        </div>
      )}
    </div>
  );
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-line-strong px-4 py-1.5 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
    >
      + {label}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      className="grid h-10 w-9 shrink-0 place-items-center text-muted transition-colors hover:text-ember-deep"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
