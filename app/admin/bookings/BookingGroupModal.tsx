"use client";

import { useCallback, useEffect, useState } from "react";
import AdminModal from "@/app/admin/components/AdminModal";
import { confirmBookingGroup, createGroupPayment, getBookingGroup } from "@/lib/supabase/actions";
import { formatMoney, validCurrency } from "@/lib/money";

interface GroupBooking {
  id: string;
  booking_ref: string;
  status: string;
  payment_status: string;
  estimated_total_cents: number;
  total_cents: number;
  booking_currency: string;
  activities?: { name?: string } | { name?: string }[] | null;
}

function activityName(b: GroupBooking): string {
  const a = b.activities;
  if (Array.isArray(a)) return String(a[0]?.name || "—");
  return String(a?.name || "—");
}

export default function BookingGroupModal({
  groupId,
  groupRef,
  onClose,
  showToast,
}: {
  groupId: string;
  groupRef: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [bookings, setBookings] = useState<GroupBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBookings((await getBookingGroup(groupId)) as GroupBooking[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmAll() {
    setBusy(true);
    setError(null);
    try {
      await confirmBookingGroup(groupId);
      showToast("success", "Group confirmed — trips prepared.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm group");
    } finally {
      setBusy(false);
    }
  }

  async function payAll() {
    if (!window.confirm("Record a full payment for every unpaid booking in this group?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createGroupPayment(groupId, "cash");
      showToast("success", `Paid ${res.paidCount} booking(s); ${res.skippedCount} already settled.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pay group");
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = bookings.filter((b) => b.status === "pending").length;

  return (
    <AdminModal open onClose={onClose} title={`Group · ${groupRef}`} wide>
      {error && <div className="formError" role="alert">{error}</div>}
      {loading ? (
        <p className="textMuted">Loading…</p>
      ) : (
        <>
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Ref</th><th>Activity</th><th>Total</th><th>Payment</th><th>Status</th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const total = Number(b.total_cents) > 0 ? Number(b.total_cents) : Number(b.estimated_total_cents) || 0;
                  return (
                    <tr key={b.id}>
                      <td className="mono">{b.booking_ref}</td>
                      <td>{activityName(b)}</td>
                      <td>{formatMoney(total, validCurrency(b.booking_currency))}</td>
                      <td><span className={`badge badge-${b.payment_status}`}>{b.payment_status}</span></td>
                      <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="textMuted" style={{ marginTop: 8 }}>
            {bookings.length} booking(s) share this group reference. Confirming or paying affects all of them.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="addBtn" disabled={busy || pendingCount === 0} onClick={confirmAll}>
              ✓ Confirm all{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
            <button className="addBtn" disabled={busy} onClick={payAll}>
              $ Pay full group
            </button>
          </div>
        </>
      )}
    </AdminModal>
  );
}
