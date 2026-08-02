"use client";

import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errors";
import { useBusiness } from "@/components/dashboard/business-context";

type Msg = { role: "user" | "assistant"; content: string };

export default function AssistantPage() {
  const b = useBusiness();
  const reply = useAction(api.assistant.reply);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const primary = b.branding.primaryColor;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);
    try {
      const res = await reply({ slug: b.slug, messages: next });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] max-w-2xl flex-col">
      <div>
        <h1 className="font-display text-3xl text-bone">Test your assistant</h1>
        <p className="mt-1 text-sm text-muted">
          This is {b.branding.assistantName} answering as {b.name}, in your set
          tone. Booking &amp; lead capture come online in Phase 2.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="mt-6 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface/40 p-5"
      >
        {/* Seeded welcome — display only, not sent to the model */}
        <Bubble role="assistant" primary={primary}>
          {b.branding.welcomeMsg}
        </Bubble>

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} primary={primary}>
            {m.content}
          </Bubble>
        ))}

        {pending && (
          <Bubble role="assistant" primary={primary}>
            <span className="inline-flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          </Bubble>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-ember-deep">{error}</p>}

      <form onSubmit={send} className="mt-4 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${b.branding.assistantName} something…`}
          className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-5 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[#160b04] transition-opacity disabled:opacity-50"
          style={{ background: primary }}
          aria-label="Send"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 13V3M4 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function Bubble({
  role,
  primary,
  children,
}: {
  role: "user" | "assistant";
  primary: string;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm"
        style={
          isUser
            ? { background: "var(--color-surface-2)", color: "var(--color-bone)" }
            : {
                background: `color-mix(in srgb, ${primary} 18%, transparent)`,
                border: `1px solid color-mix(in srgb, ${primary} 40%, transparent)`,
                color: "var(--color-bone)",
              }
        }
      >
        {children}
      </div>
    </div>
  );
}
