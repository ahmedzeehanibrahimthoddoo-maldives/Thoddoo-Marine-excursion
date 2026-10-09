"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyTasks, createConsentForm } from "@/lib/supabase/actions";
import { buildStaffWhatsAppLink, buildConsentInviteMessage } from "@/lib/whatsapp";
import { friendlyDate, TRIP_STATUS_LABEL, tripBookedPax, tripRemainingSeats, type TripRow } from "@/lib/operations";
import { Toast } from "@/app/admin/components/AdminModal";

interface PaymentDue {
  bookingId: string;
  bookingRef: string;
  guestName: string;
  phone?: string | null;
  tripRef?: string | null;
}

interface ConsentPending {
  bookingId: string;
  bookingRef: string;
  guestName: string;
  phone?: string | null;
  tripRef?: string | null;
  tripDate?: string | null;
  activityName?: string | null;
  activityId?: string | null;
  customerId?: string | null;
  signingToken?: string | null;
}

interface MyTasksData {
  trips: TripRow[];
  paymentsDue: PaymentDue[];
  consentsPending: ConsentPending[];
}

export default function MyTasksClient() {
  const [data, setData] = useState<MyTasksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(() => {
    getMyTasks()
      .then((res) => setData(res as unknown as MyTasksData))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tasks."));
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  function openWhatsApp(phone: string | null | undefined, message: string) {
    if (!phone) return;
    const link = buildStaffWhatsAppLink(phone, message);
    if (!link) return;
    window.open(link, "_blank");
  }

  async function sendConsentInvite(c: ConsentPending) {
    if (busyId) return;
    setBusyId(c.bookingId);
    try {
      let token = c.signingToken;
      if (!token) {
        const res = await createConsentForm({
          booking_id: c.bookingId,
          activity_id: c.activityId || "",
          customer_id: c.customerId || "",
          guest_name: c.guestName,
        });
        token = (res as Record<string, unknown>).signing_token as string;
      }
      if (!token) throw new Error("No signing link available yet.");
      const url = `${window.location.origin}/consent/${token}`;
      const message = buildConsentInviteMessage(
        c.guestName,
        c.activityName || "your activity",
        c.tripDate ? friendlyDate(c.tripDate) : "your trip",
        url,
      );
      if (c.phone) {
        openWhatsApp(c.phone, message);
        flash("success", `WhatsApp opened for ${c.guestName}. Send the consent link.`);
      } else {
        await navigator.clipboard.writeText(url);
        flash("success", `No phone on file — consent link copied for ${c.guestName}.`);
      }
      load();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Failed to prepare consent link.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return <div className="errorState"><p>{error}</p></div>;
  }
  if (!data) {
    return <div className="emptyState"><p>Loading your tasks…</p></div>;
  }

  const taskCount = data.trips.length + data.paymentsDue.length + data.consentsPending.length;

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{taskCount}</span><span className="reportStatLabel">Tasks Today</span></div>
        <div className="reportStat"><span className="reportStatValue">{data.trips.length}</span><span className="reportStatLabel">My Trips</span></div>
        <div className="reportStat"><span className="reportStatValue">{data.paymentsDue.length}</span><span className="reportStatLabel">Payment Due</span></div>
        <div className="reportStat"><span className="reportStatValue">{data.consentsPending.length}</span><span className="reportStatLabel">Consents Pending</span></div>
      </div>

      <div className="adminSection">
        <h2>My Trips Today</h2>
        {data.trips.length === 0 ? (
          <div className="emptyState"><p>No trips assigned to you today.</p></div>
        ) : (
          <div className="taskList">
            {data.trips.map((t) => (
              <div key={t.id} className={`taskCard taskCard-${t.status}`}>
                <div className="taskCardHead">
                  <strong>{String(t.activities?.name || "—")}</strong>
                  <span className={`badge badge-trip-${t.status}`}>{TRIP_STATUS_LABEL[t.status]}</span>
                </div>
                <div className="taskCardSub">{t.trip_ref} · {friendlyDate(t.trip_date)} · {String(t.start_time || "—")} · ⛵ {String(t.boats?.name || "—")}</div>
                <div className="taskCardFoot">
                  <span>👥 {tripBookedPax(t)} / {t.capacity_pax} pax</span>
                  <span>Walk-in: {tripRemainingSeats(t)}</span>
                  <a className="addBtn" href={`/admin/manifests?trip=${t.id}`}>Manager</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="adminSection">
        <h2>Payments Due</h2>
        {data.paymentsDue.length === 0 ? (
          <div className="emptyState"><p>No outstanding payments on your trips. Good job.</p></div>
        ) : (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Trip</th><th>Guest</th><th>Booking</th><th></th></tr>
              </thead>
              <tbody>
                {data.paymentsDue.map((p) => (
                  <tr key={p.bookingId}>
                    <td className="mono">{p.tripRef || "—"}</td>
                    <td>{p.guestName}</td>
                    <td className="mono">{p.bookingRef}</td>
                    <td><a className="addBtn" href="/admin/bookings">Collect →</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adminSection">
        <h2>Consents Pending</h2>
        {data.consentsPending.length === 0 ? (
          <div className="emptyState"><p>All guests have signed consent forms. Great!</p></div>
        ) : (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Trip</th><th>Guest</th><th>Activity</th><th></th></tr>
              </thead>
              <tbody>
                {data.consentsPending.map((c) => (
                  <tr key={c.bookingId}>
                    <td className="mono">{c.tripRef || "—"}</td>
                    <td>{c.guestName}</td>
                    <td>{c.activityName || "—"}</td>
                    <td>
                      <button
                        className="addBtn"
                        disabled={busyId === c.bookingId}
                        onClick={() => sendConsentInvite(c)}
                      >
                        {c.signingToken ? "💬 Send link" : "Create & send"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}