import type { ReactNode } from "react";

// Shared chrome for long-form legal pages (Terms, Privacy). Element-level
// typography is applied via descendant variants so the page bodies stay plain,
// readable JSX.
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <section className="section pt-32 sm:pt-40">
      <div className="shell max-w-3xl">
        <span className="eyebrow flex items-center gap-2.5">
          <span className="h-px w-6 bg-ember/70" />
          Legal
        </span>
        <h1 className="mt-5 font-display text-5xl leading-[1.03] sm:text-6xl">
          {title}
        </h1>
        <p className="mt-5 text-sm text-faint">Last updated {updated}</p>

        <div
          className="mt-12 text-[0.975rem] leading-relaxed text-muted [&_a]:text-ember [&_a]:underline [&_a:hover]:text-flare [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-bone [&_li]:mt-2 [&_p]:mt-4 [&_strong]:text-bone-dim [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
