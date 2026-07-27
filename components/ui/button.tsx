import Link from "next/link";
import { appBaseUrl } from "@/lib/site-config";

type Variant = "primary" | "ghost" | "quiet";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:opacity-50";

const sizes = {
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-[0.95rem]",
} as const;

const variants: Record<Variant, string> = {
  // Molten fill — the one loud control. Warm shadow reads as heat.
  primary:
    "bg-ember text-[#160b04] hover:bg-flare shadow-[0_8px_30px_-8px_rgba(255,92,26,0.6)] hover:shadow-[0_10px_36px_-6px_rgba(255,179,71,0.7)]",
  // Bordered, warm — the calm secondary.
  ghost:
    "border border-line-strong text-bone hover:border-ember/60 hover:bg-surface",
  // Text-only affordance.
  quiet: "text-bone-dim hover:text-bone",
};

export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  size?: keyof typeof sizes;
  className?: string;
} & React.ComponentProps<typeof Link>) {
  // Our own app host is a different origin but not "external" — it should open
  // in the same tab, not a new one.
  const isAppLink = appBaseUrl !== "" && href.startsWith(appBaseUrl);
  const external = href.startsWith("http") && !isAppLink;
  return (
    <Link
      href={href}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
    </Link>
  );
}
