import type { MetadataRoute } from "next";

const BASE_URL = "https://omnivoai.ca";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // App surfaces, not marketing content — keep them out of the index.
        disallow: ["/dashboard", "/signin", "/forgot-password", "/reset-password", "/embed", "/api"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
