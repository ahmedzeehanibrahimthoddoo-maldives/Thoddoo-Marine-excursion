import { getTripsForDateRange, getActivitiesForSelect, getBoatsForSelect, getCrewForSelect } from "@/lib/supabase/actions";
import { maldivesToday, addDays, friendlyDate } from "@/lib/operations";
import TripsPageClient from "./TripsPageClient";

export const metadata = { title: "Trips | Thoddoo Marine Admin" };

const RANGE = 3;

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; trip?: string }>;
}) {
  const params = await searchParams;
  const base = params.date || maldivesToday();

  let trips;
  let activities;
  let boats;
  let crew;
  try {
    [trips, activities, boats, crew] = await Promise.all([
      getTripsForDateRange(addDays(base, -RANGE), addDays(base, RANGE)),
      getActivitiesForSelect(),
      getBoatsForSelect(),
      getCrewForSelect(),
    ]);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Trips</h1></div>
        <div className="errorState">
          <p>Unable to load trips. Confirm the 016_operations migration has been applied, then refresh.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Trips</h1>
        <p className="adminPageSub">Manual runs around {friendlyDate(base)} — build today's plan, then run it from the board.</p>
      </div>
      <TripsPageClient
        initialTrips={trips}
        initialActivities={activities}
        initialBoats={boats}
        initialCrew={crew}
        date={base}
        focusTripId={params.trip}
      />
    </div>
  );
}