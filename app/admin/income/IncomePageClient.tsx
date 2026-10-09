"use client";

import { useState } from "react";
import { deleteOtherIncome } from "@/lib/supabase/actions";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import IncomeForm from "./IncomeForm";
import FinanceSyncButton from "@/app/admin/components/FinanceSyncButton";
import { Toast } from "@/app/admin/components/AdminModal";

interface Props {
  initialRows: Record<string, unknown>[];
  from: string;
  to: string;
}

export default function IncomePageClient({ initialRows, from, to }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const presets = [
    { label: "Today", q: `?from=${from}&to=${from}` },
    { label: "This month", q: `?from=${from.slice(0, 8) + "01"}&to=${from}` },
  ];

  function refresh(message: string) {
    setFormOpen(false);
    setEditing(undefined);
    setToast({ type: "success", message });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete(e: Record<string, unknown>) {
    if (!window.confirm(`Delete income "${String(e.title || "")}"? This cannot be undone.`)) return;
    try {
      await deleteOtherIncome(String(e.id));
      refresh("Income entry deleted.");
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to delete." });
    }
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions no-print" style={{ marginBottom: 16 }}>
        <form method="get" action="/admin/income" className="reportControls">
          <label>From <input type="date" name="from" defaultValue={from} /></label>
          <label>To <input type="date" name="to" defaultValue={to} /></label>
          <button type="submit" className="addBtn">Apply</button>
        </form>
        {presets.map((p) => (
          <a key={p.label} href={`/admin/income${p.q}`} className="addBtn">{p.label}</a>
        ))}
        <FinanceSyncButton />
        <button
          className="addBtn"
          onClick={() => { setEditing(undefined); setFormOpen(true); }}
        >
          + Add Income
        </button>
      </div>

      <div className="adminSection">
        <h2>Ledger</h2>
        {initialRows.length > 0 ? (
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
                {initialRows.map((e) => {
                  const cur = e.currency === "MVR" ? "MVR" : "USD";
                  return (
                    <tr key={String(e.id)}>
                      <td>{fmtDate(String(e.income_date))}</td>
                      <td>
                        <strong>{String(e.title || "—")}</strong>
                        {e.payment_id ? (
                          <span className="badge" style={{ marginLeft: 6 }} title="Mirrored from a guest payment — edit the payment instead">
                            Guest payment
                          </span>
                        ) : null}
                      </td>
                      <td><span className="badge badge-category">{String(e.category || "Other")}</span></td>
                      <td>{String(e.vendor || "—")}</td>
                      <td><strong>{formatMoney(Number(e.amount_cents) || 0, cur)}</strong></td>
                      <td className="textTruncate">{String(e.notes || "—")}</td>
                      <td>
                        {e.payment_id ? (
                          <span className="textMuted" style={{ fontSize: "0.75rem" }}>
                            from Payments
                          </span>
                        ) : (
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
                              title="Delete"
                            >
                              🗑
                            </button>
                          </div>
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
            <p>No other income in this range. Add it here or in the Zoho Sheet, then press &quot;Sync Zoho Sheet&quot;.</p>
          </div>
        )}
      </div>

      <IncomeForm
        key={editing ? String(editing.id) : "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        row={editing}
        onSaved={() => refresh(editing?.id ? "Income entry updated." : "Income entry added.")}
      />
    </>
  );
}