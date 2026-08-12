import type { Metadata } from "next";
import { Reveal } from "@/components/ui/reveal";
import { DemoRequestForm } from "@/components/sections/demo-request-form";

export const metadata: Metadata = {
  title: "Book an install call",
  description:
    "We audit the tools you already run, connect them to Omnivo, and go live for you. Book a short call to scope your install.",
};

// The demo form talks to Convex through the no-auth public client, which is
// constructed from NEXT_PUBLIC_CONVEX_URL. Render this page per-request rather
// than prerendering it at build so a build without that env can't crash here —
// every other consumer of that client is request-time (dynamic) too.
export const dynamic = "force-dynamic";

// What the requester actually gets — reassurance next to the form.
const perks = [
  {
    title: "A short scoping call",
    body: "We map the tools you already run — booking, CRM, calendar — and how the assistant will drive them. No rip-and-replace.",
  },
  {
    title: "We install, connect & verify",
    body: "We wire up your systems, load your knowledge, and test every path end-to-end — so it works before a single visitor sees it.",
  },
  {
    title: "You approve, we go live",
    body: "Tell us where to reach you and we'll line up a time. You sign off; the assistant goes live on your domain, under your brand.",
  },
];

function CheckIcon() {
  return (
    <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-ember/30 bg-ember-soft text-flare">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function BookPage() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-28">
      {/* Ambient machined grid + ember heat, faded at the edges */}
      <div aria-hidden className="bg-grid mask-radial pointer-events-none absolute inset-0 opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-12%] h-[38rem] w-[38rem] rounded-full bg-ember/10 blur-[130px]"
      />

      <div className="shell relative">
        <div className="grid items-start gap-14 lg:grid-cols-[1fr_1fr] lg:gap-16">
          {/* Left — the editorial pitch */}
          <div className="max-w-xl">
            <Reveal>
              <span className="eyebrow inline-flex items-center gap-2.5 rounded-full border border-line px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" />
                Book an install call
              </span>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="mt-6 text-[2.6rem] leading-[1.03] tracking-tight sm:text-5xl">
                Let&rsquo;s wire it into{" "}
                <span className="text-molten">your</span> stack.
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
                A short call to scope your install — we connect the tools you already
                run, verify every path, and go live for you.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <ul className="mt-10 flex flex-col gap-6 border-t border-line pt-8">
                {perks.map((p) => (
                  <li key={p.title} className="flex gap-4">
                    <CheckIcon />
                    <div>
                      <p className="font-medium text-bone">{p.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{p.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Right — the form, in a machined panel running hot */}
          <Reveal delay={0.12} className="lg:pt-2">
            <DemoRequestForm />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
