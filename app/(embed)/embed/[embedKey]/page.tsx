"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";

type Msg = { role: "user" | "assistant"; content: string };
type Config = {
  name: string;
  assistantName: string;
  welcomeMsg: string;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  position: "left" | "right";
  chatIcon: string | null;
  whiteLabel: boolean;
};

// Rotating status lines while the model is working (before the first token).
const THINKING = [
  "Thinking…",
  "Looking that up…",
  "One moment…",
  "Putting that together…",
];

/** Pull the human-readable message out of a thrown ConvexError — our server
 *  errors carry a `{ code, message }` payload (e.g. "This assistant isn't live
 *  yet.", "Too many requests right now…"). Falls back to a friendly default for
 *  anything unstructured (network blips, unexpected errors). */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  return fallback;
}

/** The Omnivo AI mark (machined ring + molten core) at footer scale, on light. */
function OmnivoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-3 w-3 shrink-0" aria-hidden="true">
      <defs>
        <radialGradient id="omnivo-mark-core" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#FF8A52" />
          <stop offset="62%" stopColor="#F0522A" />
          <stop offset="100%" stopColor="#D93C16" />
        </radialGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="14.4"
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="1.6"
      />
      <circle cx="16" cy="16" r="7.2" fill="url(#omnivo-mark-core)" />
    </svg>
  );
}

/** Render assistant text as Markdown, styled for the light widget so headings,
 *  lists, code, links, and emphasis read cleanly (no raw ** or - symbols). */
function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:underline [&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:text-gray-500 [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_h1]:my-1.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-gray-900 [&_pre]:p-2.5 [&_pre]:text-gray-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Inline contact form the assistant shows (via request_contact) instead of
 *  asking for name/email/phone field-by-field in chat. */
function ContactForm({
  brand,
  ink,
  onSubmit,
}: {
  brand: string;
  ink: string;
  onSubmit: (v: { name: string; email?: string; phone?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = name.trim() !== "" && (email.trim() !== "" || phone.trim() !== "");

  const field =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2";

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
    } catch (e) {
      setErr(errorMessage(e, "Couldn't send that — please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[85%] rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-medium text-gray-500">Your details</p>
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          autoComplete="name"
          className={field}
          style={{ outlineColor: brand }}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
          className={field}
          style={{ outlineColor: brand }}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          type="tel"
          autoComplete="tel"
          className={field}
          style={{ outlineColor: brand }}
        />
      </div>
      {err && <p className="mt-1.5 text-xs text-red-500">{err}</p>}
      <button
        onClick={submit}
        disabled={!valid || busy}
        className="mt-2.5 h-9 w-full rounded-full text-sm font-medium transition-opacity disabled:opacity-50"
        style={{ backgroundColor: brand, color: ink }}
      >
        {busy ? "Sending…" : "Send"}
      </button>
    </div>
  );
}

/** Animated "thinking" indicator with a rotating status line. */
function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % THINKING.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-gray-400">
      <span className="flex gap-1">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${d * 0.15}s` }}
          />
        ))}
      </span>
      <span className="text-xs">{THINKING[i]}</span>
    </div>
  );
}

export default function EmbedWidget() {
  const params = useParams<{ embedKey: string }>();
  const search = useSearchParams();
  const embedKey = params.embedKey;
  const origin = search.get("o") ?? undefined;

  const loadConfig = useAction(api.public.config);
  const chat = useAction(api.publicChat.chat);
  const capture = useAction(api.public.captureLead);

  // One opaque session id per widget open — groups this visitor's turns into a
  // single conversation for analytics/usage (no PII, resets on reload).
  const [conversationId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );

  const [config, setConfig] = useState<Config | null>(null);
  const [failed, setFailed] = useState(false);
  const [failMsg, setFailMsg] = useState(
    "This chat isn't available right now.",
  );
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  // The in-flight turn's stream key (null when idle). Drives the live bubble.
  const [streamKey, setStreamKey] = useState<string | null>(null);
  // Whether to show the inline contact form (the assistant asked for details).
  const [showForm, setShowForm] = useState(false);
  const stream = useQuery(
    api.chatStream.streamText,
    streamKey ? { key: streamKey } : "skip",
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load branding once, then seed the welcome message.
  useEffect(() => {
    let live = true;
    loadConfig({ embedKey, origin })
      .then((c) => {
        if (!live) return;
        setConfig(c);
        setMessages([{ role: "assistant", content: c.welcomeMsg }]);
      })
      .catch((e) => {
        if (!live) return;
        // Surface the real reason where it's visitor-safe ("This assistant
        // isn't live yet." / origin not allowed), else a friendly fallback.
        setFailMsg(errorMessage(e, "This chat isn't available right now."));
        setFailed(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamKey, stream?.text, showForm]);

  async function send() {
    const text = draft.trim();
    if (!text || streamKey) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    setShowForm(false);
    const key =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setStreamKey(key);
    try {
      const { reply, requestContact } = await chat({
        embedKey,
        origin,
        conversationId,
        streamKey: key,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (requestContact) setShowForm(true);
    } catch (e) {
      // The server degrades most model failures into a friendly `reply`; this
      // path is for the pre-flight throws (rate limit, key/serving) and network
      // errors — surface their real message so the visitor understands.
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: errorMessage(
            e,
            "Sorry — I hit a snag. Please try again in a moment.",
          ),
        },
      ]);
    } finally {
      setStreamKey(null);
    }
  }

  async function submitContact(v: {
    name: string;
    email?: string;
    phone?: string;
  }) {
    await capture({ embedKey, origin, ...v });
    setShowForm(false);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: "Thanks — I've shared your details with the team. They'll be in touch soon.",
      },
    ]);
  }

  function close() {
    window.parent?.postMessage({ type: "ai-engine:close" }, "*");
  }

  if (failed) {
    return (
      <div className="grid h-dvh place-items-center bg-white p-6 text-center text-sm text-gray-500">
        {failMsg}
      </div>
    );
  }

  const brand = config?.primaryColor ?? "#111827";
  // Text/icon color drawn on the brand color — chosen by the tenant so a light
  // primary stays legible (defaults to white).
  const ink = config?.textColor ?? "#ffffff";

  return (
    <div className="flex h-dvh flex-col bg-white text-gray-900">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: brand, color: ink }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/15"
            aria-hidden
          >
            {config?.chatIcon ? (
              <span className="text-base leading-none">{config.chatIcon}</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              >
                <path
                  d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {config?.assistantName ?? "Assistant"}
            </p>
            {config?.name && (
              <p className="truncate text-xs leading-tight opacity-80">
                {config.name}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={close}
          aria-label="Close chat"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-black/10"
          style={{ color: ink }}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {config === null && !failed && (
          <p className="text-sm text-gray-400">Loading…</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "user" ? (
              <div
                className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
                style={{ backgroundColor: brand, color: ink }}
              >
                {m.content}
              </div>
            ) : (
              <div className="max-w-[85%] rounded-2xl bg-gray-100 px-3.5 py-2 text-gray-800">
                <Markdown>{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}
        {/* Live streaming bubble: the thinking indicator until the first token,
            then the assistant's reply as it streams in. */}
        {streamKey && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-gray-100 px-3.5 py-2 text-gray-800">
              {stream?.text ? <Markdown>{stream.text}</Markdown> : <Thinking />}
            </div>
          </div>
        )}
        {/* Inline contact form — shown when the assistant calls request_contact. */}
        {showForm && !streamKey && (
          <div className="flex justify-start">
            <ContactForm brand={brand} ink={ink} onSubmit={submitContact} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Type a message…"
            disabled={config === null}
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2"
            style={{ outlineColor: brand }}
          />
          <button
            onClick={send}
            disabled={streamKey !== null || !draft.trim() || config === null}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-40"
            style={{ backgroundColor: brand, color: ink }}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M3 10L17 3l-4 14-3-6-7-1z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {!config?.whiteLabel && (
          <a
            href="https://omnivoai.ca"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-gray-400 transition-colors hover:text-gray-600"
          >
            <OmnivoMark />
            <span>Powered by Omnivo AI</span>
          </a>
        )}
      </div>
    </div>
  );
}
