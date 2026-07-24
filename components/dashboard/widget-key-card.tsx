"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";

export function WidgetKeyCard() {
  const b = useBusiness();
  const reveal = useAction(api.embedKeys.reveal);
  const rotate = useAction(api.embedKeys.rotate);

  const [key, setKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | "reveal" | "rotate">(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [host, setHost] = useState("");

  // window.location is only known after mount — the effect is the right place.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(window.location.origin);
  }, []);

  const masked = `ek_${b.embedKeyPrefix}.${"•".repeat(20)}`;

  const snippet =
    `<script src="${host || "https://app.your-domain.com"}/widget.js"\n` +
    `  data-embed-key="${key ?? `ek_${b.embedKeyPrefix}.YOUR_KEY`}"\n` +
    `  data-color="${b.branding.primaryColor}"\n` +
    `  data-position="${b.branding.position}"\n` +
    `  async></script>`;

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 1500);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (prompt === "reveal") {
        const r = await reveal({ slug: b.slug, password });
        if (!r.key) {
          setError("No viewable key yet — rotate to generate one.");
        } else {
          setKey(r.key);
        }
      } else {
        const r = await rotate({ slug: b.slug, password });
        setKey(r.key);
      }
      setPrompt(null);
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-line bg-surface/50 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg text-bone">Widget embed key</h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
            Goes in your site&rsquo;s embed snippet. It&rsquo;s a publishable key —
            your domain allow-list is what keeps it safe.
          </p>
        </div>
        {isManagerRole(b.role) && (
          <button
            onClick={() => {
              setPrompt("rotate");
              setKey(null);
              setError(null);
            }}
            className="shrink-0 text-xs text-muted transition-colors hover:text-ember-deep"
          >
            Rotate key
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-line-strong bg-ink px-4 py-3 font-mono text-sm text-bone">
          {key ?? masked}
        </code>
        {key ? (
          <>
            <button
              onClick={copy}
              className="rounded-full border border-line-strong px-4 py-2 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => setKey(null)}
              className="text-sm text-muted transition-colors hover:text-bone"
            >
              Hide
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              setPrompt("reveal");
              setError(null);
            }}
            className="rounded-full bg-ember px-4 py-2 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            Reveal
          </button>
        )}
      </div>

      {prompt && (
        <form
          onSubmit={onSubmit}
          className="mt-4 rounded-lg border border-line bg-ink/50 p-4"
        >
          <label className="font-mono text-xs uppercase tracking-wider text-faint">
            {prompt === "rotate"
              ? "Confirm your password to rotate the key"
              : "Confirm your password to reveal the key"}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your login password"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
            />
            <button
              type="submit"
              disabled={pending || !password}
              className="h-10 rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare disabled:opacity-60"
            >
              {pending ? "Checking…" : prompt === "rotate" ? "Rotate" : "Reveal"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPrompt(null);
                setPassword("");
                setError(null);
              }}
              className="h-10 px-3 text-sm text-muted transition-colors hover:text-bone"
            >
              Cancel
            </button>
          </div>
          {prompt === "rotate" && (
            <p className="mt-2 text-xs text-faint">
              Rotating immediately invalidates the current key — any live widget
              using it will stop until you update the snippet.
            </p>
          )}
        </form>
      )}

      {error && <p className="mt-3 text-sm text-ember-deep">{error}</p>}

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm text-bone">Install on your site</h3>
          <button
            onClick={copySnippet}
            className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-xs text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
          >
            {snippetCopied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Paste this just before <code className="text-bone-dim">&lt;/body&gt;</code>.{" "}
          {key
            ? "Your live key is included."
            : "Reveal your key above to drop it in."}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line-strong bg-ink px-4 py-3 font-mono text-xs leading-relaxed text-bone-dim">
          <code>{snippet}</code>
        </pre>
      </div>
    </div>
  );
}
