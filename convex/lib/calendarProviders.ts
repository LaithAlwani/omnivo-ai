import { appError } from "./errors";

// -----------------------------------------------------------------------------
// Provider-agnostic calendar integration. One interface, two implementations
// (Google Calendar + Microsoft Graph). Every call is plain fetch — no Node.
//   connect:  buildAuthUrl → exchangeCode → refreshTokens
//   read:     fetchEmail, fetchBusy
//   write:    createEvent, deleteEvent   (appointments land on the staff's calendar)
// -----------------------------------------------------------------------------

export type Provider = "google" | "microsoft";

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};
export type BusySpan = { start: number; end: number };

const CFG = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar",
    ],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    label: "Google Calendar",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "openid",
      "email",
      "offline_access",
      "https://graph.microsoft.com/Calendars.ReadWrite",
    ],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    label: "Microsoft Outlook",
  },
} as const;

function env(name: string): string {
  const v = process.env[name];
  if (!v) appError("CONFIG", `${name} is not set on the Convex deployment.`);
  return v;
}

export function buildAuthUrl(
  provider: Provider,
  redirectUri: string,
  state: string,
): string {
  const cfg = CFG[provider];
  const params = new URLSearchParams({
    client_id: env(cfg.clientIdEnv),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
    // Force the account chooser + offline access (refresh token) on both.
    access_type: "offline",
    prompt: provider === "google" ? "select_account consent" : "select_account",
  });
  if (provider === "microsoft") params.set("response_mode", "query");
  return `${cfg.authUrl}?${params.toString()}`;
}

async function tokenRequest(
  provider: Provider,
  body: Record<string, string>,
): Promise<OAuthTokens> {
  const cfg = CFG[provider];
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: env(cfg.clientIdEnv),
      client_secret: env(cfg.clientSecretEnv),
    }),
  });
  if (!res.ok) {
    appError("CONFIG", `${cfg.label} token request failed (${res.status}).`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export function exchangeCode(
  provider: Provider,
  code: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  return tokenRequest(provider, {
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshTokens(
  provider: Provider,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body: Record<string, string> = {
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };
  // Microsoft requires the scopes again on refresh.
  if (provider === "microsoft") body.scope = CFG.microsoft.scopes.join(" ");
  return tokenRequest(provider, body);
}

export async function fetchEmail(
  provider: Provider,
  accessToken: string,
): Promise<string | undefined> {
  if (provider === "google") {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    return ((await res.json()) as { email?: string }).email;
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };
  return data.mail ?? data.userPrincipalName;
}

const isoUtc = (ms: number) => new Date(ms).toISOString();
const graphIso = (ms: number) => new Date(ms).toISOString().replace("Z", "");

export async function fetchBusy(
  provider: Provider,
  accessToken: string,
  calendarId: string,
  email: string | undefined,
  timeMinMs: number,
  timeMaxMs: number,
): Promise<BusySpan[]> {
  if (provider === "google") {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          timeMin: isoUtc(timeMinMs),
          timeMax: isoUtc(timeMaxMs),
          items: [{ id: calendarId }],
        }),
      },
    );
    if (!res.ok) appError("CONFIG", `Google free/busy failed (${res.status}).`);
    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    return (data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
      start: Date.parse(b.start),
      end: Date.parse(b.end),
    }));
  }

  // Microsoft Graph getSchedule
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schedules: [email ?? "me"],
        startTime: { dateTime: graphIso(timeMinMs), timeZone: "UTC" },
        endTime: { dateTime: graphIso(timeMaxMs), timeZone: "UTC" },
        availabilityViewInterval: 30,
      }),
    },
  );
  if (!res.ok) appError("CONFIG", `Outlook free/busy failed (${res.status}).`);
  const data = (await res.json()) as {
    value?: {
      scheduleItems?: {
        status?: string;
        start: { dateTime: string };
        end: { dateTime: string };
      }[];
    }[];
  };
  const items = data.value?.[0]?.scheduleItems ?? [];
  return items
    .filter((i) => i.status !== "free")
    .map((i) => ({
      start: Date.parse(`${i.start.dateTime}Z`),
      end: Date.parse(`${i.end.dateTime}Z`),
    }));
}

export async function createEvent(
  provider: Provider,
  accessToken: string,
  calendarId: string,
  event: { startMs: number; endMs: number; summary: string; description: string },
): Promise<string> {
  if (provider === "google") {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: event.summary,
          description: event.description,
          start: { dateTime: isoUtc(event.startMs), timeZone: "UTC" },
          end: { dateTime: isoUtc(event.endMs), timeZone: "UTC" },
        }),
      },
    );
    if (!res.ok) appError("CONFIG", `Google event create failed (${res.status}).`);
    return ((await res.json()) as { id: string }).id;
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subject: event.summary,
      body: { contentType: "text", content: event.description },
      start: { dateTime: graphIso(event.startMs), timeZone: "UTC" },
      end: { dateTime: graphIso(event.endMs), timeZone: "UTC" },
    }),
  });
  if (!res.ok) appError("CONFIG", `Outlook event create failed (${res.status}).`);
  return ((await res.json()) as { id: string }).id;
}

export async function deleteEvent(
  provider: Provider,
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url =
    provider === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  // 404/410 (already gone) is fine.
  await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}
