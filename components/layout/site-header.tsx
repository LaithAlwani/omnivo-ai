"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useScroll,
  useMotionValueEvent,
} from "motion/react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { nav, company } from "@/lib/site-config";
import { useActiveSection } from "@/lib/use-active-section";

const sectionIds = ["tools", "how", "pricing", "faq"];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const active = useActiveSection(sectionIds);

  const { scrollY, scrollYProgress } = useScroll();

  // The header stays pinned at all times; we only track scroll depth to swap in
  // the blurred backdrop once past the fold.
  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 24);
  });

  // Lock scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Molten scroll-progress line — always visible, reads like engine telemetry */}
      <motion.div
        aria-hidden
        style={{ scaleX: scrollYProgress }}
        className="fixed inset-x-0 top-0 z-60 h-0.5 origin-left bg-linear-to-r from-ember-deep via-ember to-flare"
      />

      <header className="fixed inset-x-0 top-0 z-50">
        <div
          className={`transition-all duration-300 ${
            scrolled || open
              ? "border-b border-line bg-ink/80 backdrop-blur-xl"
              : "border-b border-transparent"
          }`}
        >
          <div className="shell flex h-16 items-center justify-between">
            <Logo />

            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((item) => {
                const id = item.href.split("#")[1];
                const isActive = id === active;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative px-3.5 py-2 text-sm transition-colors ${
                      isActive ? "text-bone" : "text-bone-dim hover:text-bone"
                    }`}
                  >
                    {item.label}
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-x-2.5 -bottom-0.5 h-px bg-ember"
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <span
                      className={`absolute inset-x-3.5 -bottom-0.5 h-px origin-left bg-line-strong transition-transform duration-300 ${
                        isActive ? "scale-x-0" : "scale-x-0 group-hover:scale-x-100"
                      }`}
                    />
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <Button
                href={company.primaryCta.href}
                size="md"
                className="hidden md:inline-flex"
              >
                {company.primaryCta.label}
              </Button>
              <button
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-bone md:hidden"
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
              >
                <div className="relative h-3.5 w-4.5">
                  <span
                    className={`absolute left-0 h-px w-full bg-current transition-all duration-300 ${
                      open ? "top-1.5 rotate-45" : "top-0"
                    }`}
                  />
                  <span
                    className={`absolute left-0 top-1.5 h-px w-full bg-current transition-opacity duration-200 ${
                      open ? "opacity-0" : "opacity-100"
                    }`}
                  />
                  <span
                    className={`absolute left-0 h-px w-full bg-current transition-all duration-300 ${
                      open ? "top-1.5 -rotate-45" : "top-3"
                    }`}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-16 z-40 bg-ink/95 backdrop-blur-xl md:hidden"
          >
            <nav className="shell flex flex-col gap-1 pt-6">
              {nav.map((item, i) => {
                const id = item.href.split("#")[1];
                const isActive = id === active;
                return (
                  <motion.div
                    key={item.href}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06 * i + 0.05 }}
                  >
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center justify-between border-b border-line py-4 font-display text-2xl ${
                        isActive ? "text-ember" : "text-bone"
                      }`}
                    >
                      {item.label}
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-ember" />
                      )}
                    </Link>
                  </motion.div>
                );
              })}
              <Button href={company.primaryCta.href} size="lg" className="mt-6 w-full">
                {company.primaryCta.label}
              </Button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
