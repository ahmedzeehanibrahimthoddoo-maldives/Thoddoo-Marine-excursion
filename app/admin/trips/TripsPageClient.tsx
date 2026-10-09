"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TRIP_STATUS_LABEL, BOAT_STATUS_LABEL, friendlyDate, addDays, maldivesToday,
  manifestList, tripBookedPax, tripRemainingSeats, TripRow,
} from "@/lib/operations";
import { deleteTripAction, updateTripStatusAction } from "@/lib/supabase/actions";
import { buildStaffWhatsAppLink, buildTripAssignmentMessage } from "@/lib/whatsapp";
import { formatMoney, currencyForDisplay } from "@/lib/money";
import TripForm from "./TripForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface SelectOption { id: string; label: string; sub?: string; capacity_pax?: number; status?: string; }

interface Props {
  initialTrips: TripRow[];
  initialActivities: SelectOption[];
  initialBoats: SelectOption[];
  initialCrew: SelectOption[];
  date: string;
  focusTripId?: string;
}

export default function TripsPageClient({ initialTrips, initialActivities, initialBoats, initialCrew, date, focusTripId }: Props) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripRow[]>(initialTrips);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TripRow | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function go(days: number) {
    router.push(`/admin/trips?date=${addDays(date, days)}`);
  }

  function refresh(msg?: string) {
    router.refresh();
    setFormOpen(false);
    setEditingTrip(undefined);
    if (msg) flash("success", msg);
    setBusy(false);
  }

  async function handleDelete(trip: TripRow) {
    if (!confirm(`Delete trip ${trip.trip_ref}? This only works for empty, not-yet-departed trips.`)) return;
    setBusy(true);
    try {
      await deleteTripAction(trip.id);
      setTrips((prev) => prev.filter((t) => t.id !== trip.id));
      refresh(`${trip.trip_ref} deleted.`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to delete trip");
      setBusy(false);
    }
  }

  async function handleStatus(trip: TripRow, status: string) {
    if (trip.status === status) return;
    setBusy(true);
    try {
      await updateTripStatusAction(trip.id, status);
      setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, status } : t)));
      refresh(`${trip.trip_ref} → ${TRIP_STATUS_LABEL[status]}`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed to update trip");
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TripRow[]>();
    for (const t of trips) {
      const key = t.trip_date;
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    }
    const keys = [...map.keys()].sort();
    return keys.map((k) => ({ date: k, trips: map.get(k)!.sort((a, b) =>
      String(a.start_time || "99:99").localeCompare(String(b.start_time || "99:99"))
    ) }));
  }, [trips]);

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="opsToolbar">
        <div className="opsDateNav">
          <button className="addBtn" onClick={() => go(-1)}>← {friendlyDate(addDays(date, -1))}</button>
          <a className={`opsTodayBtn ${date === maldivesToday() ? "active" : ""}`} href={`/admin/trips?date=${maldivesToday()}`}>Today</a>
          <button className="addBtn" onClick={() => go(1)}>{friendlyDate(addDays(date, 1))} →</button>
          <span className="opsDateLabel">Showing {friendlyDate(addDays(date, -RANGE))} – {friendlyDate(addDays(date, RANGE))}</span>
        </div>
        <div className="opsToolbarRight">
          <button className="addBtn" onClick={() => { setEditingTrip(undefined); setFormOpen(true); }}>
            + New Trip
          </button>
        </div>
      </div>

      {grouped.length > 0 ? (
        grouped.map((group) => (
          <div key={group.date} className="adminSection">
            <h2>{friendlyDate(group.date)}</h2>
            <div className="tableWrap">
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Time</th>
                    <th>Product</th>
                    <th>Destination</th>
                    <th>Price</th>
                    <th>Boat</th>
                    <th>Captain</th>
                    <th>Capacity</th>
                    <th>Free</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.trips.map((t) => (
                    <tr key={t.id} id={t.id === focusTripId ? "focus-trip" : undefined} className={t.id === focusTripId ? "rowFocus" : undefined}>
                      <td className="mono">{t.trip_ref}</td>
                      <td>
                        <strong>{t.start_time || "—"}</strong>
                        {t.end_time && <small className="textMuted">–{t.end_time}</small>}
                      </td>
                      <td>{String(t.activities?.name || "—")}</td>
                      <td>{t.destination ? <strong>{t.destination}</strong> : "—"}</td>
                      <td>
                        {t.transfer_price_cents != null && t.transfer_price_cents > 0
                          ? <strong>{formatMoney(Number(t.transfer_price_cents), currencyForDisplay(t.transfer_currency))}</strong>
                          : "—"}
                      </td>
                      <td>{String(t.boats?.name || "No boat")}</td>
                      <td>
                        {String(t.captain?.full_name || "—")}
                        {t.captain?.phone && (
                          <button
                            className="waMini"
                            title="WhatsApp captain"
                            onClick={() => notifyTripPerson(t.captain?.phone, buildTripAssignmentMessage(t.trip_ref, String(t.activities?.name || "activity"), friendlyDate(t.trip_date), t.start_time || "", "captain"))}
                          >💬</button>
                        )}
                      </td>
                      <td>
                        {tripBookedPax(t)} / {t.capacity_pax}
                        <small className="textMuted"> · {manifestList(t).length} booking(s)</small>
                      </td>
                      <td>{tripRemainingSeats(t)} walk-in</td>
                      <td><span className={`badge badge-trip-${t.status}`}>{TRIP_STATUS_LABEL[t.status]}</span></td>
                      <td>
                        <div className="inlineActions">
                          {t.status === "planned" && (
                            <button className="actionBtn" disabled={busy} onClick={() => handleStatus(t, "ready")} title="Mark ready">✓</button>
                          )}
                          {(t.status === "planned" || t.status === "ready") && (
                            <button className="actionBtn actionBtn-cancelled" disabled={busy} onClick={() => handleStatus(t, "cancelled")} title="Cancel trip">✕</button>
                          )}
                          {t.status === "ready" && (
                            <button className="actionBtn actionBtn-departed" disabled={busy} onClick={() => handleStatus(t, "departed")} title="Departed">⛵</button>
                          )}
                          <a className="actionBtn" href={`/admin/manifests?trip=${t.id}`} title="Manifest">▤</a>
                          <button className="actionBtn" disabled={busy} onClick={() => { setEditingTrip(t); setFormOpen(true); }} title="Edit">✎</button>
                          {t.status !== "departed" && t.status !== "returned" && (
                            <button className="actionBtn danger" disabled={busy} onClick={() => handleDelete(t)} title="Delete">🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : (
        <div className="emptyState">
          <p>No trips in this window. Create one to start building the day&apos;s plan.</p>
        </div>
      )}

      <TripForm
        key={editingTrip?.id || "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingTrip(undefined); }}
        trip={editingTrip}
        activities={initialActivities}
        boats={initialBoats}
        crew={initialCrew}
        onSaved={(msg) => refresh(msg)}
      />
    </>
  );
}

function notifyTripPerson(phone: string | null | undefined, message: string) {
  if (!phone) return;
  const link = buildStaffWhatsAppLink(phone, message);
  if (!link) return;
  window.open(link, "_blank");
}

const RANGE = 3;