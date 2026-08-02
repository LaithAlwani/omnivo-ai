// -----------------------------------------------------------------------------
// Per-business SMS settings — which events text, the reminder lead time, and
// quiet hours. Pure module (uses only Intl) so it's shared by the Node send
// actions, the default-runtime crons, and the dashboard. The SMS Automation
// module + monthly cap still gate whether SMS can send at all; this is the finer
// control on top.
// -----------------------------------------------------------------------------

export interface SmsSettings {
  confirmationEnabled: boolean; // SMS on booking
  reminderEnabled: boolean; // SMS before the appointment
  reviewRequestEnabled: boolean; // review request by SMS (else email)
  leadFollowupEnabled: boolean; // nurture follow-up by SMS (else email)
  reminderLeadHours: number; // how far ahead to text the reminder
  quietStart: number | null; // local hour [0-23] quiet window start (inclusive)
  quietEnd: number | null; // local hour [0-23] quiet window end (exclusive)
}

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  confirmationEnabled: true,
  reminderEnabled: true,
  reviewRequestEnabled: true,
  leadFollowupEnabled: true,
  reminderLeadHours: 24,
  quietStart: null,
  quietEnd: null,
};

/** Fill any missing fields with defaults + clamp to sane ranges. */
export function resolveSmsSettings(
  raw: Partial<SmsSettings> | undefined | null,
): SmsSettings {
  const s = { ...DEFAULT_SMS_SETTINGS, ...(raw ?? {}) };
  s.reminderLeadHours = clampHours(s.reminderLeadHours);
  s.quietStart = clampHourOrNull(s.quietStart);
  s.quietEnd = clampHourOrNull(s.quietEnd);
  // Quiet hours need both endpoints; otherwise treat as disabled.
  if (s.quietStart === null || s.quietEnd === null || s.quietStart === s.quietEnd) {
    s.quietStart = null;
    s.quietEnd = null;
  }
  return s;
}

function clampHours(n: number): number {
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(168, Math.round(n))); // 1h .. 7 days
}
function clampHourOrNull(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const h = Math.round(n);
  return h >= 0 && h <= 23 ? h : null;
}

/** The local hour (0-23) in `timezone` at `nowMs`. Falls back to UTC. */
export function localHour(nowMs: number, timezone: string | null): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? "UTC",
      hour: "numeric",
      hour12: false,
    }).format(new Date(nowMs));
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : new Date(nowMs).getUTCHours();
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

/** Is `nowMs` inside the business's quiet window? Handles overnight ranges
 *  (e.g. 21→8). No quiet hours configured → always false. */
export function inQuietHours(
  nowMs: number,
  timezone: string | null,
  settings: SmsSettings,
): boolean {
  const { quietStart, quietEnd } = settings;
  if (quietStart === null || quietEnd === null) return false;
  const h = localHour(nowMs, timezone);
  return quietStart <= quietEnd
    ? h >= quietStart && h < quietEnd
    : h >= quietStart || h < quietEnd; // wraps past midnight
}
