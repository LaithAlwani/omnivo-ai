import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ContactSection } from "@/components/sections/contact-section";
import { plans } from "@/lib/site-config";

// Per-slug SEO copy. Mirrors the pattern Phase 1 keeps when plans move to Convex.
const PLAN_SEO: Record<string, { title: string; description: string }> = {
  starter: {
    title: "Starter plan",
    description:
      "Omni AI Starter — an AI assistant with chat, booking, and lead capture for a single site. $49/mo, free trial.",
  },
  professional: {
    title: "Professional plan",
    description:
      "Omni AI Professional — SMS follow-ups, AI Employees, and white-label branding for growing teams. $149/mo, free trial.",
  },
  enterprise: {
    title: "Enterprise plan",
    description:
      "Omni AI Enterprise — multi-location teams, per-employee calendars, and usage-based pricing. Talk to us.",
  },
};

export function generateStaticParams() {
  return plans.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const seo = PLAN_SEO[slug];
  if (!seo) return {};
  return { title: seo.title, description: seo.description };
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = plans.find((p) => p.slug === slug);
  if (!plan) notFound();

  return (
    <>
      <section className="section pt-32 sm:pt-40">
        <div className="shell grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-start">
          <div>
            <Link
              href="/services"
              className="font-mono text-xs text-faint transition-colors hover:text-ember"
            >
              ← All plans
            </Link>
            <h1 className="mt-5 font-display text-5xl text-bone sm:text-6xl">
              {plan.name}
            </h1>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
              {plan.blurb}
            </p>
            <div className="mt-8 flex items-baseline gap-1.5">
              <span className="font-display text-5xl text-bone">{plan.price}</span>
              <span className="font-mono text-sm text-faint">{plan.cadence}</span>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/book" size="lg">
                {plan.cta}
              </Button>
              <Button href="/#tools" variant="ghost" size="lg">
                Explore the platform
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-line-strong bg-surface p-8">
            <h2 className="font-mono text-xs uppercase tracking-wider text-faint">
              What&rsquo;s included
            </h2>
            <ul className="mt-6 space-y-4">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-3 text-[0.95rem] text-bone-dim">
                  <svg
                    viewBox="0 0 16 16"
                    className="mt-1 h-4 w-4 shrink-0 text-ember"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                  >
                    <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <ContactSection />
    </>
  );
}
