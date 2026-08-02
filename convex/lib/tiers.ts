import type { ModuleKey, Entitlements } from "../modules/registry";
import { DEFAULT_ENTITLEMENTS } from "../modules/registry";

// -----------------------------------------------------------------------------
// Plan capabilities — the single source of truth for what each base plan allows
// and costs. The plan lives on the ACCOUNT (the owner); its allowances are
// POOLED across the account's business, and its modules are bundled per tier.
// Pure module (no Convex/Node imports beyond the pure registry) so it's usable
// from queries, mutations, Node actions, and the frontend alike.
//
// Model: Account → one Business → many Locations. Locations are the sold/billable
// unit (`locationLimit`); projects are gone (one business per account).
// A `null` limit means unlimited/custom (Enterprise).
// -----------------------------------------------------------------------------

export type Tier = "starter" | "professional" | "premium" | "enterprise";
/** The account's base subscription plan. */
export type Plan = Tier;

/** How a subscription is billed. */
export type Cadence = "monthly" | "annual";

export interface TierLimits {
  /** Regular monthly price in USD (null = custom/Enterprise). */
  priceMonthly: number | null;
  /** Modules bundled into this tier (all others locked). */
  includedModules: ModuleKey[];
  /** Pooled monthly conversation allowance for the business. */
  conversationsPerMonth: number | null;
  /** Pooled monthly email allowance. */
  emailsPerMonth: number | null;
  /** Pooled monthly SMS allowance (0 = SMS not included on this tier). */
  smsPerMonth: number | null;
  /** Locations included with the plan; extras are billed per location. */
  locationLimit: number | null;
  whiteLabel: boolean;
  customEmailDomain: boolean;
}

const ALL_MODULES: ModuleKey[] = [
  "booking",
  "leadQualification",
  "smsAutomation",
  "reviewManagement",
  "salesAssistant",
  "integrations",
];

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  starter: {
    priceMonthly: 299,
    includedModules: ["booking", "leadQualification", "smsAutomation"],
    conversationsPerMonth: 2500,
    emailsPerMonth: 2500,
    smsPerMonth: 100,
    locationLimit: 1,
    whiteLabel: false,
    customEmailDomain: false,
  },
  professional: {
    priceMonthly: 449,
    includedModules: [
      "booking",
      "leadQualification",
      "reviewManagement",
      "smsAutomation",
    ],
    conversationsPerMonth: 5000,
    emailsPerMonth: 5000,
    smsPerMonth: 500,
    locationLimit: 2,
    whiteLabel: false,
    customEmailDomain: false,
  },
  premium: {
    priceMonthly: 499,
    includedModules: ALL_MODULES,
    conversationsPerMonth: 15000,
    emailsPerMonth: 15000,
    smsPerMonth: 1500,
    locationLimit: 5,
    whiteLabel: true,
    customEmailDomain: true,
  },
  enterprise: {
    priceMonthly: null,
    includedModules: ALL_MODULES,
    conversationsPerMonth: null,
    emailsPerMonth: null,
    smsPerMonth: null,
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

/** Monthly SMS cap (0 = not included, null = unlimited). The SMS Automation
 *  module still gates whether a project may send at all. */
export function smsCap(plan: Plan): number | null {
  return TIER_LIMITS[plan].smsPerMonth;
}

/** Locations included with the plan (null = unlimited). Extras are billed. */
export function locationLimit(plan: Plan): number | null {
  return TIER_LIMITS[plan].locationLimit;
}

/** Projects per account — always 1 now (one business per account). Kept for the
 *  single legacy call site. */
export function projectLimit(_plan: Plan): number | null {
  return 1;
}

/** White-label (remove Omnivo attribution) — Premium and up. */
export function whiteLabelEnabled(plan: Plan): boolean {
  return TIER_LIMITS[plan].whiteLabel;
}

/** Custom sending domain (Resend-verified) — Premium and up. */
export function customEmailDomainEnabled(plan: Plan): boolean {
  return TIER_LIMITS[plan].customEmailDomain;
}

// --- Modules bundled per tier ------------------------------------------------

/** The modules a plan includes. */
export function includedModules(plan: Plan): ModuleKey[] {
  return TIER_LIMITS[plan].includedModules;
}

/** The cheapest plan that includes a module (for "upgrade to X" prompts). */
export function firstPlanWithModule(module: ModuleKey): Plan {
  const order: Plan[] = ["starter", "professional", "premium", "enterprise"];
  for (const plan of order) {
    if (includedModules(plan).includes(module)) return plan;
  }
  return "enterprise";
}

/** The entitlements a plan grants — every included module on, the rest off.
 *  Seeded on provision and re-synced on plan change. */
export function entitlementsForPlan(plan: Plan): Entitlements {
  const e: Entitlements = { ...DEFAULT_ENTITLEMENTS };
  for (const key of includedModules(plan)) {
    e[`${key}Enabled` as keyof Entitlements] = true;
  }
  return e;
}

// --- Pricing (regular / founding / annual) ----------------------------------

/** Extra location add-on, in cents ($19.99/mo). */
export const ADDITIONAL_LOCATION_CENTS = 1999;

/** Founding Partner program: first N accounts get a locked-in discount. */
export const FOUNDING_SLOTS = 10;
export const FOUNDING_DISCOUNT_PCT = 50;

/** Annual commitment: 12-month term, 2 months free, billed monthly. */
export const ANNUAL_MONTHS_FREE = 2;
export const ANNUAL_TERM_MONTHS = 12;

/** Regular monthly price in USD (null = custom/Enterprise). */
export function planPrice(plan: Plan): number | null {
  return TIER_LIMITS[plan].priceMonthly;
}

/** Founding Partner monthly price in USD (50% off; null for Enterprise). */
export function foundingPrice(plan: Plan): number | null {
  const p = planPrice(plan);
  return p === null ? null : Math.round((p * (100 - FOUNDING_DISCOUNT_PCT)) / 100);
}

/** Effective monthly price on the annual plan (2 months free → ×10/12). */
export function annualMonthlyPrice(plan: Plan): number | null {
  const p = planPrice(plan);
  return p === null
    ? null
    : Math.round((p * (ANNUAL_TERM_MONTHS - ANNUAL_MONTHS_FREE)) / ANNUAL_TERM_MONTHS);
}

/** The monthly amount actually charged, in cents. Founding wins over cadence;
 *  founding is a monthly program, so the two don't stack. */
export function effectiveMonthlyCents(
  plan: Plan,
  opts: { founding?: boolean; cadence?: Cadence } = {},
): number | null {
  const dollars = opts.founding
    ? foundingPrice(plan)
    : opts.cadence === "annual"
      ? annualMonthlyPrice(plan)
      : planPrice(plan);
  return dollars === null ? null : dollars * 100;
}

// --- Overage accounting -----------------------------------------------------
// Once a pooled allowance is exceeded, extra units are metered at these rates.
// Charging is activated with billing (Stripe slice); until then this surfaces
// the overage so tenants see it coming. Overage applies to founders too.

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
