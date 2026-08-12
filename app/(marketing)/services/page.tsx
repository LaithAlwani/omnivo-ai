import type { Metadata } from "next";
import { Pricing } from "@/components/sections/pricing";
import { Faq } from "@/components/sections/faq";
import { ContactSection } from "@/components/sections/contact-section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Omnivo AI pricing — set it up yourself from $299/mo across three tiers (Starter, Professional, Premium), or have us install and connect it for you on a per-project quote.",
};

export default function ServicesPage() {
  return (
    <>
      <section className="section pt-32 sm:pt-40">
        <div className="shell max-w-3xl">
          <span className="eyebrow flex items-center gap-2.5">
            <span className="h-px w-6 bg-ember/70" />
            Plans &amp; pricing
          </span>
          <h1 className="mt-5 text-5xl leading-[1.03] sm:text-6xl">
            Pricing that <span className="text-molten">tracks the value</span>, not the
            headcount.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            One assistant replaces a stack of missed calls and unanswered forms. Set
            it up yourself on a monthly plan, or have us install and connect it for
            you — move up a tier when it&rsquo;s paying for itself many times over.
          </p>
        </div>
      </section>
      <Pricing withHeading={false} />
      <Faq />
      <ContactSection />
    </>
  );
}
