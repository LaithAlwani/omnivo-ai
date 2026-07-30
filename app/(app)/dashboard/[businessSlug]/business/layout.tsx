import { BusinessTabs } from "@/components/dashboard/business-tabs";

// The "Business" section groups the business-configuration pages (Branding,
// Locations, Team, Services, Knowledge) behind one sidebar entry. This shared
// layout renders the sub-tab bar above whichever sub-page is active. It sits
// inside [businessSlug]/layout.tsx, so BusinessProvider + the app shell +
// breadcrumbs are already in place.
export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BusinessTabs />
      {children}
    </>
  );
}
