import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { company, appHref } from "@/lib/site-config";

const columns = [
  {
    title: "Connections",
    links: [
      { label: "AI Assistant", href: "/#tools" },
      { label: "Booking", href: "/#tools" },
      { label: "Lead capture", href: "/#tools" },
      { label: "How it works", href: "/#how" },
    ],
  },
  {
    title: "Plans",
    links: [
      { label: "Starter", href: "/plans/starter" },
      { label: "Professional", href: "/plans/professional" },
      { label: "Enterprise", href: "/plans/enterprise" },
      { label: "All pricing", href: "/services" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Book an install call", href: "/book" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact", href: "/#contact" },
      { label: "Sign in", href: appHref("/dashboard") },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ink-2">
      <div className="shell py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-5 text-sm leading-relaxed text-muted">
              The AI layer that answers, books, and captures leads — driving the
              booking, CRM, and calendar tools you already run.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="eyebrow !text-faint">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-bone-dim transition-colors hover:text-ember"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-line pt-8 text-xs text-faint sm:flex-row sm:items-center">
          <p>
            &copy; {new Date().getFullYear()} {company.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="transition-colors hover:text-bone-dim">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-bone-dim">
              Terms
            </Link>
            <span className="font-mono">Built with {company.name}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
