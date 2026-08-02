"use client";

import { useState } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/ui/section-heading";
import { Button } from "@/components/ui/button";
import {
  pricingTiers,
  pricingModules,
  foundingInfo,
  annualInfo,
  additionalLocationPrice,
  overageRates,
} from "@/lib/site-config";

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mx-auto h-4 w-4 text-ember" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Dash() {
  return <span className="text-faint">—</span>;
}

export function Pricing({ withHeading = true }: { withHeading?: boolean }) {
  const [annual, setAnnual] = useState(false);
  const num = (n: number) => n.toLocaleString();

  return (
    <section id="pricing" className="section relative scroll-mt-20">
      <div className="shell">
        {withHeading && (
          <SectionHeading
            align="center"
            eyebrow="Pricing"
            title={
              <>
                One employee. <span className="text-molten">Pick the skills</span> you
                need.
              </>
            }
            lead="Every plan is one AI employee with a bundle of skills. No à-la-carte — just pick the tier that fits."
            className="mx-auto"
          />
        )}

        {/* Founding Partner banner */}
        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-ember/40 bg-ember-soft/40 p-5 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-ember">
            Founding Partner Pricing
          </p>
          <p className="mt-1 text-sm text-bone-dim">
            The first {foundingInfo.slots} customers get{" "}
            <span className="text-bone">{foundingInfo.discountPct}% off, locked in</span>{" "}
            for as long as they stay — plus priority onboarding. Usage limits and
            overages are unchanged.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm">
            {pricingTiers.map((t) => (
              <span key={t.key} className="text-muted">
                {t.name}{" "}
                <span className="text-bone">${t.founding}</span>
                <span className="text-faint">/mo</span>
              </span>
            ))}
          </div>
        </div>

        {/* Monthly / Annual toggle */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={() => setAnnual(false)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              !annual ? "bg-surface text-bone" : "text-muted hover:text-bone"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              annual ? "bg-surface text-bone" : "text-muted hover:text-bone"
            }`}
          >
            Annual
            <span className="ml-1.5 rounded-full bg-ember/20 px-1.5 py-0.5 font-mono text-[0.6rem] text-ember">
              {annualInfo.monthsFree} months free
            </span>
          </button>
        </div>

        {/* Comparison matrix */}
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-160 border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="w-[34%] p-3 text-left align-bottom" />
                {pricingTiers.map((t) => (
                  <th key={t.key} className="p-3 text-center align-bottom">
                    <div
                      className={`rounded-t-xl px-3 pt-4 pb-3 ${
                        t.featured ? "bg-surface" : ""
                      }`}
                    >
                      {t.featured && (
                        <span className="mb-1 inline-block rounded-full bg-ember px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-[#160b04]">
                          Most popular
                        </span>
                      )}
                      <div className="font-display text-lg text-bone">{t.name}</div>
                      <div className="mt-1">
                        <span className="font-display text-3xl text-bone">
                          ${annual ? t.annualMonthly : t.monthly}
                        </span>
                        <span className="font-mono text-xs text-faint">/mo</span>
                      </div>
                      {annual && (
                        <div className="mt-0.5 text-[0.65rem] text-faint">
                          billed monthly · 12-mo term
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-bone-dim">
              {pricingModules.map((m) => (
                <Row key={m.key} label={m.name}>
                  {pricingTiers.map((t) => (
                    <td key={t.key} className={cellCls(t.featured)}>
                      {t.modules.has(m.key) ? <Check /> : <Dash />}
                    </td>
                  ))}
                </Row>
              ))}
              <Row label="White-label + custom domain">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={cellCls(t.featured)}>
                    {t.whiteLabel ? <Check /> : <Dash />}
                  </td>
                ))}
              </Row>
              <Row label="Locations included">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={`${cellCls(t.featured)} text-bone`}>
                    {t.locations}
                  </td>
                ))}
              </Row>
              <Row label="Conversations / mo">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={cellCls(t.featured)}>
                    {num(t.conversations)}
                  </td>
                ))}
              </Row>
              <Row label="Emails / mo">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={cellCls(t.featured)}>
                    {num(t.emails)}
                  </td>
                ))}
              </Row>
              <Row label="SMS / mo">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={cellCls(t.featured)}>
                    {t.sms > 0 ? num(t.sms) : <Dash />}
                  </td>
                ))}
              </Row>
              <tr>
                <td className="p-3" />
                {pricingTiers.map((t) => (
                  <td
                    key={t.key}
                    className={`p-3 text-center ${t.featured ? "rounded-b-xl bg-surface" : ""}`}
                  >
                    <Button
                      href="/book"
                      variant={t.featured ? "primary" : "ghost"}
                      size="md"
                      className="w-full"
                    >
                      Start free trial
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Add-ons + Enterprise */}
        <div className="mx-auto mt-10 max-w-2xl space-y-4 text-center text-sm text-muted">
          <p>
            Need more locations? Add extra ones for{" "}
            <span className="text-bone">${additionalLocationPrice}/mo</span> each.
            Multi-location or agency?{" "}
            <Link href="/book" className="text-ember underline hover:text-flare">
              Talk to us about Enterprise
            </Link>
            .
          </p>
          <div className="rounded-xl border border-line bg-surface/40 p-5">
            <div className="font-mono text-xs uppercase tracking-wider text-faint">
              If you go over your monthly allowance
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {overageRates.map((o) => (
                <div key={o.label}>
                  <div className="font-display text-lg text-bone">{o.rate}</div>
                  <div className="mt-0.5 text-xs text-faint">{o.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function cellCls(featured: boolean): string {
  return `border-t border-line p-3 text-center ${featured ? "bg-surface" : ""}`;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td className="border-t border-line p-3 text-left text-bone-dim">{label}</td>
      {children}
    </tr>
  );
}
