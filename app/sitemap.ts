import type { MetadataRoute } from "next";
import { plans } from "@/lib/site-config";

const BASE_URL = "https://omnivoai.ca";

// Public, indexable marketing routes only. The dashboard, sign-in, and embed
// surfaces are intentionally excluded (see robots.ts) — they're app chrome, not
// content we want crawled.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/services`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/book`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];

  const planRoutes: MetadataRoute.Sitemap = plans.map((plan) => ({
    url: `${BASE_URL}/plans/${plan.slug}`,
    lastModified,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...planRoutes];
}
