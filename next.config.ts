import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trim the X-Powered-By response header — no need to advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The chat widget is meant to be framed on any customer site, so it must
        // NOT inherit a restrictive X-Frame-Options / frame-ancestors. (Every
        // other route stays un-framable by default.)
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
      {
        // Allow the loader script to be fetched cross-origin from customer sites.
        source: "/widget.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        // Brand/logo assets are content-hashed by name and never change — let
        // browsers and CDNs cache them for a year.
        source: "/logos/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The portal host is a private app, not marketing — keep it out of
        // search indexes entirely.
        source: "/:path*",
        has: [{ type: "host", value: "app.omnivoai.ca" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
