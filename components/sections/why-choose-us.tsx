import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { Icon } from "@/components/ui/icon";
import { valueProps } from "@/lib/site-config";

export function WhyChooseUs() {
  return (
    <section className="section relative">
      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              eyebrow="Why it works"
              title={
                <>
                  Built to <span className="text-molten">earn its keep</span>.
                </>
              }
              lead="An assistant is only worth having if it does the things a great front-desk hire would — inside the tools you already run. This one does, and it never clocks out."
            />
          </div>

          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {valueProps.map((v, i) => (
              <Reveal key={v.title} delay={0.05 * i} className="h-full">
                <div className="group flex h-full flex-col bg-ink p-7 transition-colors hover:bg-surface/60">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong text-ember">
                    <Icon name={v.icon} />
                  </div>
                  <h3 className="mt-5 text-lg text-bone">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{v.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
