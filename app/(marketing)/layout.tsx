import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";

// Marketing chrome. Its own layout keeps this bundle free of any dashboard code.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {/* Public-site analytics only — never loaded in the embed widget. */}
      <GoogleAnalytics />
    </>
  );
}
