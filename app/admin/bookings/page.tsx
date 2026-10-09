import { getBookings } from "@/lib/supabase/actions";
import BookingPageClient from "./BookingPageClient";

export const metadata = { title: "Bookings | Thoddoo Marine Admin" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = params.status || "all";

  let bookings;
  try {
    bookings = await getBookings(status);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Bookings</h1></div>
        <div className="errorState">
          <p>Unable to load bookings. Please check your database connection and ensure migrations have been run.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Bookings</h1>
      </div>

      <BookingPageClient initialBookings={bookings} currentStatus={status} />
    </div>
  );
}
