import Link from "next/link";
import { Logo } from "@/components/layout/logo";

// Root 404 — shown for unmatched routes and any notFound() call. Self-contained
// (the root layout is bare), styled with the design system.
export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="bg-grid mask-radial pointer-events-none absolute inset-0 opacity-50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-144 w-xl rounded-full bg-ember/10 blur-[120px]"
      />

      <div className="relative max-w-md text-center">
        <div className="flex justify-center">
          <Logo />
        </div>

        <p className="eyebrow mt-12 inline-flex items-center gap-2.5">
          <span className="h-px w-6 bg-ember/70" />
          Error 404
        </p>
        <h1 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight text-bone sm:text-6xl">
          This page went <span className="text-molten">missing</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-muted">
          The link may be broken, or the page may have moved. Let&rsquo;s get you
          back on track.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            Back home
          </Link>
          <Link
            href="/#pricing"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
          >
            See pricing
          </Link>
        </div>
      </div>
    </main>
  );
}
