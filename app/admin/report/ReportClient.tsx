"use client";

import { useRef } from "react";
import { formatMoney, validCurrency, EXCHANGE_RATE_MVR_PER_USD } from "@/lib/money";

interface ReportBooking {
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
}

interface ReportProps {
  reportDate: string;
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
  bookings: ReportBooking[];
}

export default function ReportClient({ reportDate, summary, bookings }: ReportProps) {
  const printRef = useRef<HTMLDivElement>(null);

  function buildWhatsAppReport(): string {
    const lines: string[] = [];
    lines.push(`*Thoddoo Marine — ${reportDate}*`);
    lines.push(`Total: ${summary.total} bookings (${summary.confirmed} confirmed, ${summary.pending} pending)`);
    lines.push(`Guests: ${summary.total_adults} adults, ${summary.total_children} children (${summary.total_guests} total)`);
    const currEntries = Object.entries(summary.by_currency || {});
    if (currEntries.length > 0) {
      lines.push("");
      for (const [cur, info] of currEntries) {
        const formatted = formatMoney(info.total_minor, validCurrency(cur));
        lines.push(`${cur}: ${formatted} (${info.count} bookings)`);
      }
    }
    lines.push("");

    bookings.forEach((b) => {
      lines.push(`*${b.booking_ref}* [${b.status}]`);
      lines.push(`${b.activity_name}`);
      lines.push(`${b.guest_name} — ${b.guest_phone}`);
      lines.push(`${b.adults}A${b.children > 0 ? `+${b.children}C` : ""}`);
      if (b.preferred_time) lines.push(`Time: ${b.preferred_time}`);
      if (b.hotel_name) lines.push(`Hotel: ${b.hotel_name}${b.room_number ? ` / ${b.room_number}` : ""}`);
      if (b.pickup_location) lines.push(`Pickup: ${b.pickup_location}`);
      if (b.pricing_option) lines.push(`Option: ${b.pricing_option}`);
      if (b.estimated_total_cents > 0) lines.push(`Total: ${formatMoney(b.estimated_total_cents, validCurrency(b.booking_currency))} [${b.payment_status}]`);
      if (b.special_requests) lines.push(`Note: ${b.special_requests}`);
      lines.push("");
    });

    return lines.join("\n");
  }

  function handleCopyWhatsApp() {
    navigator.clipboard.writeText(buildWhatsAppReport()).catch(() => {});
  }

  function handleOpenWhatsApp() {
    const msg = buildWhatsAppReport();
    const url = `https://wa.me/9609472110?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <div className="reportActions no-print">
        <button className="addBtn" onClick={handleCopyWhatsApp}>
          Copy WhatsApp Report
        </button>
        <button className="addBtn" onClick={handleOpenWhatsApp}>
          Open WhatsApp
        </button>
        <button className="addBtn" onClick={handlePrint}>
          Print
        </button>
      </div>

      <div ref={printRef}>
        <div className="reportSummary">
          <div className="reportStat">
            <span className="reportStatValue">{summary.total}</span>
            <span className="reportStatLabel">Total Bookings</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{summary.confirmed}</span>
            <span className="reportStatLabel">Confirmed</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{summary.pending}</span>
            <span className="reportStatLabel">Pending</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{summary.total_adults}</span>
            <span className="reportStatLabel">Adults</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{summary.total_children}</span>
            <span className="reportStatLabel">Children</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{summary.total_guests}</span>
            <span className="reportStatLabel">Total Guests</span>
          </div>
        </div>

        {Object.entries(summary.by_currency || {}).length > 0 && (
          <div className="reportSummary">
            {Object.entries(summary.by_currency).map(([cur, info]) => (
              <div key={cur} className="reportStat">
                <span className="reportStatValue">{formatMoney(info.total_minor, validCurrency(cur))}</span>
                <span className="reportStatLabel">{cur} Total ({info.count} bookings)</span>
              </div>
            ))}
          </div>
        )}

        {bookings.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Status</th>
                  <th>Activity</th>
                  <th>Time</th>
                  <th>Guest</th>
                  <th>Pax</th>
                  <th>Hotel / Room</th>
                  <th>Pickup</th>
                  <th>Option</th>
                  <th>Est. Total</th>
                  <th>Payment</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_ref}>
                    <td className="mono">{b.booking_ref}</td>
                    <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                    <td>{b.activity_name}</td>
                    <td>{b.preferred_time || "—"}</td>
                    <td>
                      <div>{b.guest_name}</div>
                      <small className="textMuted">{b.guest_phone}</small>
                    </td>
                    <td>
                      {b.adults}A
                      {b.children > 0 ? `+${b.children}C` : ""}
                    </td>
                    <td>
                      {b.hotel_name ? `${b.hotel_name}${b.room_number ? ` / ${b.room_number}` : ""}` : "—"}
                    </td>
                    <td>{b.pickup_location || "—"}</td>
                    <td>{b.pricing_option || "—"}</td>
                    <td>
                      {b.estimated_total_cents > 0 ? formatMoney(b.estimated_total_cents, validCurrency(b.booking_currency)) : "—"}
                    </td>
                    <td><span className={`badge badge-${b.payment_status}`}>{b.payment_status}</span></td>
                    <td>{b.special_requests || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState">
            <p>No bookings scheduled for {reportDate}.</p>
          </div>
        )}
      </div>
    </>
  );
}
