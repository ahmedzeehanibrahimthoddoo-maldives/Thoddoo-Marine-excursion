"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { getExpenseGrid, saveExpenseGrid } from "@/lib/supabase/actions";
import {
  EXPENSE_GRID_COLUMNS,
  monthDates,
  nextMonthStart,
  type ExpenseDraft,
} from "@/lib/expenses";
import { parseMajorInput, toMajorInput } from "@/lib/money";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Defaults to the current Maldives month. */
  initialMonth?: string;
}

type Cell = string;
interface DayRow {
  detail: string;
  litres: string;
  rate: string;
  cells: Record<string, Cell>;
}

function blankRow(): DayRow {
  return { detail: "", litres: "", rate: "", cells: {} };
}

function todayMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** litres × rate → MVR total, the way the sheet computes the petrol cell. */
function fuelTotal(litres: string, rate: string): number {
  const l = parseMajorInput(litres);
  const r = parseMajorInput(rate);
  if (l <= 0 || r <= 0) return 0;
  return l * r;
}

export default function ExpenseGridModal({ open, onClose, onSaved, initialMonth }: Props) {
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(initialMonth || todayMonth());
  const [rows, setRows] = useState<Record<string, DayRow>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const dates = useMemo(() => monthDates(month), [month]);
  const currency = "MVR";

  useEffect(() => {
    if (!open) return;
    setToast(null);
    let cancelled = false;
    setLoading(true);
    getExpenseGrid(month)
      .then((data) => {
        if (cancelled) return;
        const next: Record<string, DayRow> = {};
        for (const d of dates) next[d] = blankRow();
        for (const e of data as Array<Record<string, unknown>>) {
          const date = String(e.expense_date || "");
          const key = String(e.entry_key || "");
          const col = key.split(":")[1] || "";
          const row = next[date] || (next[date] = blankRow());
          const cents = Number(e.amount_cents) || 0;
          if (col === "petrol") {
            const notes = String(e.notes || "");
            const m = /([\d.]+) L × ([\d.]+) MVR\/L/.exec(notes);
            if (m) {
              row.litres = m[1];
              row.rate = m[2];
            }
            row.cells[col] = toMajorInput(cents);
          } else if (col) {
            row.cells[col] = toMajorInput(cents);
          }
          if (e.title && String(e.title) !== colLabel(col)) row.detail = String(e.title);
          if (e.notes && !/[\d.]+ L ×/.test(String(e.notes)) && !row.detail) row.detail = String(e.notes);
        }
        setRows(next);
      })
      .catch((err) => {
        if (!cancelled) setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to load the month." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month]);

  function colLabel(key: string): string {
    return EXPENSE_GRID_COLUMNS.find((c) => c.key === key)?.label || key;
  }

  function setCell(date: string, field: string, value: string) {
    setRows((prev) => {
      const row = prev[date] || blankRow();
      if (field === "detail" || field === "litres" || field === "rate") {
        return { ...prev, [date]: { ...row, [field]: value } };
      }
      return { ...prev, [date]: { ...row, cells: { ...row.cells, [field]: value } } };
    });
  }

  function cellValue(row: DayRow, key: string): number {
    if (key === "petrol") {
      const typed = parseMajorInput(row.cells.petrol || "");
      if (typed > 0) return typed;
      return fuelTotal(row.litres, row.rate);
    }
    return parseMajorInput(row.cells[key] || "");
  }

  function columnTotal(key: string): number {
    return dates.reduce((sum, d) => sum + cellValue(rows[d] || blankRow(), key), 0);
  }

  function grandTotal(): number {
    return EXPENSE_GRID_COLUMNS.reduce((sum, c) => sum + columnTotal(c.key), 0);
  }

  function handleSave() {
    const drafts: ExpenseDraft[] = [];
    for (const date of dates) {
      const row = rows[date];
      if (!row) continue;
      for (const col of EXPENSE_GRID_COLUMNS) {
        const amount = cellValue(row, col.key);
        if (amount <= 0) continue;
        drafts.push({
          entry_key: `${date}:${col.key}`,
          expense_date: date,
          title: (row.detail || "").trim() || col.label,
          category: col.category,
          amount_cents: Math.round(amount * 100),
          currency,
          notes: col.fuel && parseMajorInput(row.litres) > 0 && parseMajorInput(row.rate) > 0
            ? `${row.litres} L × ${row.rate} MVR/L`
            : null,
        });
      }
    }
    if (!drafts.length) {
      setToast({ type: "error", message: "Nothing filled in — enter an amount or litres × rate first." });
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveExpenseGrid(month, drafts);
        onSaved();
        onClose();
        setToast({ type: "success", message: `Saved ${result.saved} rows (${result.cleared} cleared).` });
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save the month." });
      }
    });
  }

  if (!open) return null;

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={`Monthly expense sheet — ${month}`}
      wide
      footer={
        <>
          <div className="textMuted" style={{ marginRight: "auto" }}>
            Grand total <strong>MVR {grandTotal().toFixed(2)}</strong>
          </div>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="button" className="formSubmit" onClick={handleSave} disabled={pending || loading}>
            {pending ? "Saving…" : "Save month"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <FormRow cols={2}>
        <FormField label="Month" htmlFor="grid_month" hint="Re-saving replaces this month's grid rows.">
          <input
            id="grid_month"
            type="month"
            value={month}
            max={nextMonthStart(todayMonth()).slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
          />
        </FormField>
      </FormRow>

      <div className="tableWrap" style={{ maxHeight: "55vh", overflow: "auto" }}>
        <table className="adminTable">
          <thead>
            <tr>
              <th style={{ position: "sticky", top: 0, background: "var(--surface, #fff)", zIndex: 1 }}>Date</th>
              <th style={{ position: "sticky", top: 0, background: "var(--surface, #fff)", zIndex: 1 }}>Detail</th>
              <th style={{ position: "sticky", top: 0, background: "var(--surface, #fff)", zIndex: 1 }}>Litres</th>
              <th style={{ position: "sticky", top: 0, background: "var(--surface, #fff)", zIndex: 1 }}>Rate</th>
              {EXPENSE_GRID_COLUMNS.map((c) => (
                <th key={c.key} style={{ position: "sticky", top: 0, background: "var(--surface, #fff)", zIndex: 1, textAlign: "right" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const row = rows[date] || blankRow();
              return (
                <tr key={date}>
                  <td style={{ whiteSpace: "nowrap" }}>{date.slice(8)}/{date.slice(5, 7)}</td>
                  <td>
                    <input
                      type="text"
                      value={row.detail}
                      placeholder=""
                      onChange={(e) => setCell(date, "detail", e.target.value)}
                      style={{ width: 140 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.litres}
                      onChange={(e) => setCell(date, "litres", e.target.value)}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.rate}
                      onChange={(e) => setCell(date, "rate", e.target.value)}
                      style={{ width: 70 }}
                    />
                  </td>
                  {EXPENSE_GRID_COLUMNS.map((c) => {
                    const value = cellValue(row, c.key);
                    return (
                      <td key={c.key}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={value > 0 ? String(value) : (row.cells[c.key] || "")}
                          placeholder=""
                          onChange={(e) => setCell(date, c.key, e.target.value)}
                          style={{ width: 84, textAlign: "right" }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}><strong>Total ({currency})</strong></td>
              {EXPENSE_GRID_COLUMNS.map((c) => (
                <td key={c.key} style={{ textAlign: "right" }}>
                  <strong>{columnTotal(c.key).toFixed(2)}</strong>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="fieldHint" style={{ marginTop: 8 }}>
        Petrol = litres × rate when left blank. Each filled cell becomes its own expense row, so re-saving the month upserts instead of duplicating.
      </p>
    </AdminModal>
  );
}
