import type {
  NavItem,
  Tool,
  ProcessStep,
  Metric,
  ValueProp,
  Plan,
} from "@/lib/types";

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

export const plans: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    kind: "platform",
    price: "$99",
    cadence: "/mo",
    blurb: "One AI employee for a single site — add skills as you grow.",
    features: [
      "1 project · 1 location",
      "2,500 conversations / mo",
      "2,500 emails / mo",
      "Chat, knowledge & basic lead capture",
      "Add modules à la carte",
    ],
    cta: "Start free trial",
  },
  {
    slug: "professional",
    name: "Professional",
    kind: "platform",
    price: "$249",
    cadence: "/mo",
    blurb: "More projects, higher limits, and your brand front and center.",
    features: [
      "Up to 3 projects · 3 locations each",
      "10,000 conversations / mo",
      "10,000 emails / mo",
      "White-label + custom email domain",
      "Priority support",
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
      "Everything in Professional",
      "More projects & locations",
      "Usage-based pricing",
      "Priority support & SLA",
      "All modules available",
    ],
    cta: "Talk to us",
  },
];

// Add-on modules — the skills the one AI employee can gain. Shown as a grid
// beneath the base plans. `price` is USD/mo, stacked on any base plan.
export const addOnModules = [
  {
    name: "Booking Assistant",
    price: 49,
    blurb: "Live availability + booking, Google Calendar, confirmations.",
  },
  {
    name: "Lead Capture & Qualification",
    price: 15,
    blurb: "Qualifying questions, intent detection, owner alerts.",
  },
  {
    name: "SMS Automation",
    price: 49,
    blurb: "Reminders, follow-ups, and review texts — includes an SMS allowance.",
  },
  {
    name: "Review Management",
    price: 29,
    blurb: "Ask happy customers for reviews; catch unhappy ones privately.",
  },
  {
    name: "Sales Assistant",
    price: 49,
    blurb: "Qualify, book, follow up, and flag hot leads — end to end.",
  },
  {
    name: "Integrations",
    price: 49,
    blurb: "Connect your own booking system or CRM (sync out + lookup in).",
  },
] as const;

// Metered overage once you pass a plan's monthly allowance.
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
