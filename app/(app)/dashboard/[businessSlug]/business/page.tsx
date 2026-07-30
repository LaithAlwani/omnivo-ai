import { redirect } from "next/navigation";

// Bare /dashboard/<slug>/business has no page of its own — send it to the first
// sub-tab so the section always resolves (the sidebar entry and the breadcrumb
// both point here).
export default async function BusinessIndexPage({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  redirect(`/dashboard/${businessSlug}/business/branding`);
}
