import type {
  NavItem,
  Tool,
  ProcessStep,
  Metric,
  ValueProp,
  Plan,
} from "@/lib/types";
import {
  TIER_LIMITS,
  planPrice,
  foundingPrice,
  annualMonthlyPrice,
  includedModules,
  locationLimit,
  conversationCap,
  emailCap,
  smsCap,
  FOUNDING_SLOTS,
  FOUNDING_DISCOUNT_PCT,
  ANNUAL_MONTHS_FREE,
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
  eyebrow: "The AI engine for small business",
  heroHeadline: "An assistant that answers, books, and captures leads.",
  heroLead:
    "Paste one snippet on your site and a warm, on-brand AI goes live — handling questions, filling your calendar, and never letting a lead go cold.",
  primaryCta: { label: "Book a demo", href: "/book" },
  secondaryCta: { label: "See how it works", href: "/#how" },
} as const;

// In production the portal lives on its own host (app.omnivoai.ca), set via
// NEXT_PUBLIC_APP_URL. When present, portal links point straight at it so
// marketing → portal navigation skips the middleware redirect hop. On localhost
// and previews the var is unset, so links stay relative and path-based.
export const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
export const appHref = (path: string) => `${appBaseUrl}${path}`;

export const nav: NavItem[] = [
  { label: "Platform", href: "/#tools" },
  { label: "How it works", href: "/#how" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

// The one-line proof strip under the hero.
export const heroStats: Metric[] = [
  { value: "60s", label: "to go live" },
  { value: "24/7", label: "always answering" },
  { value: "1 snippet", label: "to install" },
];

export const tools: Tool[] = [
  {
    id: "chat",
    name: "AI Chat",
    tagline: "Trained on your business",
    description:
      "Answers questions in your voice from your hours, services, and policies — not a generic bot.",
    icon: "chat",
    featured: true,
  },
  {
    id: "booking",
    name: "Booking",
    tagline: "Fills the calendar",
    description:
      "Checks real availability and books the appointment inside the chat. Syncs to Google Calendar.",
    icon: "calendar",
  },
  {
    id: "leads",
    name: "Lead Capture",
    tagline: "Nothing slips",
    description:
      "Every enquiry becomes a tracked lead with contact details, source, and follow-up.",
    icon: "leads",
  },
  {
    id: "messaging",
    name: "Email & SMS",
    tagline: "Follows up for you",
    description:
      "Confirmations, reminders, and follow-ups sent automatically — by email and text.",
    icon: "mail",
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
    id: "modules",
    name: "Modular skills",
    tagline: "One employee, more skills",
    description:
      "Switch on Booking, SMS, Reviews, Sales, or Integrations — your assistant gains the skill instantly.",
    icon: "employees",
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
    title: "Connect your knowledge",
    body: "Add your services, hours, pricing, and FAQs. The assistant learns your business in minutes — no training data, no prompt engineering.",
  },
  {
    n: "02",
    title: "Paste one snippet",
    body: "Drop a single <script> tag on your site. The assistant appears as a floating bubble, themed to match your brand.",
  },
  {
    n: "03",
    title: "Go live",
    body: "It starts answering, booking, and capturing leads the moment it loads — and hands off to you when a human is needed.",
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
    body: "Google Calendar, your email, your number. It plugs into the tools you already run the business on.",
    icon: "plug",
  },
  {
    title: "Lives on your domain",
    body: "The widget runs on your site under your brand. Customers never leave, and never see ours.",
    icon: "globe",
  },
];

// The embed snippet shown in the "how it works" section.
export const embedSnippet = `<script
  src="https://omnivoai.ca/widget.js"
  data-embed-key="pk_live_7f3a...">
</script>`;

// -----------------------------------------------------------------------------
// Pricing — derived from the app's single source of truth (convex/lib/tiers +
// the module registry) so marketing can't drift from what the product enforces.
// Model: one AI employee on a bundled tier; modules are included per tier (no
// à-la-carte). Founding Partner = first 10 accounts at 50% off, locked in.
// -----------------------------------------------------------------------------

// Curated per-tier feature bullets for the /plans/[slug] detail pages. Prices
// come from planPrice() so there's exactly one price source.
export const plans: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    kind: "platform",
    price: `$${planPrice("starter")}`,
    cadence: "/mo",
    blurb: "One AI employee that books, texts, and captures leads for a single location.",
    features: [
      "Booking + Lead Capture + SMS",
      "1 location",
      `${conversationCap("starter")!.toLocaleString()} conversations / mo`,
      `${smsCap("starter")!.toLocaleString()} SMS / mo`,
    ],
    cta: "Start free trial",
  },
  {
    slug: "professional",
    name: "Professional",
    kind: "platform",
    price: `$${planPrice("professional")}`,
    cadence: "/mo",
    blurb: "Adds SMS + reviews and a second location.",
    features: [
      "Everything in Starter",
      "+ Review Management + SMS Automation",
      "2 locations",
      `${conversationCap("professional")!.toLocaleString()} conversations / mo`,
      `${smsCap("professional")!.toLocaleString()} SMS / mo`,
    ],
    cta: "Start free trial",
  },
  {
    slug: "premium",
    name: "Premium",
    kind: "platform",
    price: `$${planPrice("premium")}`,
    cadence: "/mo",
    blurb: "The full toolkit — sales, integrations, white-label, 5 locations.",
    features: [
      "Everything in Professional",
      "+ Sales Assistant + Integrations",
      "White-label + custom email domain",
      "5 locations",
      `${conversationCap("premium")!.toLocaleString()} conversations / mo`,
    ],
    featured: true,
    cta: "Start free trial",
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
  founding: foundingPrice(key)!,
  annualMonthly: annualMonthlyPrice(key)!,
  locations: locationLimit(key)!,
  conversations: conversationCap(key)!,
  emails: emailCap(key)!,
  sms: smsCap(key)!,
  whiteLabel: TIER_LIMITS[key].whiteLabel,
  modules: new Set(includedModules(key)),
  featured: key === "premium",
}));

// Matrix rows: one per module, from the registry (name is the single source).
export const pricingModules = MODULE_CATALOG.map((m) => ({
  key: m.key,
  name: m.name,
}));

export const foundingInfo = {
  slots: FOUNDING_SLOTS,
  discountPct: FOUNDING_DISCOUNT_PCT,
};
export const annualInfo = { monthsFree: ANNUAL_MONTHS_FREE };
export const additionalLocationPrice = ADDITIONAL_LOCATION_CENTS / 100;

// Metered overage once you pass a plan's monthly allowance (founders too).
export const overageRates = [
  { label: "Conversations", rate: "$10 / 1,000" },
  { label: "Emails", rate: "$5 / 1,000" },
  { label: "SMS", rate: "$10 / 100" },
] as const;

export const seo = {
  title:
    "Omnivo AI — an AI assistant that chats, books, and captures leads",
  description:
    "Deploy an AI assistant that answers questions, books appointments, and captures leads on your site. Paste one snippet — it goes live in minutes.",
};
