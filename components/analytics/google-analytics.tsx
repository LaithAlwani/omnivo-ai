import Script from "next/script";

// Google Analytics (GA4) via gtag.js. Loaded with `afterInteractive` — the
// strategy Next recommends for tag managers/analytics — so it never blocks
// hydration. The measurement ID can be overridden per environment with
// NEXT_PUBLIC_GA_ID; it falls back to the production property.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-MEYQJ4Y1YT";

export function GoogleAnalytics() {
  // Don't pollute analytics with local dev / preview traffic. Verify on the
  // deployed site via GA → Realtime.
  if (process.env.NODE_ENV !== "production" || !GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  );
}
