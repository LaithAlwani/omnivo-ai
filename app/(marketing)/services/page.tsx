import type { Metadata } from "next";
import { Pricing } from "@/components/sections/pricing";
import { Faq } from "@/components/sections/faq";
import { ContactSection } from "@/components/sections/contact-section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Omni AI pricing — Starter, Professional, and Enterprise. An AI assistant that chats, books, and captures leads, from $49/mo. Free trial on every plan.",
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
            One assistant replaces a stack of missed calls and unanswered forms. Start
            on Starter, move up when it&rsquo;s paying for itself many times over.
          </p>
        </div>
      </section>
      <Pricing withHeading={false} />
      <Faq />
      <ContactSection />
    </>
  );
}
