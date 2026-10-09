import { getActivityContentList } from "@/lib/supabase/actions";
import ActivityContentClient from "./ActivityContentClient";

export const metadata = { title: "Activity Pages | Thoddoo Marine Admin" };

export const dynamic = "force-dynamic";

export default async function ContentActivitiesPage() {
  let items: Record<string, unknown>[] = [];
  try {
    items = (await getActivityContentList()) as unknown as Record<string, unknown>[];
  } catch {
    items = [];
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Activity Pages</h1>
        <p className="adminPageSub">
          Edit the public activity cards and detail pages. Pricing &amp; names are managed under Activities.
        </p>
      </div>
      <ActivityContentClient initialItems={items} />
    </div>
  );
}