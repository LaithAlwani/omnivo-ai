import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { company, appHref } from "@/lib/site-config";

export function ContactSection() {
  return (
    <section id="contact" className="relative overflow-hidden">
      <div className="shell section">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-line-strong bg-surface px-6 py-16 text-center sm:px-16 sm:py-24">
            {/* the engine, running hot, behind the CTA */}
            <div aria-hidden className="bg-grid mask-radial pointer-events-none absolute inset-0 opacity-40" />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-ember/20 blur-[110px]"
            />

            <div className="relative mx-auto max-w-2xl">
              <span className="eyebrow">Get started</span>
              <h2 className="mt-5 text-4xl leading-[1.05] sm:text-6xl">
                Put your front desk <span className="text-molten">on autopilot</span>.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-muted">
                See it answer, book, and capture a lead with your own business in the
                driver&rsquo;s seat. It takes fifteen minutes.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Button href={company.primaryCta.href} size="lg">
                  {company.primaryCta.label}
                </Button>
                <Button href={appHref("/dashboard")} variant="ghost" size="lg">
                  Start free trial
                </Button>
              </div>
              <p className="mt-6 font-mono text-xs text-faint">
                No credit card · Live in minutes · Cancel anytime
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
