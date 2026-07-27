import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Book a demo",
  description:
    "See Omni AI answer, book, and capture a lead with your own business. A fifteen-minute walkthrough.",
};

// Phase M placeholder. The real booking flow (calendar + slots) ships in Phase 2.
export default function BookPage() {
  return (
    <section className="section flex min-h-[70vh] items-center pt-32 sm:pt-40">
      <div className="shell max-w-2xl text-center">
        <span className="eyebrow">Book a demo</span>
        <h1 className="mt-5 text-4xl leading-[1.05] sm:text-5xl">
          Let&rsquo;s watch it work on <span className="text-molten">your</span>{" "}
          business.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-muted">
          Fifteen minutes: we&rsquo;ll connect a sample of your knowledge and let the
          assistant answer, book, and capture a lead live. Tell us where to reach you.
        </p>
        <form className="mx-auto mt-10 flex max-w-md flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@business.com"
            className="h-12 rounded-full border border-line-strong bg-surface px-5 text-sm text-bone placeholder:text-faint focus-visible:border-ember"
          />
          <Button href="/book" size="lg" className="w-full">
            Request a demo
          </Button>
        </form>
        <p className="mt-5 font-mono text-xs text-faint">
          We&rsquo;ll reply within one business day.
        </p>
      </div>
    </section>
  );
}
