"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteExpense } from "@/lib/supabase/actions";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import ExpenseForm from "./ExpenseForm";
import ExpenseGridModal from "./ExpenseGridModal";
import ExpenseImportModal from "./ExpenseImportModal";
import FinanceSyncButton from "@/app/admin/components/FinanceSyncButton";
import PushToZohoButton from "@/app/admin/components/PushToZohoButton";
import { Toast } from "@/app/admin/components/AdminModal";
import type { ExpenseCategoryTotal, Totals } from "@/lib/reports";

interface Props {
  initialExpenses: Record<string, unknown>[];
  from: string;
  to: string;
  byCategory: ExpenseCategoryTotal[];
}

function dual(t: Totals) {
  return (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>
    </>
  );
}

export default function ExpensePageClient({ initialExpenses, from, to, byCategory }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const presets = [
    { label: "Today", q: `?from=${from}&to=${from}` },
    { label: "Last 7 days", q: `?from=${sevenDaysAgo(from)}&to=${from}` },
    { label: "This month", q: `?from=${from.slice(0, 8) + "01"}&to=${from}` },
  ];

  function refresh(message: string) {
    router.refresh();
    setFormOpen(false);
    setEditing(undefined);
    setToast({ type: "success", message });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete(e: Record<string, unknown>) {
    if (!window.confirm(`Delete expense "${String(e.title || "")}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteExpense(String(e.id));
      refresh("Expense deleted.");
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to delete." });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions no-print" style={{ marginBottom: 16 }}>
        <form method="get" action="/admin/expenses" className="reportControls">
          <label>From <input type="date" name="from" defaultValue={from} /></label>
          <label>To <input type="date" name="to" defaultValue={to} /></label>
          <button type="submit" className="addBtn">Apply</button>
        </form>
        {presets.map((p) => (
          <a key={p.label} href={`/admin/expenses${p.q}`} className="addBtn">{p.label}</a>
        ))}
        <FinanceSyncButton />
        <PushToZohoButton />
        <button
          className="addBtn"
          onClick={() => { setEditing(undefined); setFormOpen(true); }}
        >
          + Add Expense
        </button>
        <button className="addBtn" onClick={() => setGridOpen(true)} title="Enter the month like the bookkeeping sheet">
          ▦ Monthly Grid
        </button>
        <button className="addBtn" onClick={() => setImportOpen(true)} title="Paste rows or load a CSV">
          ⇪ Import
        </button>
      </div>

      {byCategory.length > 0 && (
        <div className="adminSection">
          <h2>Spent by Category</h2>
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Category</th><th>Items</th><th>Total</th></tr>
              </thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.category}>
                    <td><strong>{c.category}</strong></td>
                    <td>{c.count}</td>
                    <td>{dual(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="adminSection">
        <h2>Ledger</h2>
        {initialExpenses.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {initialExpenses.map((e) => {
                  const cur = e.currency === "MVR" ? "MVR" : "USD";
                  return (
                    <tr key={String(e.id)}>
                      <td>{fmtDate(String(e.expense_date))}</td>
                      <td><strong>{String(e.title || "—")}</strong></td>
                      <td><span className="badge badge-category">{String(e.category || "Other")}</span></td>
                      <td>{String(e.vendor || "—")}</td>
                      <td><strong>{formatMoney(Number(e.amount_cents) || 0, cur)}</strong></td>
                      <td className="textTruncate">{String(e.notes || "—")}</td>
                      <td>
                        <div className="inlineActions">
                          <button
                            className="actionBtn"
                            onClick={() => { setEditing(e); setFormOpen(true); }}
                            title="Edit"
                          >
                            ✎
                          </button>
                          <button
                            className="actionBtn actionBtn-cancelled"
                            onClick={() => handleDelete(e)}
                            disabled={deleting}
                            title="Delete"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No expenses in this range. Add one to start tracking costs.</p></div>
        )}
      </div>

      <ExpenseForm
        key={editing ? String(editing.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        expense={editing}
        onSaved={() => refresh(editing?.id ? "Expense updated." : "Expense added.")}
      />
      <ExpenseGridModal
        key="grid"
        open={gridOpen}
        onClose={() => setGridOpen(false)}
        onSaved={() => refresh("Monthly sheet saved.")}
      />
      <ExpenseImportModal
        key="import"
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={() => refresh("Import complete.")}
      />
    </>
  );
}

function sevenDaysAgo(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 6));
  return dt.toISOString().slice(0, 10);
}