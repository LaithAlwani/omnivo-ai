"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  MODULE_CATALOG,
  type Entitlements,
  type ModuleKey,
} from "@/convex/modules/registry";
import { firstPlanWithModule } from "@/convex/lib/tiers";
import { useBusiness } from "@/components/dashboard/business-context";

const PLAN_NAME: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  premium: "Premium",
  enterprise: "Enterprise",
};

// Gate a dashboard section on a module entitlement. When the module is off it
// renders an upsell that links to the Modules page; when on it renders children.
export function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey;
  children: React.ReactNode;
}) {
  const b = useBusiness();
  const entitlements = useQuery(api.entitlements.get, { slug: b.slug });
  const info = MODULE_CATALOG.find((m) => m.key === module)!;

  if (entitlements === undefined) {
    return <div className="text-sm text-faint">Loading…</div>;
  }

  const on = entitlements[`${module}Enabled` as keyof Entitlements];
  if (on) return <>{children}</>;

  const requiredPlan = firstPlanWithModule(module);
  const planName = PLAN_NAME[requiredPlan] ?? requiredPlan;

  return (
    <div className="max-w-2xl rounded-xl border border-line bg-surface/40 p-8 text-center">
      <h1 className="font-display text-2xl text-bone">{info.name}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{info.blurb}</p>
      <p className="mt-1 text-xs text-faint">{info.grants}</p>
      <p className="mt-4 text-sm text-bone-dim">
        Included on the <span className="text-bone">{planName}</span> plan.
      </p>
      <Link
        href={`/dashboard/${b.slug}/usage`}
        className="mt-4 inline-flex h-10 items-center rounded-full bg-ember px-5 text-sm font-medium text-[#160b04] transition-colors hover:bg-flare"
      >
        Upgrade to {planName}
      </Link>
    </div>
  );
}
