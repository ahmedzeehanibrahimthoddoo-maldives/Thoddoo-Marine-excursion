"use client";

import { useState, useTransition } from "react";
import { fmtDate } from "@/lib/format";
import { formatMoney, validCurrency } from "@/lib/money";
import { voidPaymentAction } from "@/lib/supabase/actions";
import PaymentForm from "./PaymentForm";
import { Toast } from "@/app/admin/components/AdminModal";

interface PaymentPageClientProps {
  payments: Record<string, unknown>[];
}

export default function PaymentPageClient({ payments }: PaymentPageClientProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Record<string, unknown> | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(() => {
      window.location.reload();
    });
  };

  // Pending, failed, refunded and voided rows stay listed (staff need to see
  // them) but only money actually taken counts as collected.
  const completedPayments = payments.filter((p) => String(p.status) === "completed");
  const totalsByCurrency = completedPayments.reduce<Record<string, number>>((acc, p) => {
    const cur = validCurrency(p.currency);
    acc[cur] = (acc[cur] || 0) + ((p.amount_cents as number) || 0);
    return acc;
  }, {});
  const totalSummary = Object.entries(totalsByCurrency)
    .map(([cur, amt]) => formatMoney(amt, cur as "USD" | "MVR"))
    .join(" + ");

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="adminPageHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>Payments</h1>
          <p className="adminPageSub">{completedPayments.length} collected payments — {totalSummary} taken in</p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          + Record Payment
        </button>
      </div>

      {payments.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Booking Ref</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const booking = p.bookings as Record<string, unknown> | undefined;
                const customer = booking?.customers as Record<string, unknown> | undefined;
                const status = String(p.status || "completed");
                const isVoided = status === "voided";
                return (
                  <tr key={p.id as string} style={isVoided ? { opacity: 0.5 } : undefined}>
                    <td className="mono">{(booking?.booking_ref as string) || "—"}</td>
                    <td>{(customer?.full_name as string) || "—"}</td>
                    <td><strong style={isVoided ? { textDecoration: "line-through" } : undefined}>{formatMoney(((p.amount_cents as number) || 0), validCurrency(p.currency))}</strong></td>
                    <td><span className="badge badge-category">{(p.method as string) || "—"}</span></td>
                    <td>{(p.reference as string) || "—"}</td>
                    <td>
                      <span className={`badge badge-${isVoided ? "voided" : "completed"}`}>
                        {isVoided ? "Voided" : "Completed"}
                      </span>
                    </td>
                    <td>{fmtDate(p.created_at as string)}</td>
                    <td>
                      {!isVoided && (
                        <>
                          <a
                            className="actionBtn actionBtn-ok"
                            href={`/api/admin/invoices/payment/${String(p.id)}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View payment receipt (PDF)"
                          >
                            🧾
                          </a>
                          <button
                            className="actionBtn actionBtn-cancelled"
                            onClick={() => setVoidTarget(p)}
                            title="Void this payment"
                          >
                            ↺
                          </button>
                        </>
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
          <p>No payments recorded yet.</p>
        </div>
      )}

      <PaymentForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={refresh} />

      {voidTarget && (
        <VoidModal
          payment={voidTarget}
          onClose={() => setVoidTarget(null)}
          onConfirmed={() => {
            setVoidTarget(null);
            refresh();
          }}
          showToast={setToast}
        />
      )}
    </>
  );
}

function VoidModal({
  payment,
  onClose,
  onConfirmed,
  showToast,
}: {
  payment: Record<string, unknown>;
  onClose: () => void;
  onConfirmed: () => void;
  showToast: (t: { type: "success" | "error"; message: string } | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = formatMoney((payment.amount_cents as number) || 0, validCurrency(payment.currency));
  const booking = payment.bookings as Record<string, unknown> | undefined;

  function handleVoid() {
    setBusy(true);
    voidPaymentAction(String(payment.id), reason.trim() || undefined)
      .then(() => {
        showToast({ type: "success", message: `Payment ${amount} voided.` });
        onConfirmed();
      })
      .catch((err) => {
        showToast({ type: "error", message: err instanceof Error ? err.message : "Failed to void payment" });
        setBusy(false);
      });
  }

  return (
    <div className="modalOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard">
        <div className="modalHeader">
          <h2>Void Payment</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modalBody">
          <p>
            You are about to void a payment of <strong>{amount}</strong> for booking{" "}
            <strong>{(booking?.booking_ref as string) || "—"}</strong>.
          </p>
          <p style={{ marginTop: 8, fontSize: "0.85rem", color: "#647993" }}>
            The payment will be marked as voided and excluded from totals. This action cannot be undone.
          </p>
          <label style={{ display: "block", marginTop: 12 }}>
            <span style={{ fontSize: "0.85rem", color: "#647993" }}>Reason (optional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this payment being voided?"
              style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
          </label>
        </div>
        <div className="modalFooter">
          <button type="button" className="formCancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn"
            style={{ background: "#c0392b", color: "#fff" }}
            disabled={busy}
            onClick={handleVoid}
          >
            {busy ? "Voiding..." : "Void Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}