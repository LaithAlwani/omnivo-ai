"use client";

import Link from "next/link";
import { SectionHeading } from "@/components/ui/section-heading";
import { Button } from "@/components/ui/button";
import {
  pricingTiers,
  pricingModules,
  additionalLocationPrice,
  overageRates,
  appHref,
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
                Set it up yourself, or{" "}
                <span className="text-molten">we install it</span>.
              </>
            }
            lead="Self-setup runs on a published monthly plan — pick a tier below. Prefer we do it? Installed deployments are quoted per project (setup + monthly)."
            className="mx-auto"
          />
        )}

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
                          ${t.monthly}
                        </span>
                        <span className="font-mono text-xs text-faint">/mo</span>
                      </div>
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
              <Row label="AI credits / mo">
                {pricingTiers.map((t) => (
                  <td key={t.key} className={`${cellCls(t.featured)} text-bone`}>
                    {t.credits.toLocaleString()}
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
              {/* Overage — same rate on every plan when you go over. */}
              {overageRates.map((o) => (
                <Row key={o.label} label={o.label}>
                  {pricingTiers.map((t) => (
                    <td key={t.key} className={`${cellCls(t.featured)} text-bone`}>
                      {o.price}{" "}
                      <span className="text-xs font-normal text-faint">
                        {o.unit}
                      </span>
                    </td>
                  ))}
                </Row>
              ))}
              <tr>
                <td className="p-3" />
                {pricingTiers.map((t) => (
                  <td
                    key={t.key}
                    className={`p-3 text-center ${t.featured ? "rounded-b-xl bg-surface" : ""}`}
                  >
                    <Button
                      href={appHref("/signin")}
                      variant={t.featured ? "primary" : "ghost"}
                      size="md"
                      className="w-full"
                    >
                      Get started
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Two-path footer: self-setup add-ons + the installed / Enterprise path */}
        <div className="mx-auto mt-10 max-w-2xl space-y-4 text-center text-sm text-muted">
          <p>
            Prices above are for setting it up yourself. Want us to audit, connect,
            and go live for you?{" "}
            <Link href="/book" className="text-ember underline hover:text-flare">
              Book an install call
            </Link>{" "}
            for a per-project quote.
          </p>
          <p>
            Need more locations? Add extra ones for{" "}
            <span className="text-bone">${additionalLocationPrice}/mo</span> each.
            Multi-location or agency?{" "}
            <Link href="/book" className="text-ember underline hover:text-flare">
              Talk to us about Enterprise
            </Link>
            .
          </p>
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
