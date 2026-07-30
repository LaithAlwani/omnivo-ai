import { appError } from "./errors";

// -----------------------------------------------------------------------------
// Resend HTTP API — domain management (for custom sending domains) + sending.
// Plain module (uses global fetch), callable from any Convex action runtime.
// The API key is the single platform key: RESEND_API_KEY on the deployment.
// -----------------------------------------------------------------------------

export type DnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number;
};

export type DomainStatus = "pending" | "verified" | "failed";

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    appError(
      "CONFIG",
      "Custom domains aren't configured — set RESEND_API_KEY on the Convex deployment.",
    );
  }
  return key;
}

async function resend(
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/** Map Resend's domain status to our three states. */
function normStatus(s: unknown): DomainStatus {
  if (s === "verified") return "verified";
  if (s === "failed" || s === "temporary_failure") return "failed";
  return "pending"; // not_started | pending
}

/** Normalize Resend's DNS records into the shape the dashboard renders. */
function normRecords(records: unknown): DnsRecord[] {
  if (!Array.isArray(records)) return [];
  return records.map((r) => {
    const rec = r as {
      type?: string;
      name?: string;
      value?: string;
      priority?: number;
    };
    return {
      type: rec.type ?? "TXT",
      name: rec.name ?? "",
      value: rec.value ?? "",
      ...(typeof rec.priority === "number" ? { priority: rec.priority } : {}),
    };
  });
}

/** Create (register) a sending domain. Returns Resend's id + the DNS records. */
export async function createDomain(
  name: string,
): Promise<{ id: string; status: DomainStatus; records: DnsRecord[] }> {
  const { ok, json } = await resend("/domains", {
    method: "POST",
    body: { name },
  });
  if (!ok || !json?.id) {
    appError(
      "INVALID_INPUT",
      json?.message ?? "Resend rejected that domain — check the name and retry.",
    );
  }
  return {
    id: json.id,
    status: normStatus(json.status),
    records: normRecords(json.records),
  };
}

/** Trigger verification, then read back the current status + records. */
export async function verifyDomain(
  id: string,
): Promise<{ status: DomainStatus; records: DnsRecord[] }> {
  await resend(`/domains/${id}/verify`, { method: "POST" });
  const { ok, json } = await resend(`/domains/${id}`, { method: "GET" });
  if (!ok) {
    appError("NOT_FOUND", "That domain is no longer registered with Resend.");
  }
  return {
    status: normStatus(json?.status),
    records: normRecords(json?.records),
  };
}

/** Delete a domain from Resend (best-effort — ignore failures). */
export async function deleteDomain(id: string): Promise<void> {
  try {
    await resend(`/domains/${id}`, { method: "DELETE" });
  } catch {
    /* best-effort */
  }
}

/** Send an email through Resend. Returns whether it was accepted. */
export async function sendEmail(opts: {
  from: string; // "Name <addr@domain>"
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const { ok } = await resend("/emails", { method: "POST", body: opts });
  return ok;
}
