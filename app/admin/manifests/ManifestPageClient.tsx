"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, currencyForDisplay } from "@/lib/money";
import {
  TRIP_STATUS_LABEL, BOAT_STATUS_LABEL, friendlyDate,
  manifestList, manifestBooked, tripBookedPax, tripRemainingSeats, tripRevenueCents, TripRow,
  bookingConsentStatus, type ManifestBooked,
} from "@/lib/operations";
import { toggleManifestCheckin, unassignBookingFromTrip } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  selectorTrips: TripRow[];
  focusTrip: TripRow | null;
}

export default function ManifestPageClient({ selectorTrips, focusTrip: initialFocus }: Props) {
  const router = useRouter();
  const [focusTrip, setFocusTrip] = useState<TripRow | null>(initialFocus);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function selectTrip(id: string) {
    router.push(`/admin/manifests?trip=${id}`);
  }

  async function handleCheckIn(manifestId: string) {
    setBusy(true);
    try {
      await toggleManifestCheckin(manifestId);
      flash("success", "Check-in updated.");
      router.refresh();
      setBusy(false);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to update check-in");
      setBusy(false);
    }
  }

  async function handleUnassign(bookingId: string, rowLabel: string) {
    if (!confirm(`Release ${rowLabel} from this trip? Its seats open up again.`)) return;
    setBusy(true);
    try {
      await unassignBookingFromTrip(bookingId);
      flash("success", `${rowLabel} released from trip.`);
      router.refresh();
      setBusy(false);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to release booking");
      setBusy(false);
    }
  }

  const rows = focusTrip ? manifestList(focusTrip) : [];
  const booked = focusTrip ? manifestBooked(rows) : [];
  const checkedInPax = rows.filter((r) => r.checked_in).reduce((s, r) => s + (Number(r.pax) || 0), 0);

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="opsToolbar">
        <div className="opsDateNav">
          <select value={focusTrip?.id || ""} onChange={(e) => selectTrip(e.target.value)} className="opsTripSelect">
            {!focusTrip && <option value="">— Select a trip —</option>}
            {selectorTrips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.trip_ref} · {t.trip_date} · {String(t.start_time || "—")} · {String(t.activities?.name || "")}
              </option>
            ))}
          </select>
        </div>
        {focusTrip && (
          <button className="addBtn" onClick={() => window.print()}>⎙ Print Manifest</button>
        )}
      </div>

      {focusTrip ? (
        <div className="manifestSheet">
          <div className="manifestHead">
            <div>
              <h2>{String(focusTrip.activities?.name || "—")}</h2>
              <p className="manifestMeta">
                {focusTrip.trip_ref} · {friendlyDate(focusTrip.trip_date)} · {focusTrip.start_time || "—"}
                {focusTrip.end_time ? ` – ${focusTrip.end_time}` : ""}
              </p>
            </div>
            <div className="manifestMeta right">
              <div>Boat: <strong>{String(focusTrip.boats?.name || "—")}</strong> ({String(focusTrip.boats?.boat_type || "")})</div>
              <div>Guide: <strong>{String(focusTrip.guide?.full_name || "—")}</strong></div>
              {focusTrip.captain?.full_name && <div>Captain: <strong>{focusTrip.captain.full_name}</strong></div>}
              <div>Status: <span className={`badge badge-trip-${focusTrip.status}`}>{TRIP_STATUS_LABEL[focusTrip.status]}</span></div>
            </div>
          </div>

          <div className="manifestSummary">
            <span>Pax: <strong>{tripBookedPax(focusTrip)} / {focusTrip.capacity_pax}</strong></span>
            <span>Checked in: <strong>{checkedInPax}</strong></span>
            <span>Walk-in seats: <strong>{tripRemainingSeats(focusTrip)}</strong></span>
            <span>Revenue: <strong>{formatMoney(tripRevenueCents(focusTrip), currencyForDisplay("USD"))}</strong></span>
            <span>Bookings: <strong>{rows.length}</strong> · Pending payment: {booked.filter((b) => b.payment_status && b.payment_status !== "paid").length}</span>
          </div>

          {rows.length > 0 ? (
            <div className="tableWrap">
              <table className="adminTable manifestTable">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Pax</th>
                  <th>Arrival / Transfer</th>
                  <th>Hotel / Room</th>
                  <th>Booking</th>
                  <th>Consent</th>
                  <th>Checked In</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = (Array.isArray(r.bookings) ? r.bookings[0] : r.bookings) as
                    { booking_ref?: string; partner?: string; payment_status?: string; preferred_time?: string; net_cents?: number; estimated_total_cents?: number } | undefined;
                  const consentStatus = bookingConsentStatus(b as ManifestBooked | undefined);
                  const consentSigned = consentStatus === "signed";
                  const canCheckIn = consentSigned || r.checked_in;
                  return (
                    <tr key={r.id} className={!r.checked_in && !consentSigned ? "manifestConsentBlocked" : ""}>
                      <td>
                        <strong>{r.guest_name}</strong>
                        {b?.partner && <div className="textMuted">via {b.partner}</div>}
                      </td>
                      <td>{r.pax}</td>
                      <td>
                        {r.arrival_date && <div>{friendlyDate(r.arrival_date)}{r.arrival_time ? ` ${r.arrival_time}` : ""}</div>}
                        {r.transfer && <div className="textMuted">✈ {r.transfer}</div>}
                        {!r.arrival_date && !r.transfer && r.arrival_time && <div>{r.arrival_time}</div>}
                        {!r.arrival_date && !r.transfer && !r.arrival_time && <span className="textMuted">—</span>}
                      </td>
                      <td>
                        {r.hotel ? <span>{r.hotel}{r.room_number ? ` / ${r.room_number}` : ""}</span> : <span className="textMuted">—</span>}
                      </td>
                      <td className="mono">
                        {b?.booking_ref || "—"}
                        {b?.preferred_time && <div className="textMuted">pref {b.preferred_time}</div>}
                        {b?.payment_status && b.payment_status !== "paid" && (
                          <div><span className={`badge badge-${b.payment_status}`}>{b.payment_status}</span></div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${consentStatus === "signed" ? "badge-signed" : "badge-pending"}`}
                          title={consentStatus === "signed"
                            ? "Consent & liability form signed"
                            : consentStatus === "pending"
                              ? "Consent form sent, awaiting signature"
                              : "No consent form on file"}
                        >
                          {consentStatus === "signed" ? "✓ Consent" : consentStatus === "pending" ? "Consent pending" : "No consent"}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`checkinBtn ${r.checked_in ? "on" : ""}`}
                          disabled={busy || !canCheckIn}
                          title={consentSigned
                            ? r.checked_in ? "Checked in" : "Check in"
                            : "Guest must sign the consent & liability form before check-in"}
                          onClick={() => handleCheckIn(r.id)}
                        >
                          {r.checked_in ? "✓ Checked" : "○ Check in"}
                        </button>
                      </td>
                      <td>
                        {b?.booking_ref && (
                          <button
                            className="actionBtn"
                            title="Release from trip"
                            disabled={busy}
                            onClick={() => handleUnassign(b.booking_ref!, String(r.guest_name))}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          ) : (
            <div className="emptyState">
              <p>No guests on this manifest yet. Confirm + pay the day&apos;s bookings, then press ⚡ Auto-attach on the Operations Board.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="emptyState">
          <p>Select a trip to view its manifest.</p>
        </div>
      )}
    </>
  );
}