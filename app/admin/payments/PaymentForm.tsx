"use client";

import { useState, useTransition, useEffect } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createPayment, getBookingsForSelect } from "@/lib/supabase/actions";
import { formatMoney, toMajorInput, parseMajorInput, validCurrency } from "@/lib/money";

interface SelectOption {
  id: string;
  label: string;
  sub?: string;
  total_cents?: number;
  paid_cents?: number;
  currency?: string;
}

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CARD_FEE_PCT = 4.5;

export default function PaymentForm({ open, onClose, onSaved }: PaymentFormProps) {
  const [bookingId, setBookingId] = useState("");
  const [amountCents, setAmountCents] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [bookingList, setBookingList] = useState<SelectOption[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setBookingId("");
    setAmountCents("");
    setCurrency("USD");
    setMethod("cash");
    setReference("");
    setNotes("");
    setToast(null);

    getBookingsForSelect()
      .then(setBookingList)
      .catch(() => setToast({ type: "error", message: "Failed to load bookings" }));
  }, [open]);

  const handleSubmit = () => {
    if (!bookingId) {
      setToast({ type: "error", message: "Booking is required" });
      return;
    }
    if (!amountCents || parseInt(amountCents, 10) <= 0) {
      setToast({ type: "error", message: "Amount is required and must be greater than 0" });
      return;
    }

    startTransition(async () => {
      try {
        await createPayment({
          booking_id: bookingId,
          amount_cents: parseMajorInput(amountCents),
          method,
          currency,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setToast({ type: "success", message: "Payment recorded" });
        setTimeout(() => {
          onSaved();
          onClose();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Payment failed" });
      }
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title="Record Payment"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Record Payment"}
          </button>
        </>
      }
    >
      <FormField label="Booking" htmlFor="pay_booking" required>
        <select id="pay_booking" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
          <option value="">Select booking...</option>
          {bookingList.map((b) => (
            <option key={b.id} value={b.id}>{b.label}{b.sub ? ` — ${b.sub}` : ""}</option>
          ))}
        </select>
      </FormField>
      {bookingId && (() => {
        const selected = bookingList.find((b) => b.id === bookingId);
        if (!selected || !selected.total_cents) return null;
        const remaining = Math.max(selected.total_cents - (selected.paid_cents || 0), 0);
        const cur = (selected.currency || "USD") as "USD" | "MVR";
        const cardFee = method === "card" ? Math.round((remaining * CARD_FEE_PCT) / 100) : 0;
        const cardDue = remaining + cardFee;
        return (
          <div style={{ padding: "8px 12px", background: "#f0f9ff", borderRadius: 6, marginBottom: 12, fontSize: "0.85rem" }}>
            <span style={{ color: "#647993" }}>Remaining balance: </span>
            <strong style={{ color: remaining > 0 ? "#c0392b" : "#27ae60" }}>
              {formatMoney(remaining, cur)}
            </strong>
            <span style={{ color: "#94a3b8", marginLeft: 8 }}>
              (Total: {formatMoney(selected.total_cents, cur)}, Paid: {formatMoney(selected.paid_cents || 0, cur)})
            </span>
            {method === "card" && cardFee > 0 && (
              <div style={{ marginTop: 6, borderTop: "1px solid #dbeafe", paddingTop: 6 }}>
                <span style={{ color: "#647993" }}>
                  Card processing ({CARD_FEE_PCT}%): key{" "}
                </span>
                <strong style={{ color: "#0ea5e9" }}>{formatMoney(cardDue, cur)}</strong>
                <span style={{ color: "#647993" }}> into the card terminal; record the quoted amount </span>
                <strong style={{ color: "#c0392b" }}>{formatMoney(remaining, cur)}</strong>
                <span style={{ color: "#647993" }}> (fee not shown on the guest invoice)</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: 8, padding: "2px 8px", fontSize: "0.75rem" }}
                  onClick={() => setAmountCents(toMajorInput(remaining))}
                >
                  Use this amount
                </button>
              </div>
            )}
          </div>
        );
      })()}
      <FormRow cols={3}>
        <FormField label="Amount" htmlFor="pay_amount" required>
          <input
            id="pay_amount"
            type="number"
            step="0.01"
            min="0"
            value={amountCents}
            onChange={(e) => setAmountCents(e.target.value)}
            placeholder="0"
          />
        </FormField>
        <FormField label="Currency" htmlFor="pay_currency">
          <select id="pay_currency" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "MVR")}>
            <option value="USD">USD</option>
            <option value="MVR">MVR</option>
          </select>
        </FormField>
        <FormField label="Method" htmlFor="pay_method">
          <select id="pay_method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="online">Online</option>
          </select>
        </FormField>
      </FormRow>
      <FormField label="Reference" htmlFor="pay_reference">
        <input
          id="pay_reference"
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Transaction reference"
        />
      </FormField>
      <FormField label="Notes" htmlFor="pay_notes">
        <textarea
          id="pay_notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes..."
        />
      </FormField>
      {toast && <Toast type={toast.type} message={toast.message} />}
    </AdminModal>
  );
}
