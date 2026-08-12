"use client";

import { createContext, useContext } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

// The current business + the caller's role in it, resolved once in the shell
// layout and shared with every dashboard page.
type BusinessWithRole =
  FunctionReturnType<typeof api.businesses.listMine>[number];

const BusinessContext = createContext<BusinessWithRole | null>(null);

export function BusinessProvider({
  value,
  children,
}: {
  value: BusinessWithRole;
  children: React.ReactNode;
}) {
  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness(): BusinessWithRole {
  const business = useContext(BusinessContext);
  if (!business) {
    throw new Error("useBusiness must be used inside the business dashboard");
  }
  return business;
}

export function isManagerRole(role: BusinessWithRole["role"]) {
  return role === "owner" || role === "admin";
}
