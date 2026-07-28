// -----------------------------------------------------------------------------
// Plan capabilities — the single source of truth for what each tier allows.
// Pure module (no Convex/Node imports) so it's usable from queries, mutations,
// Node actions, and the frontend alike. Enforcement lives at each feature's
// call site; this just defines the limits.
// -----------------------------------------------------------------------------

export type Tier = "starter" | "professional" | "enterprise";

export interface TierLimits {
  /** Monthly widget-conversation cap; null = unlimited. */
  conversationsPerMonth: number | null;
  sms: boolean;
  /** Monthly SMS send cap; 0 when SMS isn't included, null = unlimited. */
  smsPerMonth: number | null;
  whiteLabel: boolean;
  aiEmployees: boolean;
  customEmailDomain: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  starter: {
    conversationsPerMonth: 1000,
    sms: false,
    smsPerMonth: 0,
    whiteLabel: false,
    aiEmployees: false,
    customEmailDomain: false,
  },
  professional: {
    conversationsPerMonth: 10000,
    sms: true,
    smsPerMonth: 1000,
    whiteLabel: true,
    aiEmployees: true,
    customEmailDomain: true,
  },
  enterprise: {
    conversationsPerMonth: null,
    sms: true,
    smsPerMonth: null,
    whiteLabel: true,
    aiEmployees: true,
    customEmailDomain: true,
  },
};

export function tierLimits(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}

/** SMS is a Professional+ feature. */
export function smsEnabled(tier: Tier): boolean {
  return TIER_LIMITS[tier].sms;
}

/** Monthly conversation cap (null = unlimited). */
export function conversationCap(tier: Tier): number | null {
  return TIER_LIMITS[tier].conversationsPerMonth;
}

/** Monthly SMS cap (0 = not included, null = unlimited). */
export function smsCap(tier: Tier): number | null {
  return TIER_LIMITS[tier].smsPerMonth;
}

/** UTC "YYYY-MM" usage period for a timestamp (the month a conversation counts
 *  toward). Callers in queries must pass a time in as an argument rather than
 *  reading the wall clock. */
export function usagePeriod(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
