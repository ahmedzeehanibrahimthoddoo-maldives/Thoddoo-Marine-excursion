import { getRentals, getRentalRequests, type RentalRequestRow } from "@/lib/supabase/actions";
import RentalPageClient from "./RentalPageClient";

export const metadata = { title: "Equipment Rentals | Thoddoo Marine Admin" };

export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = params.status || "all";

  let rentals;
  let requests: RentalRequestRow[];
  try {
    [rentals, requests] = await Promise.all([getRentals(status), getRentalRequests()]);
  } catch {
    return (
      <div className="adminPage">
        <div className="adminPageHeader"><h1>Equipment Rentals</h1></div>
        <div className="errorState">
          <p>Unable to load rentals. Please check your database connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <RentalPageClient rentals={rentals} requests={requests} currentStatus={status} />
    </div>
  );
}
