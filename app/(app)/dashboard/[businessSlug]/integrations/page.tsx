"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errors";
import {
  useBusiness,
  isManagerRole,
} from "@/components/dashboard/business-context";
import { ModuleGate } from "@/components/dashboard/module-gate";

export default function IntegrationsPage() {
  return (
    <ModuleGate module="integrations">
      <IntegrationsInner />
    </ModuleGate>
  );
}

type Kind = "booking" | "crmOutbound" | "crmInbound";

const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-bone placeholder:text-faint focus-visible:border-ember";

function IntegrationsInner() {
  const b = useBusiness();
  const installerManaged = b.provisioning === "installer";
  const canEdit = isManagerRole(b.role) && !installerManaged;
  const data = useQuery(api.integrations.list, { slug: b.slug });

  if (data === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const find = (kind: Kind) =>
    data.integrations.find((i) => i.kind === kind) ?? null;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-3xl text-bone">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Connect your own booking system and CRM — the assistant books through
          your scheduler and syncs new leads out to your tools. Don&rsquo;t have
          one yet? LA Digital can set up booking and CRM for you.
        </p>
        {installerManaged ? (
          <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
            Your installer manages these connections — contact them to make
            changes.
          </p>
        ) : (
          !canEdit && (
            <p className="mt-4 rounded-lg border border-line bg-surface/50 px-4 py-3 text-sm text-muted">
              View-only — ask an owner or admin to make changes.
            </p>
          )
        )}
      </div>

      <BookingCard slug={b.slug} canEdit={canEdit} current={find("booking")} />
      <WebhookCard
        slug={b.slug}
        canEdit={canEdit}
        kind="crmOutbound"
        title="CRM — outbound sync"
        blurb="Send new leads to your CRM — pick LA Digital, or POST to any URL (e.g. a Zapier or CRM webhook)."
        current={find("crmOutbound")}
        allowLadigital
      />
      <WebhookCard
        slug={b.slug}
        canEdit={canEdit}
        kind="crmInbound"
        title="CRM — customer lookup"
        blurb="Recognize returning customers by email/phone — pick LA Digital, or a URL the assistant GETs with ?email= / ?phone=."
        current={find("crmInbound")}
        allowLadigital
      />
    </div>
  );
}

type Conn = {
  _id: Id<"integrations">;
  provider: string;
  config: unknown;
  active: boolean;
  verified: boolean;
  hasSecret: boolean;
} | null;

function useConnActions() {
  const save = useAction(api.integrationsNode.save);
  const test = useAction(api.integrationsNode.test);
  const remove = useMutation(api.integrations.remove);
  return { save, test, remove };
}

function StatusPill({ conn }: { conn: Conn }) {
  if (!conn) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider ${
        conn.verified
          ? "border-ember/40 bg-ember-soft text-ember"
          : "border-line-strong text-faint"
      }`}
    >
      {conn.verified ? "Verified" : conn.active ? "Not tested" : "Off"}
    </span>
  );
}

type BookingProvider = "calcom" | "ladigital" | "link" | "webhook";

function BookingCard({
  slug,
  canEdit,
  current,
}: {
  slug: string;
  canEdit: boolean;
  current: Conn;
}) {
  const { save, test, remove } = useConnActions();
  const cfg = (current?.config ?? {}) as {
    availabilityUrl?: string;
    bookingUrl?: string;
    eventTypeId?: number | string;
    schedulingLink?: string;
    baseUrl?: string;
  };
  const cur = current?.provider as BookingProvider | undefined;
  const [provider, setProvider] = useState<BookingProvider>(
    cur === "webhook" || cur === "link" || cur === "calcom" || cur === "ladigital"
      ? cur
      : "calcom",
  );
  const [eventTypeId, setEventTypeId] = useState(String(cfg.eventTypeId ?? ""));
  const [schedulingLink, setLink] = useState(cfg.schedulingLink ?? "");
  const [availabilityUrl, setA] = useState(cfg.availabilityUrl ?? "");
  const [bookingUrl, setBk] = useState(cfg.bookingUrl ?? "");
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    const config =
      provider === "calcom"
        ? { eventTypeId: eventTypeId.trim() ? Number(eventTypeId.trim()) : undefined }
        : provider === "ladigital"
          ? { baseUrl: baseUrl.trim() }
          : provider === "link"
            ? { schedulingLink: schedulingLink.trim() }
            : { availabilityUrl, bookingUrl };
    return act(() =>
      save({ slug, kind: "booking", provider, config, secret: secret || undefined }),
    );
  }

  const keyPlaceholder = current?.hasSecret
    ? "API key (leave blank to keep)"
    : "API key";

  return (
    <section className="rounded-xl border border-line bg-surface/40 p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg text-bone">Booking provider</h2>
        <StatusPill conn={current} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Let the assistant book into your own scheduler. Without one connected, it
        captures the lead and hands off instead of booking.
      </p>

      <fieldset disabled={!canEdit || busy} className="mt-4 space-y-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as BookingProvider)}
          className={inputCls}
        >
          <option value="calcom">Cal.com — assistant books in chat</option>
          <option value="ladigital">LA Digital — assistant books in chat</option>
          <option value="link">Booking link — assistant hands off (Calendly, Acuity…)</option>
          <option value="webhook">Custom webhook</option>
        </select>

        {provider === "calcom" && (
          <>
            <input
              className={inputCls}
              value={eventTypeId}
              onChange={(e) => setEventTypeId(e.target.value)}
              placeholder="Cal.com event type ID (e.g. 123456)"
            />
            <input
              className={inputCls}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder={keyPlaceholder}
            />
          </>
        )}

        {provider === "ladigital" && (
          <>
            <input
              className={inputCls}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Site URL (e.g. https://acme.ladigital.ca)"
            />
            <input
              className={inputCls}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder={`${keyPlaceholder} (AGENT_API_KEY)`}
            />
          </>
        )}

        {provider === "link" && (
          <input
            className={inputCls}
            value={schedulingLink}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Your booking page URL (e.g. https://calendly.com/you)"
          />
        )}

        {provider === "webhook" && (
          <>
            <input
              className={inputCls}
              value={availabilityUrl}
              onChange={(e) => setA(e.target.value)}
              placeholder="Availability URL (GET open times)"
            />
            <input
              className={inputCls}
              value={bookingUrl}
              onChange={(e) => setBk(e.target.value)}
              placeholder="Booking URL (POST to create)"
            />
            <input
              className={inputCls}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder={`${keyPlaceholder} (optional)`}
            />
          </>
        )}
      </fieldset>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={onSave}
            className="h-9 rounded-full bg-ember px-4 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            Save
          </button>
          {current && (
            <>
              {(current.provider === "webhook" ||
                current.provider === "ladigital") && (
                <button
                  onClick={() =>
                    act(async () => {
                      const r = await test({ slug, integrationId: current._id });
                      setMsg(r.detail);
                    })
                  }
                  className="h-9 rounded-full border border-line-strong px-4 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone"
                >
                  Test
                </button>
              )}
              <button
                onClick={() =>
                  act(() => remove({ slug, integrationId: current._id }))
                }
                className="h-9 rounded-full border border-line-strong px-4 text-sm text-muted transition-colors hover:text-ember-deep"
              >
                Remove
              </button>
            </>
          )}
          {msg && <span className="text-sm text-bone-dim">{msg}</span>}
        </div>
      )}
    </section>
  );
}

type CrmProvider = "webhook" | "ladigital";

function WebhookCard({
  slug,
  canEdit,
  kind,
  title,
  blurb,
  current,
  allowLadigital = false,
}: {
  slug: string;
  canEdit: boolean;
  kind: Kind;
  title: string;
  blurb: string;
  current: Conn;
  allowLadigital?: boolean;
}) {
  const { save, test, remove } = useConnActions();
  const cfg = (current?.config ?? {}) as { url?: string; baseUrl?: string };
  const [provider, setProvider] = useState<CrmProvider>(
    current?.provider === "ladigital" ? "ladigital" : "webhook",
  );
  const [url, setUrl] = useState(cfg.url ?? "");
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLadigital = allowLadigital && provider === "ladigital";

  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface/40 p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg text-bone">{title}</h2>
        <StatusPill conn={current} />
      </div>
      <p className="mt-1 text-sm text-muted">{blurb}</p>
      <fieldset disabled={!canEdit || busy} className="mt-4 space-y-2">
        {allowLadigital && (
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as CrmProvider)}
            className={inputCls}
          >
            <option value="webhook">Custom webhook / Zapier</option>
            <option value="ladigital">LA Digital CRM</option>
          </select>
        )}
        {isLadigital ? (
          <input
            className={inputCls}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Site URL (e.g. https://acme.ladigital.ca)"
          />
        ) : (
          <input
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        )}
        <input
          className={inputCls}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          type="password"
          placeholder={
            current?.hasSecret
              ? "API key (leave blank to keep)"
              : isLadigital
                ? "API key (AGENT_API_KEY)"
                : "API key (optional)"
          }
        />
      </fieldset>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() =>
              act(() =>
                save({
                  slug,
                  kind,
                  provider: isLadigital ? "ladigital" : "webhook",
                  config: isLadigital ? { baseUrl } : { url },
                  secret: secret || undefined,
                }),
              )
            }
            className="h-9 rounded-full bg-ember px-4 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            Save
          </button>
          {current && (
            <>
              <button
                onClick={() =>
                  act(async () => {
                    const r = await test({ slug, integrationId: current._id });
                    setMsg(r.detail);
                  })
                }
                className="h-9 rounded-full border border-line-strong px-4 text-sm text-bone-dim transition-colors hover:border-ember/60 hover:text-bone"
              >
                Test
              </button>
              <button
                onClick={() =>
                  act(() => remove({ slug, integrationId: current._id }))
                }
                className="h-9 rounded-full border border-line-strong px-4 text-sm text-muted transition-colors hover:text-ember-deep"
              >
                Remove
              </button>
            </>
          )}
          {msg && <span className="text-sm text-bone-dim">{msg}</span>}
        </div>
      )}
    </section>
  );
}
