import Link from "next/link";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { plans, addOnModules, overageRates } from "@/lib/site-config";

export function Pricing({ withHeading = true }: { withHeading?: boolean }) {
  return (
    <section id="pricing" className="section relative scroll-mt-20">
      <div className="shell">
        {withHeading && (
          <SectionHeading
            align="center"
            eyebrow="Pricing"
            title={
              <>
                Pick a tier. <span className="text-molten">Scale</span> when it pays
                off.
              </>
            }
            lead="Every plan starts with a free trial. No setup fees, cancel anytime."
            className="mx-auto"
          />
        )}

        <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.slug} delay={0.07 * i} className="h-full">
              <article
                className={`relative flex h-full flex-col rounded-xl border p-7 ${
                  plan.featured
                    ? "border-ember/50 bg-surface shadow-[0_30px_90px_-40px_rgba(255,92,26,0.5)]"
                    : "border-line bg-surface/50"
                }`}
              >
                {plan.featured && (
                  <>
                    <div className="glow-ember pointer-events-none absolute inset-x-0 -top-10 h-24" />
                    <span className="absolute -top-3 left-7 rounded-full bg-ember px-3 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-[#160b04]">
                      Most popular
                    </span>
                  </>
                )}

                <h3 className="font-display text-2xl text-bone">{plan.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{plan.blurb}</p>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-4xl text-bone">{plan.price}</span>
                  <span className="font-mono text-sm text-faint">{plan.cadence}</span>
                </div>

                <Button
                  href={plan.slug === "enterprise" ? "/book" : "/book"}
                  variant={plan.featured ? "primary" : "ghost"}
                  size="md"
                  className="mt-6 w-full"
                >
                  {plan.cta}
                </Button>

                <ul className="mt-7 space-y-3 border-t border-line pt-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-3 text-sm text-bone-dim">
                      <svg
                        viewBox="0 0 16 16"
                        className="mt-0.5 h-4 w-4 shrink-0 text-ember"
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

                <Link
                  href={`/plans/${plan.slug}`}
                  className="mt-6 font-mono text-xs text-faint transition-colors hover:text-ember"
                >
                  View {plan.name} details →
                </Link>
              </article>
            </Reveal>
          ))}
        </div>

        {/* Add-on modules — the skills the one AI employee can gain. */}
        <div className="mt-16">
          <h3 className="text-center font-display text-2xl text-bone">
            One employee. <span className="text-molten">Add the skills</span> you
            need.
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
            Every plan is one AI employee. Switch on modules to give it new
            skills — they stack on any base plan.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {addOnModules.map((m, i) => (
              <Reveal key={m.name} delay={0.05 * i} className="h-full">
                <div className="flex h-full flex-col rounded-xl border border-line bg-surface/40 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-display text-lg text-bone">{m.name}</h4>
                    <span className="font-mono text-sm text-ember">+${m.price}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{m.blurb}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Overage — metered once you pass a plan's allowance. */}
        <div className="mx-auto mt-12 max-w-xl rounded-xl border border-line bg-surface/40 p-6">
          <div className="text-center font-mono text-xs uppercase tracking-wider text-faint">
            If you go over your monthly allowance
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {overageRates.map((o) => (
              <div key={o.label} className="text-center">
                <div className="font-display text-lg text-bone">{o.rate}</div>
                <div className="mt-0.5 text-xs text-faint">{o.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
