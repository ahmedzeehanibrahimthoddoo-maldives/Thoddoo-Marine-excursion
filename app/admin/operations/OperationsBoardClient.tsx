"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, currencyForDisplay } from "@/lib/money";
import {
  TRIP_STATUS_LABEL, BOAT_STATUS_LABEL, friendlyDate, addDays, maldivesToday,
  manifestList, tripBookedPax, tripRemainingSeats, tripRevenueCents,
  nextTripStatus, TripRow,
} from "@/lib/operations";
import {
  updateTripStatusAction, autoAssignForDate, assignBookingToTrip, unassignBookingFromTrip, quickCreateTripForBookingAction,
  assignTripCrewAction, closeTripBookingsAction,
} from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

interface UnassignedBooking {
  id: string;
  booking_ref: string;
  activity_id: string;
  preferred_time?: string | null;
  guests: number;
  activities?: { name?: string }[] | { name?: string } | null;
  customers?: { full_name?: string }[] | { full_name?: string } | null;
}

export interface CrewOption {
  id: string;
  label: string;
  sub?: string;
}

type MaybeCustomer = { full_name?: string } | { full_name?: string }[] | null | undefined;
type MaybeActivity = { name?: string } | { name?: string }[] | null | undefined;

function firstCustomer(c: MaybeCustomer): { full_name?: string } | undefined {
  if (Array.isArray(c)) return c[0];
  if (c && typeof c === "object") return c as { full_name?: string };
  return undefined;
}

function firstName(a: MaybeActivity): { name?: string } | undefined {
  if (Array.isArray(a)) return a[0];
  if (a && typeof a === "object") return a as { name?: string };
  return undefined;
}

interface Props {
  initialTrips: TripRow[];
  initialUnassigned: UnassignedBooking[];
  crew: CrewOption[];
  date: string;
}

export default function OperationsBoardClient({ initialTrips, initialUnassigned, crew, date }: Props) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripRow[]>(initialTrips);
  const [unassigned, setUnassigned] = useState<UnassignedBooking[]>(initialUnassigned);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [assigning, setAssigning] = useState<UnassignedBooking | null>(null);
  const [crewModalTrip, setCrewModalTrip] = useState<TripRow | null>(null);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function go(days: number) {
    router.push(`/admin/operations?date=${addDays(date, days)}`);
  }

  function refresh() {
    router.refresh();
    setBusy(false);
  }

  async function run(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    try {
      await fn();
      flash("success", successMsg);
      refresh();
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Operation failed");
      setBusy(false);
    }
  }

  async function handleStatus(trip: TripRow, status: string) {
    await run(() => updateTripStatusAction(trip.id, status), `Trip ${trip.trip_ref} → ${TRIP_STATUS_LABEL[status]}`);
  }

  function tripNeedsCrew(trip: TripRow): boolean {
    return (
      (trip.status === "planned" || trip.status === "ready") &&
      !trip.guide_id && !trip.captain_id
    );
  }

  const tripList = useMemo(() => {
    const list = [...trips].sort((a, b) =>
      String(a.start_time || "99:99").localeCompare(String(b.start_time || "99:99"))
    );
    return filter === "all" ? list : list.filter((t) => t.status === filter);
  }, [trips, filter]);

  const totalPax = trips.reduce((s, t) => s + tripBookedPax(t), 0);
  const totalDeparted = trips.filter((t) => t.status === "departed").length;
  const finished = trips.filter((t) => t.status === "returned").length;
  const nextUp = tripList.find((t) => t.status === "planned" || t.status === "ready");

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="opsToolbar">
        <div className="opsDateNav">
          <button className="addBtn" onClick={() => go(-1)}>← {friendlyDate(addDays(date, -1))}</button>
          <a className={`opsTodayBtn ${date === maldivesToday() ? "active" : ""}`} href={`/admin/operations?date=${maldivesToday()}`}>
            Today
          </a>
          <button className="addBtn" onClick={() => go(1)}>{friendlyDate(addDays(date, 1))} →</button>
          <span className="opsDateLabel">{friendlyDate(date)}</span>
        </div>
        <div className="opsToolbarRight">
          <button
            className="addBtn"
            disabled={busy}
            onClick={() => run(
              () => autoAssignForDate(date),
              "Confirmed + paid bookings snapped onto matching trips."
            )}
          >
            ⚡ Auto-attach
          </button>
        </div>
      </div>

      <div className="opsFlowHint">
        <strong>Flow:</strong> Booking confirmed → Payment → <strong>Assign guide/captain</strong> → Ready → Departed (Reception) → Return → Done
      </div>

      <div className="statsGrid opsStats">
        <div className="statCard"><span className="statValue">{trips.length}</span><span className="statLabel">Trips</span></div>
        <div className="statCard"><span className="statValue">{totalPax}</span><span className="statLabel">Pax</span></div>
        <div className="statCard"><span className="statValue">{totalDeparted}<small>/ {finished}</small></span><span className="statLabel">Departed / Returned</span></div>
        <div className="statCard">
          <span className="statValue">{unassigned.length}</span>
          <span className="statLabel">Unassigned (confirmed+paid)</span>
        </div>
        {nextUp && (
          <div className="statCard opsNextUp">
            <span className="statValue">⏱ {nextUp.start_time || "—"}</span>
            <span className="statLabel">
              Next: {String(nextUp.activities?.name || "")} · {String(nextUp.boats?.name || "")} · {nextUp.trip_ref}
            </span>
          </div>
        )}
      </div>

      <div className="filterBar">
        {["all", "planned", "ready", "departed", "returned", "cancelled"].map((s) => (
          <button key={s} className={`filterBtn ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : TRIP_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {tripList.length > 0 ? (
        <div className="opsTimeline">
          {tripList.map((trip) => (
            <div key={trip.id} className={`opsCard opsCard-${trip.status}`}>
              <div className="opsTime">
                <strong>{trip.start_time || "—"}</strong>
                {trip.end_time && <small>– {trip.end_time}</small>}
              </div>
              <div className="opsTripMain">
                <div className="opsTripHead">
                  <h3>
                    {String(trip.activities?.name || "—")}
                    <span className="opsTripRef">{trip.trip_ref}</span>
                  </h3>
                  <span className={`badge badge-trip-${trip.status}`}>{TRIP_STATUS_LABEL[trip.status]}</span>
                  {tripNeedsCrew(trip) && <span className="badge badge-trip-needscrew" title="Assign a guide or captain before this trip can run">Needs crew</span>}
                </div>
                <div className="opsTripMeta">
                  <span>⛵ {String(trip.boats?.name || "No boat")}
                    {trip.boats?.status && trip.boats.status !== "active" && (
                      <small className={`opsBoatStatus opsBoatStatus-${trip.boats.status}`}> · {BOAT_STATUS_LABEL[trip.boats.status]}</small>
                    )}
                  </span>
                  {trip.destination && <span>📍 <strong>{trip.destination}</strong></span>}
                  {trip.transfer_price_cents != null && trip.transfer_price_cents > 0 && (
                    <span className="opsRevenue">💰 {formatMoney(Number(trip.transfer_price_cents), currencyForDisplay(trip.transfer_currency))}</span>
                  )}
                  {trip.guide?.full_name && <span>🧭 {trip.guide.full_name}</span>}
                  {trip.captain?.full_name && <span>⚓ {trip.captain.full_name}</span>}
                  <span>👥 {tripBookedPax(trip)} / {trip.capacity_pax} pax</span>
                  {tripRemainingSeats(trip) > 0 && <span className="opsWalkin">Walk-in seats: {tripRemainingSeats(trip)}</span>}
                  <span className="opsRevenue">
                    Rv {formatMoney(tripRevenueCents(trip), currencyForDisplay("USD"))}
                  </span>
                </div>
                <div className="opsCapacityBar">
                  <div
                    className={`opsCapacityFill ${tripBookedPax(trip) >= trip.capacity_pax ? "full" : ""}`}
                    style={{ width: `${Math.min((tripBookedPax(trip) / Math.max(trip.capacity_pax, 1)) * 100, 100)}%` }}
                  />
                </div>
                {manifestList(trip).length > 0 && (
                  <div className="opsManifest">
                    {manifestList(trip).map((m) => (
                      <span key={m.id} className={`opsGuestChip ${m.checked_in ? "in" : ""}`}>
                        {m.checked_in ? "✓ " : "○ "}{m.guest_name} · {m.pax}
                        {(m.transfer || m.arrival_time) && (
                          <small className="textMuted"> · {m.arrival_time || ""}{m.transfer ? " · " + m.transfer : ""}</small>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="opsTripActions">
                {nextTripStatus(trip.status) && (
                  <button className="addBtn" disabled={busy} onClick={() => handleStatus(trip, nextTripStatus(trip.status)!)}>
                    {nextTripStatus(trip.status) === "ready" ? "✓ Mark Ready" :
                     nextTripStatus(trip.status) === "departed" ? "⛵ Departed" : "↩ Returned"}
                  </button>
                )}
                {trip.status === "returned" && (
                  <button className="addBtn" disabled={busy} onClick={() => run(() => closeTripBookingsAction(trip.id), `Bookings on ${trip.trip_ref} closed.`)}>
                    ✓ Close bookings
                  </button>
                )}
                {trip.status === "planned" || trip.status === "ready" ? (
                  <button className="actionBtn danger" disabled={busy} onClick={() => handleStatus(trip, "cancelled")} title="Cancel trip">
                    ✕
                  </button>
                ) : null}
                {(trip.status === "planned" || trip.status === "ready" || trip.status === "departed") && (
                  <button
                    className="actionBtn"
                    disabled={busy}
                    onClick={() => setCrewModalTrip(trip)}
                    title="Assign guide / captain"
                  >
                    🧭
                  </button>
                )}
                <a className="actionBtn" href={`/admin/manifests?trip=${trip.id}`} title="Manifest">▤</a>
                {trip.activities?.slug && (
                  <a className="actionBtn" href={`/admin/briefings/${trip.activities.slug}`} title="Safety briefing card">📋</a>
                )}
                <a className="actionBtn" href={`/admin/trips?trip=${trip.id}`} title="Edit">✎</a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <p>No trips for this day. Create trips under <a href="/admin/trips">Trips</a> first.</p>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="adminSection">
          <h2>Unassigned — confirmed + paid ({unassigned.length})</h2>
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Ref</th><th>Guest</th><th>Activity</th><th>Time</th><th>Pax</th><th>Assign</th></tr>
              </thead>
              <tbody>
                {unassigned.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.booking_ref}</td>
                    <td>{String(firstCustomer(b.customers)?.full_name || "—")}</td>
                    <td>{String(firstName(b.activities)?.name || "—")}</td>
                    <td>{String(b.preferred_time || "—")}</td>
                    <td>{b.guests}</td>
                    <td>
                      <button className="addBtn" disabled={busy} onClick={() => setAssigning(b)}>
                        Auto →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {assigning && (
        <AssignModal
          booking={assigning}
          trips={trips.filter((t) => t.activity_id === assigning.activity_id && t.status !== "cancelled" && t.status !== "returned")}
          busy={busy}
          onClose={() => setAssigning(null)}
          onAssign={async (tripId) => {
            setBusy(true);
            setAssigning(null);
            await run(() => assignBookingToTrip(assigning.id, tripId), `${assigning.booking_ref} assigned.`);
          }}
          onQuickCreate={async () => {
            setBusy(true);
            setAssigning(null);
            await run(() => quickCreateTripForBookingAction(assigning.id), `Created new trip & assigned ${assigning.booking_ref}.`);
          }}
        />
      )}

      {crewModalTrip && (
        <CrewModal
          trip={crewModalTrip}
          crew={crew}
          busy={busy}
          onClose={() => setCrewModalTrip(null)}
          onSave={async (guideId, captainId) => {
            setCrewModalTrip(null);
            await run(
              () => assignTripCrewAction(crewModalTrip.id, guideId, captainId),
              `Trip ${crewModalTrip.trip_ref} crew updated.`
            );
          }}
        />
      )}
    </>
  );
}

function AssignModal({
  booking, trips, busy, onClose, onAssign, onQuickCreate,
}: {
  booking: UnassignedBooking;
  trips: TripRow[];
  busy: boolean;
  onClose: () => void;
  onAssign: (tripId: string) => void;
  onQuickCreate: () => void;
}) {
  const [selected, setSelected] = useState<string>(trips[0]?.id || "");
  return (
    <div className="modalOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard">
        <div className="modalHeader">
          <h2>Assign {booking.booking_ref}</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody">
          <p style={{ marginBottom: 12 }}>
            <strong>{String(firstCustomer(booking.customers)?.full_name || "")}</strong>
            {firstName(booking.activities)?.name ? ` · ${firstName(booking.activities)!.name}` : ""}
            {booking.preferred_time ? ` · preferred ${booking.preferred_time}` : ""}
            {booking.guests ? ` · ${booking.guests} pax` : ""}
          </p>
          {trips.length > 0 ? (
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%" }}>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.trip_ref} · {String(t.start_time || "—")} · {tripRemainingSeats(t)} seats free
                </option>
              ))}
            </select>
          ) : (
            <p className="textMuted" style={{ marginBottom: 8 }}>No matching trip on this day for this activity.</p>
          )}
          <button className="addBtn" type="button" disabled={busy} onClick={onQuickCreate} style={{ marginTop: 6 }}>
            ＋ Create a new planned trip & assign
          </button>
        </div>
        <div className="modalFooter">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          {trips.length > 0 && (
            <button
              type="button"
              className="formSubmit"
              disabled={!selected || busy}
              onClick={() => selected && onAssign(selected)}
            >
              Assign to Trip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CrewModal({
  trip, crew, busy, onClose, onSave,
}: {
  trip: TripRow;
  crew: CrewOption[];
  busy: boolean;
  onClose: () => void;
  onSave: (guideId: string | null, captainId: string | null) => void;
}) {
  const [guideId, setGuideId] = useState<string>(trip.guide_id || "");
  const [captainId, setCaptainId] = useState<string>(trip.captain_id || "");

  function crewSelect(
    label: string,
    current: string,
    onChange: (v: string) => void,
    placeholder: string
  ) {
    return (
      <div className="formField">
        <label>{label}</label>
        <select value={current} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}>
          <option value="">{placeholder}</option>
          {crew.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}{c.sub ? ` · ${c.sub}` : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="modalOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard">
        <div className="modalHeader">
          <h2>Assign crew — {trip.trip_ref}</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody">
          <p className="textMuted" style={{ marginBottom: 12 }}>
            {trip.guide_id || trip.captain_id
              ? "Change crew for this trip. Nudging to Ready requires a guide or captain."
              : "No crew assigned yet. Assign a guide or captain, then mark the trip Ready."}
          </p>
          {crewSelect("Guide", guideId, setGuideId, "— No guide —")}
          {crewSelect("Captain", captainId, setCaptainId, "— No captain —")}
        </div>
        <div className="modalFooter">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="formSubmit"
            disabled={busy}
            onClick={() => onSave(guideId || null, captainId || null)}
          >
            Save crew
          </button>
        </div>
      </div>
    </div>
  );
}