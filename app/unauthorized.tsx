import Link from "next/link";
import { Logo } from "@/components/layout/logo";

// 401 — rendered (with a real 401 status) when a route or action throws
// `unauthorized()` from next/navigation. Needs experimental.authInterrupts,
// enabled in next.config.
export default function Unauthorized() {
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
          Error 401
        </p>
        <h1 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight text-bone sm:text-6xl">
          You need to <span className="text-molten">sign in</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-muted">
          This page is for signed-in accounts. Sign in to continue — or head back
          to the homepage.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/signin"
            className="inline-flex h-11 items-center justify-center rounded-full bg-ember px-6 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
          >
            Sign in
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 text-sm text-bone-dim transition-colors hover:border-ember/50 hover:text-bone"
          >
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
