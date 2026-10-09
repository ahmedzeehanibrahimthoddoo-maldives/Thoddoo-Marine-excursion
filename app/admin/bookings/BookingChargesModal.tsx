"use client";

import { useCallback, useEffect, useState } from "react";
import AdminModal, { FormField, FormRow } from "@/app/admin/components/AdminModal";
import { addBookingCharge, getBookingCharges, voidBookingCharge } from "@/lib/supabase/actions";
import { formatMoney, validCurrency } from "@/lib/money";

interface Charge {
  id: string;
  category: string;
  description: string;
  amount_cents: number;
  currency: string;
  converted_amount_cents: number;
  quotation_reference?: string | null;
  notes?: string | null;
  created_at: string;
  voided_at?: string | null;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "equipment_damage", label: "Equipment damage" },
  { value: "vessel_damage", label: "Vessel / engine damage" },
  { value: "jetski_capsize", label: "Jet-ski capsize / recovery" },
  { value: "fuel", label: "Fuel" },
  { value: "late_return", label: "Late return" },
  { value: "accident", label: "Accident / injury cost" },
  { value: "other", label: "Other" },
];

export default function BookingChargesModal({
  bookingId,
  bookingRef,
  onClose,
  showToast,
}: {
  bookingId: string;
  bookingRef: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState("equipment_damage");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [quotation, setQuotation] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCharges((await getBookingCharges(bookingId)) as Charge[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load charges");
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setError(null);
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (description.trim().length < 3) {
      setError("Please describe the charge.");
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    setBusy(true);
    try {
      await addBookingCharge({
        bookingId,
        category,
        description,
        amountCents,
        currency,
        quotationReference: quotation || undefined,
        notes: notes || undefined,
      });
      showToast("success", "Charge added to the booking total.");
      setDescription("");
      setAmount("");
      setQuotation("");
      setNotes("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add charge");
    } finally {
      setBusy(false);
    }
  }

  async function voidOne(id: string) {
    if (!window.confirm("Void this charge and reduce the booking total?")) return;
    setBusy(true);
    try {
      await voidBookingCharge(id);
      showToast("success", "Charge voided.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void charge");
    } finally {
      setBusy(false);
    }
  }

  const activeTotal = charges
    .filter((c) => !c.voided_at)
    .reduce((s, c) => s + c.converted_amount_cents, 0);

  return (
    <AdminModal open onClose={onClose} title={`Charges · ${bookingRef}`} wide>
      {error && <div className="formError" role="alert">{error}</div>}

      <div className="adminSection">
        <h3 style={{ marginBottom: 8 }}>Recorded charges</h3>
        {loading ? (
          <p className="textMuted">Loading…</p>
        ) : charges.length === 0 ? (
          <p className="textMuted">No charges recorded.</p>
        ) : (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Category</th><th>Description</th><th>Amount</th><th>Quotation</th><th>Added</th><th></th></tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id} style={c.voided_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                    <td>{CATEGORIES.find((x) => x.value === c.category)?.label || c.category}</td>
                    <td>{c.description}</td>
                    <td>{formatMoney(c.amount_cents, validCurrency(c.currency))}</td>
                    <td>{c.quotation_reference || "—"}</td>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                      {!c.voided_at && (
                        <button className="actionBtn danger" disabled={busy} onClick={() => voidOne(c.id)} title="Void">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="textMuted" style={{ marginTop: 8 }}>
          Active charges add to the booking total — collect them through the normal payment flow.
        </p>
      </div>

      <div className="adminSection">
        <h3 style={{ marginBottom: 8 }}>Add a charge</h3>
        <FormRow>
          <FormField label="Category" htmlFor="chg-cat" required>
            <select id="chg-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Amount" htmlFor="chg-amount" required>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="chg-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                style={{ flex: 1 }}
              />
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 90 }}>
                <option value="USD">USD</option>
                <option value="MVR">MVR</option>
              </select>
            </div>
          </FormField>
        </FormRow>
        <FormField label="Description" htmlFor="chg-desc" required>
          <input
            id="chg-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Bent propeller after reef contact"
          />
        </FormField>
        <FormRow>
          <FormField label="Quotation reference" htmlFor="chg-quote" hint="Dealership / workshop quotation number">
            <input id="chg-quote" type="text" value={quotation} onChange={(e) => setQuotation(e.target.value)} />
          </FormField>
          <FormField label="Notes" htmlFor="chg-notes">
            <input id="chg-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </FormRow>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span className="textMuted">Active charges total: <strong>{formatMoney(activeTotal, "USD")}</strong></span>
          <button className="formSubmit" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Add charge"}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}
