import { getTripsForDateRange, getTrips } from "@/lib/supabase/actions";
import { maldivesToday, addDays, TripRow } from "@/lib/operations";
import ManifestPageClient from "./ManifestPageClient";

export const metadata = { title: "Manifests | Thoddoo Marine Admin" };

export default async function ManifestsPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const params = await searchParams;

  let selectorTrips: TripRow[] = [];
  let focusTrip: TripRow | null = null;
  let error = false;

  try {
    selectorTrips = (await getTripsForDateRange(addDays(maldivesToday(), -1), addDays(maldivesToday(), 7))) as TripRow[];

    let targetId = params.trip || selectorTrips[0]?.id || "";
    let targetDate = selectorTrips.find((t) => t.id === targetId)?.trip_date;

    if (targetId && targetDate) {
      const dayTrips = (await getTrips(targetDate)) as TripRow[];
      focusTrip = dayTrips.find((t) => t.id === targetId) || null;
    }
  } catch {
    error = true;
  }

  if (error) {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Manifests</h1></div>
        <div className="errorState">
          <p>Unable to load manifests. Confirm the 016_operations migration has been applied, then refresh.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Manifests</h1>
        <p className="adminPageSub">Per-trip guest list for the crew — names, pax, transfers. Printable.</p>
      </div>
      <ManifestPageClient selectorTrips={selectorTrips} focusTrip={focusTrip} />
    </div>
  );
}