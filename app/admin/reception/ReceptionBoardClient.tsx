"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TRIP_STATUS_LABEL, friendlyDate, addDays, maldivesToday } from "@/lib/operations";
import { markGuestDeparted, markGuestReturned, resetGuestTracking } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

type Maybe<T> = T | T[] | null | undefined;

export interface ReceptionBooking {
  id: string;
  booking_ref: string;
  status: string;
  payment_status: string;
  source: string;
  customers?: Maybe<{ full_name?: string; phone?: string }>;
}

export interface ReceptionTrip {
  id: string;
  trip_ref: string;
  trip_date: string;
  start_time?: string | null;
  end_time?: string | null;
  status: string;
  activities?: Maybe<{ name?: string; category?: string }>;
  boats?: Maybe<{ name?: string }>;
  guide?: Maybe<{ full_name?: string }>;
  captain?: Maybe<{ full_name?: string }>;
}

export interface ReceptionRow {
  id: string;
  pax: number;
  guest_name: string;
  hotel?: string | null;
  room_number?: string | null;
  checked_in: boolean;
  departed_at?: string | null;
  returned_at?: string | null;
  special_requests?: string | null;
  trips: Maybe<ReceptionTrip>;
  bookings: Maybe<ReceptionBooking>;
}

function one<T>(v: Maybe<T>): T | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

type GuestState = "expected" | "out" | "returned";

function guestState(r: ReceptionRow): GuestState {
  if (r.returned_at) return "returned";
  if (r.departed_at) return "out";
  return "expected";
}

const STATE_LABEL: Record<GuestState, string> = {
  expected: "Expected",
  out: "Departed",
  returned: "Returned",
};

export default function ReceptionBoardClient({
  initialRows,
  date,
}: {
  initialRows: ReceptionRow[];
  date: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReceptionRow[]>(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | GuestState>("all");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  function go(days: number) {
    router.push(`/admin/reception?date=${addDays(date, days)}`);
  }

  async function run(row: ReceptionRow, fn: () => Promise<unknown>, message: string) {
    setBusyId(row.id);
    try {
      await fn();
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== row.id) return r;
          if (message.includes("departed")) return { ...r, checked_in: true, departed_at: new Date().toISOString() };
          if (message.includes("returned")) return { ...r, returned_at: new Date().toISOString() };
          return { ...r, departed_at: null, returned_at: null };
        })
      );
      flash("success", message);
      router.refresh();
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Operation failed");
    } finally {
      setBusyId(null);
    }
  }

  const trips = useMemo(() => {
    const map = new Map<string, { trip: ReceptionTrip; rows: ReceptionRow[] }>();
    for (const r of rows) {
      const trip = one(r.trips);
      if (!trip) continue;
      const entry = map.get(trip.id) || { trip, rows: [] };
      entry.rows.push(r);
      map.set(trip.id, entry);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.trip.start_time || "99:99").localeCompare(String(b.trip.start_time || "99:99"))
    );
  }, [rows]);

  const counts = useMemo(() => {
    const all = rows.length;
    const out = rows.filter((r) => guestState(r) === "out").length;
    const returned = rows.filter((r) => guestState(r) === "returned").length;
    return { all, out, returned, expected: all - out - returned };
  }, [rows]);

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips
      .map((t) => ({ ...t, rows: t.rows.filter((r) => guestState(r) === filter) }))
      .filter((t) => t.rows.length > 0);
  }, [trips, filter]);

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="opsToolbar">
        <div className="opsDateNav">
          <button className="addBtn" onClick={() => go(-1)}>← {friendlyDate(addDays(date, -1))}</button>
          <a className={`opsTodayBtn ${date === maldivesToday() ? "active" : ""}`} href={`/admin/reception?date=${maldivesToday()}`}>
            Today
          </a>
          <button className="addBtn" onClick={() => go(1)}>{friendlyDate(addDays(date, 1))} →</button>
          <span className="opsDateLabel">{friendlyDate(date)}</span>
        </div>
      </div>

      <div className="statsGrid opsStats">
        <div className="statCard"><span className="statValue">{counts.all}</span><span className="statLabel">Guests expected</span></div>
        <div className="statCard"><span className="statValue">{counts.expected}</span><span className="statLabel">Still to depart</span></div>
        <div className="statCard"><span className="statValue">{counts.out}</span><span className="statLabel">Currently out</span></div>
        <div className="statCard"><span className="statValue">{counts.returned}</span><span className="statLabel">Returned</span></div>
      </div>

      <div className="filterBar">
        {(["all", "expected", "out", "returned"] as const).map((s) => (
          <button key={s} className={`filterBtn ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : STATE_LABEL[s]}
          </button>
        ))}
      </div>

      {filteredTrips.length > 0 ? (
        <div className="opsTimeline">
          {filteredTrips.map(({ trip, rows: tripRows }) => (
            <div key={trip.id} className={`opsCard opsCard-${trip.status}`}>
              <div className="opsTime">
                <strong>{trip.start_time || "—"}</strong>
                {trip.end_time && <small>– {trip.end_time}</small>}
              </div>
              <div className="opsTripMain">
                <div className="opsTripHead">
                  <h3>
                    {String(one(trip.activities)?.name || "—")}
                    <span className="opsTripRef">{trip.trip_ref}</span>
                  </h3>
                  <span className={`badge badge-trip-${trip.status}`}>
                    {TRIP_STATUS_LABEL[trip.status] || trip.status}
                  </span>
                </div>
                <div className="opsTripMeta">
                  <span>⛵ {String(one(trip.boats)?.name || "No boat")}</span>
                  {one(trip.guide)?.full_name && <span>🧭 {one(trip.guide)!.full_name}</span>}
                  {one(trip.captain)?.full_name && <span>⚓ {one(trip.captain)!.full_name}</span>}
                  <span>👥 {tripRows.reduce((s, r) => s + (r.pax || 0), 0)} pax</span>
                </div>

                <div className="opsManifest receptionGuests">
                  {tripRows.map((r) => {
                    const state = guestState(r);
                    const booking = one(r.bookings);
                    const customer = one(booking?.customers);
                    const disabled = busyId === r.id;
                    return (
                      <div key={r.id} className={`receptionGuest receptionGuest-${state}`}>
                        <div className="receptionGuestInfo">
                          <strong>{r.guest_name}</strong>
                          <small>
                            {booking?.booking_ref ? `${booking.booking_ref} · ` : ""}
                            {r.pax} pax
                            {customer?.phone ? ` · ${customer.phone}` : ""}
                          </small>
                          <small>
                            {customer?.phone ? customer.phone : ""}
                          </small>
                          {(r.hotel || r.room_number) && (
                            <small>{[r.hotel, r.room_number].filter(Boolean).join(" / ")}</small>
                          )}
                          {booking && (
                            <small className="textMuted">
                              <span className={`badge badge-${booking.payment_status}`}>{booking.payment_status}</span>
                              {" · "}{booking.source}
                            </small>
                          )}
                        </div>
                        <div className="receptionGuestActions">
                          <span className={`receptionState receptionState-${state}`}>{STATE_LABEL[state]}</span>
                          {state === "expected" && (
                            <button
                              className="addBtn"
                              disabled={disabled}
                              onClick={() => run(r, () => markGuestDeparted(r.id), "Guest marked departed.")}
                            >
                              ⛵ Depart
                            </button>
                          )}
                          {state === "out" && (
                            <button
                              className="addBtn"
                              disabled={disabled}
                              onClick={() => run(r, () => markGuestReturned(r.id), "Guest marked returned.")}
                            >
                              ↩ Return
                            </button>
                          )}
                          {state !== "expected" && (
                            <button
                              className="actionBtn danger"
                              disabled={disabled}
                              title="Reset tracking"
                              onClick={() => {
                                if (window.confirm("Reset departure/return tracking for this guest?")) {
                                  run(r, () => resetGuestTracking(r.id), "Tracking reset.");
                                }
                              }}
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <p>No guests on the manifest for this day.</p>
        </div>
      )}
    </>
  );
}
