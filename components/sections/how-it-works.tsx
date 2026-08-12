import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { steps } from "@/lib/site-config";

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-20 border-y border-line bg-ink-2">
      {/* Diagonal ember seam cutting across the band */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -inset-x-40 top-1/2 h-px -translate-y-1/2 -rotate-3 bg-linear-to-r from-transparent via-ember/30 to-transparent" />
      </div>

      <div className="shell section relative">
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              We connect your systems and go{" "}
              <span className="text-molten">live</span> for you.
            </>
          }
          lead="No rip-and-replace, no migration. We audit the tools you already run, connect them, verify every path, and ship — you approve go-live."
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {steps.map((step, i) => (
            <Reveal key={step.n} delay={0.08 * i}>
              <div className="relative h-full rounded-xl border border-line bg-surface/50 p-6">
                <span className="font-mono text-sm text-ember">{step.n}</span>
                <span
                  aria-hidden
                  className="ml-3 align-middle font-mono text-xs text-faint"
                >
                  / 03
                </span>
                <h3 className="mt-4 text-xl text-bone">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
