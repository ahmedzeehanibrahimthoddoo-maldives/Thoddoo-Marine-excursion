import { getActivities } from "@/lib/supabase/actions";
import ActivityPageClient from "./ActivityPageClient";

export const metadata = { title: "Activities | Thoddoo Marine Admin" };

export default async function ActivitiesPage() {
  let activities;
  try {
    activities = await getActivities();
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Activities</h1></div>
        <div className="errorState">
          <p>Unable to load activities. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <ActivityPageClient activities={activities} />
    </div>
  );
}
