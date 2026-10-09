"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getTrips,
  assignBookingToTrip,
  quickCreateTripForBookingAction,
} from "@/lib/supabase/actions";
import { TripRow, tripRemainingSeats } from "@/lib/operations";

interface AssignBooking {
  id: string;
  booking_ref: string;
  activity_id: string;
  booking_date: string;
  preferred_time?: string | null;
  guests?: number;
  customer_name?: string;
  activity_name?: string;
}

export default function AssignTripModal({
  booking,
  onClose,
  onAssigned,
}: {
  booking: AssignBooking;
  onClose: () => void;
  onAssigned: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await getTrips(booking.booking_date);
        const eligible = (all as TripRow[]).filter(
          (t) =>
            t.activity_id === booking.activity_id &&
            t.status !== "cancelled" &&
            t.status !== "returned"
        );
        if (!mounted) return;
        setTrips(eligible);
        setSelected(eligible[0]?.id || "");
      } catch (err) {
        if (mounted) setLoadError(err instanceof Error ? err.message : "Failed to load trips");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [booking.id, booking.activity_id, booking.booking_date]);

  function run(fn: () => Promise<unknown>, successMsg: string) {
    startTransition(async () => {
      try {
        await fn();
        onAssigned(successMsg);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Operation failed");
      }
    });
  }

  const available = trips || [];

  return (
    <div
      className="modalOverlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modalCard">
        <div className="modalHeader">
          <h2>Assign {booking.booking_ref}</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody">
          <p style={{ marginBottom: 12 }}>
            <strong>{booking.customer_name || ""}</strong>
            {booking.activity_name ? ` · ${booking.activity_name}` : ""}
            {booking.preferred_time ? ` · preferred ${booking.preferred_time}` : ""}
            {booking.guests ? ` · ${booking.guests} pax` : ""}
          </p>
          {loadError && <div className="walkinError" style={{ marginBottom: 8 }}>{loadError}</div>}
          {trips === null ? (
            <p className="textMuted">Loading trips for {booking.booking_date}…</p>
          ) : available.length > 0 ? (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{ width: "100%" }}
              disabled={pending}
            >
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.trip_ref} · {String(t.start_time || "—")} · {tripRemainingSeats(t)} seats free
                </option>
              ))}
            </select>
          ) : (
            <p className="textMuted" style={{ marginBottom: 8 }}>
              No matching trip on this day for this activity.
            </p>
          )}
          <button
            className="addBtn"
            type="button"
            disabled={pending}
            onClick={() => run(() => quickCreateTripForBookingAction(booking.id), `Created new trip & assigned ${booking.booking_ref}.`)}
            style={{ marginTop: 6 }}
          >
            ＋ Create a new planned trip &amp; assign
          </button>
        </div>
        <div className="modalFooter">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          {available.length > 0 && (
            <button
              type="button"
              className="formSubmit"
              disabled={!selected || pending}
              onClick={() => selected && run(() => assignBookingToTrip(booking.id, selected), `${booking.booking_ref} assigned.`)}
            >
              Assign to Trip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}