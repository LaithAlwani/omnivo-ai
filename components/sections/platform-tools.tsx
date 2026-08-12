import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { Icon } from "@/components/ui/icon";
import { tools } from "@/lib/site-config";

const trainedOn = ["Services", "Hours", "Pricing", "Policies", "FAQs", "Locations"];

export function PlatformTools() {
  const featured = tools.find((t) => t.featured)!;
  const rest = tools.filter((t) => !t.featured);

  return (
    <section id="tools" className="section relative scroll-mt-20">
      <div className="shell">
        <SectionHeading
          eyebrow="Connections"
          title={
            <>
              One assistant, <span className="text-molten">driving the tools</span>{" "}
              you already run.
            </>
          }
          lead="Booking, CRM, calendar — Omnivo connects what you already use and acts through it, so the assistant does real work instead of just talking."
        />

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {/* Featured — breaks the grid's uniformity */}
          <Reveal className="lg:col-span-3">
            <article className="group relative overflow-hidden rounded-xl border border-line-strong bg-surface p-8 sm:p-10">
              <div className="glow-ember pointer-events-none absolute -right-20 -top-20 h-64 w-64" />
              <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
                <div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-ember/30 bg-ember-soft text-ember">
                    <Icon name={featured.icon} className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="mt-5 font-display text-3xl text-bone">
                    {featured.name}
                  </h3>
                  <p className="mt-1 font-mono text-xs uppercase tracking-wider text-ember">
                    {featured.tagline}
                  </p>
                  <p className="mt-4 max-w-md text-[0.98rem] leading-relaxed text-muted">
                    {featured.description} It stays inside the guardrails you set and
                    hands off to a human the moment it should.
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-ink/50 p-5">
                  <p className="font-mono text-xs uppercase tracking-wider text-faint">
                    Trained on
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {trainedOn.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-bone-dim"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          </Reveal>

          {/* The rest */}
          {rest.map((tool, i) => (
            <Reveal key={tool.id} delay={0.04 * (i % 3)}>
              <article className="group h-full rounded-xl border border-line bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-ember/40 hover:bg-surface">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-ink/50 text-bone-dim transition-colors group-hover:border-ember/40 group-hover:text-ember">
                  <Icon name={tool.icon} />
                </div>
                <h3 className="mt-5 text-xl text-bone">{tool.name}</h3>
                <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-faint">
                  {tool.tagline}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {tool.description}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
