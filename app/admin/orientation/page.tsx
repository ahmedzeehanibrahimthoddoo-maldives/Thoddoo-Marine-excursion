import { getBookings, getTripsForDateRange } from "@/lib/supabase/actions";
import { maldivesToday, addDays } from "@/lib/operations";
import OrientationClient from "./OrientationClient";

export const metadata = { title: "Orientation | Thoddoo Marine Admin" };

export default async function OrientationPage() {
  let sampleBooking: Record<string, unknown> | null = null;
  let sampleTrip: Record<string, unknown> | null = null;

  try {
    const bookings = await getBookings("all");
    const upcoming = (bookings as Record<string, unknown>[])
      .filter((b: Record<string, unknown>) => b.status !== "cancelled")
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.created_at).localeCompare(String(a.created_at)));
    if (upcoming.length > 0) sampleBooking = upcoming[0];
  } catch { /* no-op */ }

  try {
    const today = maldivesToday();
    const trips = await getTripsForDateRange(today, addDays(today, 7));
    if (trips.length > 0) sampleTrip = trips[0] as unknown as Record<string, unknown>;
  } catch { /* no-op */ }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Orientation — Guest Journey A→Z</h1>
        <p className="adminPageSub">
          Step-by-step guide of every action staff must follow from the moment a guest books any activity, through to trip completion.
          Walk through these steps with your team using the live example below.
        </p>
      </div>
      <OrientationClient sampleBooking={sampleBooking} sampleTrip={sampleTrip} />
    </div>
  );
}