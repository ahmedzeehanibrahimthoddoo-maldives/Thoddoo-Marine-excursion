"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createOtherIncome, updateOtherIncome } from "@/lib/supabase/actions";
import { toMajorInput, parseMajorInput } from "@/lib/money";

interface IncomeFormProps {
  open: boolean;
  onClose: () => void;
  row?: Record<string, unknown>;
  onSaved: () => void;
}

const CATEGORIES = ["Boat Hire Income", "Boat Rent", "Charter Income", "Other"];

export default function IncomeForm({ open, onClose, row, onSaved }: IncomeFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    income_date: (row?.income_date as string)?.slice(0, 10) || "",
    title: (row?.title as string) || "",
    category: (row?.category as string) || "Other",
    amount: toMajorInput(Number(row?.amount_cents ?? 0)),
    currency: (row?.currency as string) === "MVR" ? "MVR" : "USD",
    vendor: (row?.vendor as string) || "",
    notes: (row?.notes as string) || "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMajorInput(form.amount);
    if (!form.income_date) {
      setToast({ type: "error", message: "Income date is required." });
      return;
    }
    if (!form.title.trim()) {
      setToast({ type: "error", message: "Title is required." });
      return;
    }
    if (cents <= 0) {
      setToast({ type: "error", message: "Amount must be greater than zero." });
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          expense_date: form.income_date,
          title: form.title.trim(),
          category: form.category.trim() || "Other",
          amount_cents: cents,
          currency: form.currency,
          vendor: form.vendor.trim() || null,
          notes: form.notes.trim() || null,
        };
        if (row?.id) {
          await updateOtherIncome(row.id as string, payload);
        } else {
          await createOtherIncome(payload);
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save income." });
      }
    });
  }

  return (
    <AdminModal open={open} onClose={onClose} title={row?.id ? "Edit Income Entry" : "Add Income Entry"} wide>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Date" htmlFor="inc_date" required>
            <input id="inc_date" type="date" value={form.income_date} onChange={(e) => set("income_date", e.target.value)} />
          </FormField>
          <FormField label="Category" htmlFor="inc_category">
            <input
              id="inc_category"
              type="text"
              list="income-categories"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            />
            <datalist id="income-categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </FormField>
        </FormRow>
        <FormField label="Title" htmlFor="inc_title" required>
          <input id="inc_title" type="text" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Boat hired by X company for a day" />
        </FormField>
        <FormRow cols={2}>
          <FormField label="Amount" htmlFor="inc_amount" required>
            <input id="inc_amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </FormField>
          <FormField label="Currency" htmlFor="inc_currency">
            <select id="inc_currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="USD">USD</option>
              <option value="MVR">MVR</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Vendor / Payer" htmlFor="inc_vendor">
          <input id="inc_vendor" type="text" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Company name" />
        </FormField>
        <FormField label="Notes" htmlFor="inc_notes">
          <textarea id="inc_notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : row?.id ? "Update Income" : "Add Income"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}