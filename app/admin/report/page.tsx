import { createClient } from "@/lib/supabase/server";
import ReportClient from "./ReportClient";

export const metadata = { title: "Tomorrow's Report | Thoddoo Marine Admin" };

export default async function ReportPage() {
  const supabase = await createClient();

  // Tomorrow in Maldives time (UTC+5) — computed server-side in the RPC
  const now = new Date();
  const maldiveOffset = 5 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const maldiveMs = utcMs + maldiveOffset * 60 * 1000;
  const maldiveDate = new Date(maldiveMs);
  maldiveDate.setDate(maldiveDate.getDate() + 1);
  const tomorrow = maldiveDate.toISOString().split("T")[0];

  // Use the RPC — it enforces owner/manager/reception role access
  const { data, error } = await supabase.rpc("get_tomorrow_bookings");

  if (error || !data) {
    return (
      <div className="adminPage">
        <div className="adminPageHeader">
          <h1>Tomorrow&apos;s Report</h1>
          <p className="adminPageSub">{tomorrow} (Maldives time, UTC+5)</p>
        </div>
        <div className="errorState">
          <p>
            Unable to load report data.
            {error?.message?.includes("Access denied")
              ? " You do not have permission to view this report."
              : " Please check your database connection."}
          </p>
        </div>
      </div>
    );
  }

  const record = data as {
    date: string;
    bookings: {
      booking_ref: string;
      status: string;
      activity_name: string;
      guest_name: string;
      guest_phone: string;
      adults: number;
      children: number;
      guests: number;
      booking_date: string;
      preferred_time: string | null;
      hotel_name: string | null;
      room_number: string | null;
      pickup_location: string | null;
      pricing_option: string | null;
      estimated_total_cents: number;
      total_cents: number | null;
      payment_status: string;
      special_requests: string | null;
      source: string;
      created_at: string;
      booking_currency: string;
      exchange_rate: number;
      converted_usd_cents: number;
      converted_mvr_laari: number;
    }[];
    summary: {
      total: number;
      confirmed: number;
      pending: number;
      total_adults: number;
      total_children: number;
      total_guests: number;
      total_usd_cents: number;
      total_mvr_laari: number;
      by_currency: Record<string, { count: number; total_minor: number }>;
    };
  };

  const reportDate = record.date;
  const bookings = record.bookings;
  const summary = record.summary;

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Tomorrow&apos;s Report</h1>
        <p className="adminPageSub">{reportDate} (Maldives time, UTC+5)</p>
      </div>

      <ReportClient reportDate={reportDate} summary={summary} bookings={bookings} />
    </div>
  );
}
