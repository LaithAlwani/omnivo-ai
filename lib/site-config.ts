import type {
  NavItem,
  Tool,
  ProcessStep,
  Metric,
  ValueProp,
  Plan,
} from "@/lib/types";
import {
  type Tier,
  TIER_LIMITS,
  planPrice,
  includedModules,
  locationLimit,
  creditGrantCents,
  creditsFromCents,
  ADDITIONAL_LOCATION_CENTS,
} from "@/convex/lib/tiers";
import { MODULE_CATALOG } from "@/convex/modules/registry";

// -----------------------------------------------------------------------------
// Omnivo AI — marketing content (Phase M seed).
// In Phase 1 this becomes a template blueprint; per-business content comes from
// Convex. Nothing here is read by the AI at runtime.
// -----------------------------------------------------------------------------

export const company = {
  name: "Omnivo AI",
  eyebrow: "AI that drives the tools you already run",
  heroHeadline: "The AI layer for the tools you already run.",
  heroLead:
    "Omnivo connects the booking, CRM, and calendar tools you already run, then puts a warm, on-brand AI in front of them — answering, booking, and capturing leads. We install and connect it for you.",
  primaryCta: { label: "Book an install call", href: "/book" },
  secondaryCta: { label: "See how it works", href: "/#how" },
} as const;

// In production the portal lives on its own host (app.omnivoai.ca), set via
// NEXT_PUBLIC_APP_URL. When present, portal links point straight at it so
// marketing → portal navigation skips the middleware redirect hop. On localhost
// and previews the var is unset, so links stay relative and path-based.
export const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
export const appHref = (path: string) => `${appBaseUrl}${path}`;

export const nav: NavItem[] = [
  { label: "Connections", href: "/#tools" },
  { label: "How it works", href: "/#how" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

// The one-line proof strip under the hero.
export const heroStats: Metric[] = [
  { value: "24/7", label: "always answering" },
  { value: "0", label: "tools to replace" },
  { value: "1 layer", label: "over your stack" },
];

export const tools: Tool[] = [
  {
    id: "chat",
    name: "AI Assistant",
    tagline: "Trained on your business",
    description:
      "Answers in your voice from your hours, services, and policies — then acts through the tools you already run, not a generic bot.",
    icon: "chat",
    featured: true,
  },
  {
    id: "booking",
    name: "Booking",
    tagline: "Into your scheduler",
    description:
      "Checks real availability and books inside the chat — into your own scheduling system, or Omnivo's Managed calendar as a fallback.",
    icon: "calendar",
  },
  {
    id: "leads",
    name: "Lead Capture",
    tagline: "Nothing slips",
    description:
      "Every enquiry becomes a tracked lead with contact details, source, and follow-up — pushed to the CRM you already use.",
    icon: "leads",
  },
  {
    id: "analytics",
    name: "Analytics",
    tagline: "See what converts",
    description:
      "Conversations, leads, and bookings in one dashboard, so you know what the assistant is earning.",
    icon: "chart",
  },
  {
    id: "connections",
    name: "Connections",
    tagline: "Works with your stack",
    description:
      "Connect your booking system, CRM, and calendar. No system of record yet? Omnivo's Managed engine is the built-in fallback.",
    icon: "plug",
  },
  {
    id: "whitelabel",
    name: "White-label",
    tagline: "Unmistakably yours",
    description:
      "Your logo, colors, and assistant name across the widget, emails, and PDFs.",
    icon: "palette",
  },
];

export const steps: ProcessStep[] = [
  {
    n: "01",
    title: "Connect your systems",
    body: "We audit what you already run — booking, CRM, calendar — and connect it, then load your knowledge. No system of record? The Managed engine is the fallback.",
  },
  {
    n: "02",
    title: "Verify",
    body: "We test every connection end-to-end so the assistant answers and books correctly — before a single visitor sees it.",
  },
  {
    n: "03",
    title: "Go live",
    body: "You approve, we flip it on. The assistant runs on your domain, under your brand, driving your tools 24/7 — and hands off to a human when it should.",
  },
];

export const valueProps: ValueProp[] = [
  {
    title: "Never miss after hours",
    body: "Most enquiries arrive when you're closed. The assistant answers and books at 2am the same way it does at 2pm.",
    icon: "bolt",
  },
  {
    title: "Answers from your business",
    body: "Grounded in your own knowledge base, so it quotes your prices and your policies — not a hallucination.",
    icon: "shield",
  },
  {
    title: "Works with your stack",
    body: "Your booking system, your CRM, your calendar. Omnivo drives the tools you already run — nothing to rip out or migrate to.",
    icon: "plug",
  },
  {
    title: "Lives on your domain",
    body: "The widget runs on your site under your brand. Customers never leave, and never see ours.",
    icon: "globe",
  },
];

// -----------------------------------------------------------------------------
// Pricing — derived from the app's single source of truth (convex/lib/tiers +
// the module registry) so marketing can't drift from what the product enforces.
// Model: two paths. Self-setup runs on a published monthly tier (shown here);
// an installed deployment adds a per-project quote (setup + monthly) — "book a
// call", not listed. Connector modules are bundled into every tier.
// -----------------------------------------------------------------------------

// AI-credit copy, derived from the single source. Credits are a whole-number
// balance the AI draws down as it works — never shown in dollars. e.g.
// "1,500 AI credits / mo".
function creditBullet(key: Tier): string {
  return `${creditsFromCents(creditGrantCents(key)!).toLocaleString()} AI credits / mo`;
}

// Curated per-tier feature bullets for the /plans/[slug] detail pages. Prices
// come from planPrice() so there's exactly one price source.
export const plans: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    kind: "platform",
    price: `$${planPrice("starter")}`,
    cadence: "/mo",
    blurb: "One AI assistant that books, captures leads, and drives your tools for a single location.",
    features: [
      "Booking + Lead Capture + Connections",
      "1 location",
      creditBullet("starter"),
    ],
    cta: "Get started",
  },
  {
    slug: "professional",
    name: "Professional",
    kind: "platform",
    price: `$${planPrice("professional")}`,
    cadence: "/mo",
    blurb: "More locations and a bigger monthly AI-credit balance.",
    features: [
      "Everything in Starter",
      "2 locations",
      creditBullet("professional"),
    ],
    cta: "Get started",
  },
  {
    slug: "premium",
    name: "Premium",
    kind: "platform",
    price: `$${planPrice("premium")}`,
    cadence: "/mo",
    blurb: "The full toolkit — white-label, custom domain, 5 locations.",
    features: [
      "Everything in Professional",
      "White-label + custom email domain",
      "5 locations",
      creditBullet("premium"),
    ],
    featured: true,
    cta: "Get started",
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    kind: "platform",
    price: "Custom",
    cadence: "",
    blurb: "For multi-location businesses and agencies reselling the platform.",
    features: [
      "Everything in Premium",
      "Unlimited locations & usage",
      "Usage-based pricing",
      "Priority support & SLA",
    ],
    cta: "Talk to us",
  },
];

// The three paid tiers, fully derived — powers the comparison matrix + toggles.
const PAID_TIERS = ["starter", "professional", "premium"] as const;

export const pricingTiers = PAID_TIERS.map((key) => ({
  key,
  name: key.charAt(0).toUpperCase() + key.slice(1),
  monthly: planPrice(key)!,
  locations: locationLimit(key)!,
  // AI credits — a monthly credit balance the AI draws down as it works.
  credits: creditsFromCents(creditGrantCents(key)!),
  whiteLabel: TIER_LIMITS[key].whiteLabel,
  modules: new Set(includedModules(key)),
  featured: key === "premium",
}));

// Matrix rows: one per module, from the registry (name is the single source).
export const pricingModules = MODULE_CATALOG.map((m) => ({
  key: m.key,
  name: m.name,
}));

export const additionalLocationPrice = ADDITIONAL_LOCATION_CENTS / 100;

