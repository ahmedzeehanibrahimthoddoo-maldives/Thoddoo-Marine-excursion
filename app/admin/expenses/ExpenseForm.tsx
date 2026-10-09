"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createExpense, updateExpense } from "@/lib/supabase/actions";
import { toMajorInput, parseMajorInput } from "@/lib/money";
import { EXPENSE_CATEGORIES, normalizeExpenseCategory } from "@/lib/expenses";

interface ExpenseFormProps {
  open: boolean;
  onClose: () => void;
  expense?: Record<string, unknown>;
  onSaved: () => void;
}

// Only the sheet's P&L lines — no free-typed categories, so the ledger
// always rolls up the way the monthly sheet does.
const CATEGORIES: string[] = [...EXPENSE_CATEGORIES];

export default function ExpenseForm({ open, onClose, expense, onSaved }: ExpenseFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    expense_date: (expense?.expense_date as string)?.slice(0, 10) || "",
    title: (expense?.title as string) || "",
    category: normalizeExpenseCategory((expense?.category as string) || ""),
    amount: toMajorInput(Number(expense?.amount_cents ?? 0)),
    currency: (expense?.currency as string) === "MVR" ? "MVR" : "USD",
    vendor: (expense?.vendor as string) || "",
    notes: (expense?.notes as string) || "",
  });

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMajorInput(form.amount);
    if (!form.expense_date) {
      setToast({ type: "error", message: "Expense date is required." });
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
          expense_date: form.expense_date,
          title: form.title.trim(),
          category: normalizeExpenseCategory(form.category),
          amount_cents: cents,
          currency: form.currency,
          vendor: form.vendor.trim() || null,
          notes: form.notes.trim() || null,
        };
        if (expense?.id) {
          await updateExpense(expense.id as string, payload);
        } else {
          await createExpense(payload);
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save expense." });
      }
    });
  }

  return (
    <AdminModal open={open} onClose={onClose} title={expense?.id ? "Edit Expense" : "Add Expense"} wide>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Date" htmlFor="exp_date" required>
            <input id="exp_date" type="date" value={form.expense_date} onChange={(e) => set("expense_date", e.target.value)} />
          </FormField>
          <FormField label="Category" htmlFor="exp_category" hint="The sheet's P&L lines only.">
            <select
              id="exp_category"
              value={CATEGORIES.includes(form.category) ? form.category : "Other"}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormField label="Title" htmlFor="exp_title" required>
          <input id="exp_title" type="text" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Diesel refill 40L" />
        </FormField>
        <FormRow cols={2}>
          <FormField label="Amount" htmlFor="exp_amount" required>
            <input id="exp_amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </FormField>
          <FormField label="Currency" htmlFor="exp_currency">
            <select id="exp_currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="USD">USD</option>
              <option value="MVR">MVR</option>
            </select>
          </FormField>
        </FormRow>
        <FormField label="Vendor" htmlFor="exp_vendor">
          <input id="exp_vendor" type="text" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Fuel station name" />
        </FormField>
        <FormField label="Notes" htmlFor="exp_notes">
          <textarea id="exp_notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : expense?.id ? "Update Expense" : "Add Expense"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}