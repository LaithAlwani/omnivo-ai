"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

type Msg = { role: "user" | "assistant"; content: string };
type Config = {
  name: string;
  assistantName: string;
  welcomeMsg: string;
  primaryColor: string;
  accentColor: string;
  position: "left" | "right";
  chatIcon: string | null;
};

export default function EmbedWidget() {
  const params = useParams<{ embedKey: string }>();
  const search = useSearchParams();
  const embedKey = params.embedKey;
  const origin = search.get("o") ?? undefined;

  const loadConfig = useAction(api.public.config);
  const chat = useAction(api.publicChat.chat);

  const [config, setConfig] = useState<Config | null>(null);
  const [failed, setFailed] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    setSending(true);
    try {
      const { reply } = await chat({
        embedKey,
        origin,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry — I hit a snag. Please try again in a moment.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function close() {
    window.parent?.postMessage({ type: "ai-engine:close" }, "*");
  }

  if (failed) {
    return (
      <div className="grid h-dvh place-items-center bg-white p-6 text-center text-sm text-gray-500">
        This chat isn&rsquo;t available right now.
      </div>
    );
  }

  const brand = config?.primaryColor ?? "#111827";

  return (
    <div className="flex h-dvh flex-col bg-white text-gray-900">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 text-white"
        style={{ backgroundColor: brand }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-lg leading-none">
            {config?.chatIcon ?? "💬"}
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15"
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
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
              style={m.role === "user" ? { backgroundColor: brand } : undefined}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-3.5 py-2 text-sm text-gray-400">
              …
            </div>
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
            disabled={sending || !draft.trim() || config === null}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: brand }}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M3 10L17 3l-4 14-3-6-7-1z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-gray-400">
          Powered by AI Engine
        </p>
      </div>
    </div>
  );
}
