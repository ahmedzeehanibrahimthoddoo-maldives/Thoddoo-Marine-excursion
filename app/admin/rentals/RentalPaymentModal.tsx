"use client";

import { useState, useTransition } from "react";
import { formatMoney, toMajorInput, parseMajorInput, validCurrency } from "@/lib/money";
import { createRentalPayment } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";

interface RentalPaymentModalProps {
  rental: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}

export default function RentalPaymentModal({ rental, onClose, onSaved }: RentalPaymentModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const currency = validCurrency(rental.currency);
  const payableTotal =
    (Number(rental.rental_charge_cents) || 0) + (Number(rental.additional_charges_cents) || 0);
  const paymentsArr = (rental.payments as { amount_cents?: number; converted_amount_cents?: number; status?: string }[]) || [];
  const paid = paymentsArr
    .filter((p) => String(p.status) === "completed")
    .reduce((s, p) => s + Math.round(Number(p.converted_amount_cents ?? p.amount_cents ?? 0) || 0), 0);
  const balance = Math.max(payableTotal - paid, 0);

  const [amountMajor, setAmountMajor] = useState(toMajorInput(balance));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const amountCents = parseMajorInput(amountMajor) || 0;

  function handleSubmit() {
    setError(null);
    const amt = amountCents;
    if (amt <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (amt > balance && balance > 0) {
      setError(`Entering ${formatMoney(amt, currency)} is more than the outstanding ${formatMoney(balance, currency)}.`);
      return;
    }
    startTransition(async () => {
      try {
        await createRentalPayment({
          rental_id: rental.id,
          amount_cents: amt,
          currency,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
        });
        setToast({ type: "success", message: "Rental payment recorded." });
        setTimeout(() => {
          onSaved();
        }, 800);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Payment recording failed.");
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="modalOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modalCard">
          <div className="modalHeader">
            <h2>Collect Rental Payment</h2>
            <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modalBody">
            {error && <div className="walkinError" style={{ marginBottom: 8 }}>{error}</div>}
            <div className="reportSummary" style={{ marginBottom: 12 }}>
              <div className="reportStat">
                <span className="reportStatValue">{formatMoney(payableTotal, currency)}</span>
                <span className="reportStatLabel">Total Due</span>
              </div>
              <div className="reportStat">
                <span className="reportStatValue">{formatMoney(paid, currency)}</span>
                <span className="reportStatLabel">Paid</span>
              </div>
              <div className="reportStat">
                <span className="reportStatValue">{formatMoney(balance, currency)}</span>
                <span className="reportStatLabel">Balance</span>
              </div>
            </div>

            <div className="formRow" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 8 }}>
              <label className="formGroup">
                <span>Amount ({currency})</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountMajor}
                  placeholder="0"
                  onChange={(e) => setAmountMajor(e.target.value)}
                />
              </label>
              <label className="formGroup">
                <span>Method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
            </div>
            <div className="formRow" style={{ gridTemplateColumns: "1fr", marginBottom: 8 }}>
              <label className="formGroup">
                <span>Reference (optional)</span>
                <input
                  type="text"
                  value={reference}
                  placeholder="e.g. card last 4, transaction ID"
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
            <div className="formRow" style={{ gridTemplateColumns: "1fr", marginBottom: 8 }}>
              <label className="formGroup">
                <span>Notes (optional)</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional context"
                />
              </label>
            </div>
            <p className="textMuted" style={{ fontSize: "0.78rem" }}>
              Payment currency must match the rental currency ({currency}).
            </p>
          </div>
          <div className="modalFooter">
            <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="formSubmit"
              disabled={isPending}
              onClick={handleSubmit}
            >
              {isPending ? "Recording…" : `Record ${formatMoney(amountCents || 0, currency)}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}