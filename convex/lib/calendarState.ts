import type { Provider } from "./calendarProviders";

// Signed OAuth `state` — carries businessId + staffId + provider through the
// redirect so the single callback can trust which tenant/employee/provider to
// connect (prevents CSRF + wrong-tenant/staff). HMAC-SHA256; URL-safe parts.

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function signState(
  secret: string,
  businessId: string,
  staffId: string,
  provider: Provider,
  ttlMs = 10 * 60_000,
): Promise<string> {
  const exp = Date.now() + ttlMs;
  const payload = `${businessId}~${staffId}~${provider}~${exp}`;
  return `${payload}~${await hmacHex(secret, payload)}`;
}

export async function verifyState(
  secret: string,
  state: string,
): Promise<{ businessId: string; staffId: string; provider: Provider } | null> {
  const parts = state.split("~");
  if (parts.length !== 5) return null;
  const [businessId, staffId, provider, exp, mac] = parts;
  if (provider !== "google" && provider !== "microsoft") return null;

  const expected = await hmacHex(secret, `${businessId}~${staffId}~${provider}~${exp}`);
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (Number(exp) < Date.now()) return null;

  return { businessId, staffId, provider };
}
