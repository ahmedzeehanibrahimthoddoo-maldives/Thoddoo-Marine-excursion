"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createQuickInvoice, type QuickInvoiceInput } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import { formatMoney, parseMajorInput, validCurrency, type Currency } from "@/lib/money";

export interface QuickInvoiceActivity {
  id: string;
  label: string;
  sub?: string;
}

export interface QuickInvoiceCreated {
  id: string;
  booking_ref: string;
}

export default function QuickInvoiceModal({
  activities,
  onClose,
  onCreated,
}: {
  activities: QuickInvoiceActivity[];
  onClose: () => void;
  onCreated: (invoice: QuickInvoiceCreated) => void;
}) {
  const [billTo, setBillTo] = useState("");
  const [email, setEmail] = useState("");
  const [activityId, setActivityId] = useState("");
  const [description, setDescription] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [date, setDate] = useState(maldivesToday());
  const [guests, setGuests] = useState("1");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const amountCents = parseMajorInput(amountMajor) || 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!billTo.trim()) {
      setError("Enter the person or company the invoice is for.");
      return;
    }
    if (!activityId) {
      setError("Choose what the invoice is for.");
      return;
    }
    if (amountCents <= 0) {
      setError("Enter the amount to invoice.");
      return;
    }
    if (!agreed) {
      setError("Confirm the guest agreed to the Consent & Liability before raising the invoice.");
      return;
    }

    const input: QuickInvoiceInput = {
      billTo: billTo.trim(),
      email: email.trim(),
      activityId,
      description: description.trim(),
      amountCents,
      currency,
      date,
      guests: Number(guests) || 1,
      guestAgreed: agreed,
    };

    startTransition(async () => {
      try {
        const created = await createQuickInvoice(input);
        setToast({ type: "success", message: `Invoice ${created.booking_ref} created.` });
        setTimeout(() => onCreated(created), 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the invoice.");
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <AdminModal
        open
        onClose={onClose}
        title="New invoice"
        footer={
          <>
            <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              form="quick-invoice-form"
              className="formSubmit"
              disabled={pending}
            >
              {pending
                ? "Creating…"
                : amountCents > 0
                  ? `Create invoice · ${formatMoney(amountCents, validCurrency(currency))}`
                  : "Create invoice"}
            </button>
          </>
        }
      >
        <form id="quick-invoice-form" onSubmit={handleSubmit}>
          {error && <div className="walkinError" style={{ marginBottom: 10 }}>{error}</div>}

          <FormRow cols={2}>
            <FormField label="Bill to" htmlFor="qi-billto" required hint="Person or company paying">
              <input
                id="qi-billto"
                value={billTo}
                onChange={(e) => setBillTo(e.target.value)}
                placeholder="e.g. Veligandu Island Resort"
                autoComplete="off"
              />
            </FormField>
            <FormField
              label="Email"
              htmlFor="qi-email"
              hint="Optional — leave blank and share the PDF on WhatsApp or print it"
            >
              <input
                id="qi-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="off"
              />
            </FormField>
          </FormRow>

          <FormRow cols={2}>
            <FormField label="Invoice for" htmlFor="qi-activity" required hint="Shows as the invoice line item">
              <select id="qi-activity" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                <option value="">Choose a trip or service…</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.sub ? `${a.label} — ${a.sub}` : a.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="What it's for" htmlFor="qi-desc" hint="Printed on the invoice, e.g. Thoddoo → Kuramathi drop, 4 pax">
              <input
                id="qi-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Trip details"
                autoComplete="off"
              />
            </FormField>
          </FormRow>

          <FormRow cols={3}>
            <FormField label={`Amount (${validCurrency(currency)})`} htmlFor="qi-amount" required>
              <input
                id="qi-amount"
                type="text"
                inputMode="decimal"
                value={amountMajor}
                onChange={(e) => setAmountMajor(e.target.value)}
                placeholder="0"
              />
            </FormField>
            <FormField label="Currency" htmlFor="qi-currency">
              <select id="qi-currency" value={currency} onChange={(e) => setCurrency(validCurrency(e.target.value))}>
                <option value="USD">USD</option>
                <option value="MVR">MVR</option>
              </select>
            </FormField>
            <FormField label="Guests" htmlFor="qi-guests">
              <input
                id="qi-guests"
                type="number"
                min={1}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
            </FormField>
          </FormRow>

          <FormRow cols={2}>
            <FormField label="Invoice date" htmlFor="qi-date" required>
              <input id="qi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <div />
          </FormRow>

          <label
            htmlFor="qi-agreed"
            style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 4, fontSize: "0.85rem" }}
          >
            <input
              id="qi-agreed"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              The guest has agreed to the Consent &amp; Liability terms <span className="required">*</span>
            </span>
          </label>
        </form>
      </AdminModal>
    </>
  );
}
