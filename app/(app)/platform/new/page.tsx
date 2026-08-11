"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";

const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export default function NewTenantPage() {
  const router = useRouter();
  const provision = useAction(api.platform.provisionForClient);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [tier, setTier] = useState<"starter" | "professional" | "premium">(
    "starter",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { businessId } = await provision({
        clientEmail,
        name,
        slug: effectiveSlug,
        tier,
      });
      router.push(`/platform/${businessId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-display text-3xl text-bone">Provision a tenant</h1>
      <p className="mt-1 text-sm text-muted">
        Create an installer-managed business on a client&rsquo;s behalf. They claim
        ownership later via an invite.
      </p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm text-muted">Business name</span>
          <input
            className={`${inputCls} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Dental"
          />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Dashboard URL</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-faint">/dashboard/</span>
            <input
              className={inputCls}
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="acme-dental"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-sm text-muted">Client email (owner)</span>
          <input
            className={`${inputCls} mt-1`}
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="owner@acmedental.com"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Plan</span>
          <select
            className={`${inputCls} mt-1`}
            value={tier}
            onChange={(e) =>
              setTier(e.target.value as "starter" | "professional" | "premium")
            }
          >
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="premium">Premium</option>
          </select>
        </label>

        {error && <p className="text-sm text-ember-deep">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || !name || !effectiveSlug || !clientEmail}
          className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-50"
        >
          {busy ? "Provisioning…" : "Provision tenant"}
        </button>
      </div>
    </div>
  );
}
