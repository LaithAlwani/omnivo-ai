// -----------------------------------------------------------------------------
// Plan capabilities — the single source of truth for what each base plan allows.
// The plan lives on the ACCOUNT (the owner); its allowances are POOLED across
// every project (business) the account owns. Pure module (no Convex/Node
// imports) so it's usable from queries, mutations, Node actions, and the
// frontend alike. Enforcement lives at each feature's call site; this just
// defines the limits.
//
// A `null` limit means unlimited/custom (Enterprise).
// -----------------------------------------------------------------------------

export type Tier = "starter" | "professional" | "enterprise";
/** The account's base subscription plan. Same levels as the legacy tier. */
export type Plan = Tier;

export interface TierLimits {
  /** Pooled monthly conversation allowance across the account's projects. */
  conversationsPerMonth: number | null;
  /** Pooled monthly email allowance. */
  emailsPerMonth: number | null;
  /** Pooled monthly SMS allowance (only projects with the SMS Automation module
   *  can draw from it). Scales with the base plan. */
  smsPerMonth: number | null;
  /** Max projects (businesses) the account may create; null = unlimited. */
  projectLimit: number | null;
  /** Max locations per project; null = unlimited. */
  locationLimit: number | null;
  whiteLabel: boolean;
  customEmailDomain: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  starter: {
    conversationsPerMonth: 2500,
    emailsPerMonth: 2500,
    smsPerMonth: 300,
    projectLimit: 1,
    locationLimit: 1,
    whiteLabel: false,
    customEmailDomain: false,
  },
  professional: {
    conversationsPerMonth: 10000,
    emailsPerMonth: 10000,
    smsPerMonth: 1000,
    projectLimit: 3,
    locationLimit: 3,
    whiteLabel: true,
    customEmailDomain: true,
  },
  enterprise: {
    conversationsPerMonth: null,
    emailsPerMonth: null,
    smsPerMonth: null,
    projectLimit: null,
    locationLimit: null,
    whiteLabel: true,
    customEmailDomain: true,
  },
};

export function tierLimits(plan: Plan): TierLimits {
  return TIER_LIMITS[plan];
}

/** Monthly conversation cap (null = unlimited). */
export function conversationCap(plan: Plan): number | null {
  return TIER_LIMITS[plan].conversationsPerMonth;
}

/** Monthly email cap (null = unlimited). */
export function emailCap(plan: Plan): number | null {
  return TIER_LIMITS[plan].emailsPerMonth;
}

/** Monthly SMS cap (null = unlimited). The SMS Automation module gates whether a
 *  project may send at all; this is the pooled account allowance it draws from. */
export function smsCap(plan: Plan): number | null {
  return TIER_LIMITS[plan].smsPerMonth;
}

/** Max projects for the plan (null = unlimited). */
export function projectLimit(plan: Plan): number | null {
  return TIER_LIMITS[plan].projectLimit;
}

/** Max locations per project for the plan (null = unlimited). */
export function locationLimit(plan: Plan): number | null {
  return TIER_LIMITS[plan].locationLimit;
}

/** White-label (remove Omnivo attribution) — Professional and up. */
export function whiteLabelEnabled(plan: Plan): boolean {
  return TIER_LIMITS[plan].whiteLabel;
}

/** Custom sending domain (bring-your-own SMTP) — Professional and up. */
export function customEmailDomainEnabled(plan: Plan): boolean {
  return TIER_LIMITS[plan].customEmailDomain;
}

// --- Overage accounting -----------------------------------------------------
// Once a pooled allowance is exceeded, extra units are metered at these rates.
// Charging is activated with billing (Stripe slice); until then this surfaces
// the overage so tenants see it coming.

export type MeteredUnit = "conversations" | "emails" | "sms";

/** Cents charged per block of units past the cap, and the block size. */
export const OVERAGE_RATES: Record<
  MeteredUnit,
  { per: number; cents: number }
> = {
  conversations: { per: 1000, cents: 1000 }, // $10 / 1,000
  emails: { per: 1000, cents: 500 }, // $5 / 1,000
  sms: { per: 100, cents: 1000 }, // $10 / 100
};

/** Units used beyond the cap (0 when under, or when the plan is unlimited). */
export function overageUnits(used: number, cap: number | null): number {
  if (cap === null) return 0;
  return Math.max(0, used - cap);
}

/** Estimated overage cost in cents for `units` of a metered unit (billed per
 *  block, rounded up). */
export function overageCostCents(unit: MeteredUnit, units: number): number {
  if (units <= 0) return 0;
  const { per, cents } = OVERAGE_RATES[unit];
  return Math.ceil(units / per) * cents;
}

/** UTC "YYYY-MM" usage period for a timestamp (the month a unit counts toward).
 *  Callers in queries must pass a time in as an argument rather than reading the
 *  wall clock. */
export function usagePeriod(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
