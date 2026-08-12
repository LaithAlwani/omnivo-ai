"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SectionHeading } from "@/components/ui/section-heading";
import { faqs } from "@/lib/faq";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="section relative scroll-mt-20 border-t border-line">
      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              eyebrow="Questions"
              title={
                <>
                  Straight <span className="text-molten">answers</span>.
                </>
              }
              lead="Fitting for a product built on giving them. Still curious? Book an install call and ask us anything."
            />
          </div>

          <ul className="divide-y divide-line border-y border-line">
            {faqs.map((item, i) => {
              const isOpen = open === i;
              return (
                <li key={item.q}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left"
                    aria-expanded={isOpen}
                  >
                    <span
                      className={`text-lg transition-colors ${
                        isOpen ? "text-bone" : "text-bone-dim"
                      }`}
                    >
                      {item.q}
                    </span>
                    <span
                      className={`relative flex h-6 w-6 shrink-0 items-center justify-center transition-colors ${
                        isOpen ? "text-ember" : "text-faint"
                      }`}
                    >
                      <span className="absolute h-px w-3.5 bg-current" />
                      <span
                        className={`absolute h-px w-3.5 bg-current transition-transform duration-300 ${
                          isOpen ? "rotate-0" : "rotate-90"
                        }`}
                      />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-xl pb-6 text-[0.95rem] leading-relaxed text-muted">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
