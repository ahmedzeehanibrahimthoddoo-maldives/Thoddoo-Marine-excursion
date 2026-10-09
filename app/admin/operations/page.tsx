import { getTrips } from "@/lib/supabase/actions";
import { getUnassignedBookings } from "@/lib/supabase/actions";
import { getCrewForSelect } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import OperationsBoardClient from "./OperationsBoardClient";

export const metadata = { title: "Operations Board | Thoddoo Marine Admin" };

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const date = params.date || maldivesToday();

  let trips;
  let unassigned;
  let crew;
  try {
    [trips, unassigned, crew] = await Promise.all([getTrips(date), getUnassignedBookings(date), getCrewForSelect()]);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Operations Board</h1></div>
        <div className="errorState">
          <p>Unable to load the operations board. Confirm the 016_operations migration has been applied, then refresh.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Operations Board</h1>
        <p className="adminPageSub">Today's departures — crew, boat, status & seating.</p>
      </div>
      <OperationsBoardClient initialTrips={trips} initialUnassigned={unassigned} crew={crew} date={date} />
    </div>
  );
}