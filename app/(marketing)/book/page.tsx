import type { Metadata } from "next";
import { DemoRequestForm } from "@/components/sections/demo-request-form";

export const metadata: Metadata = {
  title: "Book a demo",
  description:
    "See Omnivo AI answer, book, and capture a lead with your own business. A fifteen-minute walkthrough.",
};

// The demo form talks to Convex through the no-auth public client, which is
// constructed from NEXT_PUBLIC_CONVEX_URL. Render this page per-request rather
// than prerendering it at build so a build without that env can't crash here —
// every other consumer of that client is request-time (dynamic) too.
export const dynamic = "force-dynamic";

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
        <DemoRequestForm />
        <p className="mt-5 font-mono text-xs text-faint">
          We&rsquo;ll reply within one business day.
        </p>
      </div>
    </section>
  );
}
