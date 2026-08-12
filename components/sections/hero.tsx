"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { LiveAssistant } from "@/components/sections/live-assistant";
import { company, heroStats, appHref } from "@/lib/site-config";

const rise = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay: 0.1 + i * 0.09, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Ambient machined grid, faded at edges */}
      <div aria-hidden className="bg-grid mask-radial pointer-events-none absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[36rem] w-[36rem] rounded-full bg-ember/10 blur-[120px]"
      />

      <div className="shell relative">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Left: the editorial thesis */}
          <div className="max-w-xl">
            <motion.span
              custom={0}
              variants={rise}
              initial="hidden"
              animate="show"
              className="eyebrow inline-flex items-center gap-2.5 rounded-full border border-line px-3.5 py-1.5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ember" />
              {company.eyebrow}
            </motion.span>

            <motion.h1
              custom={1}
              variants={rise}
              initial="hidden"
              animate="show"
              className="mt-6 text-[2.7rem] leading-[1.02] tracking-tight sm:text-6xl"
            >
              The AI <span className="text-molten">layer</span> for the tools you
              already <span className="text-molten">run</span>.
            </motion.h1>

            <motion.p
              custom={2}
              variants={rise}
              initial="hidden"
              animate="show"
              className="mt-6 max-w-lg text-lg leading-relaxed text-muted"
            >
              {company.heroLead}
            </motion.p>

            <motion.div
              custom={3}
              variants={rise}
              initial="hidden"
              animate="show"
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Button href={company.primaryCta.href} size="lg">
                {company.primaryCta.label}
              </Button>
              <Button href={appHref("/create")} variant="ghost" size="lg">
                Set it up yourself
              </Button>
              <Link
                href={company.secondaryCta.href}
                className="ml-1 whitespace-nowrap font-mono text-xs uppercase tracking-wider text-faint transition-colors hover:text-ember"
              >
                {company.secondaryCta.label} →
              </Link>
            </motion.div>

            {/* Proof strip */}
            <motion.dl
              custom={4}
              variants={rise}
              initial="hidden"
              animate="show"
              className="mt-12 flex divide-x divide-line border-t border-line pt-6"
            >
              {heroStats.map((s) => (
                <div key={s.label} className="px-4 first:pl-0 sm:px-6">
                  <dt className="font-display text-2xl whitespace-nowrap text-bone sm:text-3xl">
                    {s.value}
                  </dt>
                  <dd className="mt-1 font-mono text-xs uppercase tracking-wider text-faint">
                    {s.label}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </div>

          {/* Right: the signature — live panel, offset up and bleeding right */}
          <motion.div
            initial={{ opacity: 0, y: 28, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 1, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative lg:-mt-6 lg:translate-x-4"
          >
            <LiveAssistant />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
