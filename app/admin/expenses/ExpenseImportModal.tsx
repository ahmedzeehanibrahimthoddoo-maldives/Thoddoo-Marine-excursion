"use client";

import { useRef, useState, useTransition } from "react";
import AdminModal, { FormField, Toast } from "@/app/admin/components/AdminModal";
import { importExpenseRows } from "@/lib/supabase/actions";
import { parseExpenseImport, type ExpenseImportRow } from "@/lib/expenses";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ExpenseImportModal({ open, onClose, onSaved }: Props) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: ExpenseImportRow[]; errors: string[] } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const body = String(reader.result || "");
      setText(body);
      setPreview(parseExpenseImport(body));
    };
    reader.readAsText(file);
  }

  function handlePreview() {
    setToast(null);
    setPreview(parseExpenseImport(text));
  }

  function handleImport() {
    if (!preview || !preview.rows.length) {
      setToast({ type: "error", message: "Nothing to import — paste rows or load a file first." });
      return;
    }
    startTransition(async () => {
      try {
        const result = await importExpenseRows(preview.rows);
        onSaved();
        onClose();
        setText("");
        setPreview(null);
        const skipped = result.skipped ? ` (${result.skipped} skipped)` : "";
        setToast({ type: "success", message: `Imported ${result.imported} expenses${skipped}.` });
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to import." });
      }
    });
  }

  if (!open) return null;

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title="Import expenses (paste / CSV)"
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="button" className="formSubmit" onClick={handleImport} disabled={pending || !preview?.rows.length}>
            {pending ? "Importing…" : `Import ${preview?.rows.length ?? 0} rows`}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <FormField
        label="Rows"
        htmlFor="import_text"
        hint="Paste straight from the sheet (Date | Detail | Liter petrol | Rate | Petrol | …) or a simple ledger (date, title, category, amount, currency). Comma-separated files work too."
      >
        <textarea
          id="import_text"
          rows={8}
          value={text}
          onChange={(e) => { setText(e.target.value); setPreview(null); }}
          placeholder={"Date\tDetail\tLiter petrol\tRate\tPetrol\t…\n10/11/2023\tFuel\t40\t17.31\t692.40\t…"}
        />
      </FormField>
      <div className="formActions" style={{ justifyContent: "flex-start", gap: 8 }}>
        <button type="button" className="addBtn" onClick={() => fileRef.current?.click()}>
          Load .csv / .txt
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          style={{ display: "none" }}
          onChange={handleFile}
        />
        <button type="button" className="formSubmit" onClick={handlePreview} disabled={!text.trim()}>
          Preview
        </button>
      </div>

      {preview && (
        <div style={{ marginTop: 12 }}>
          <p className="textMuted">
            {preview.rows.length} rows ready{preview.errors.length ? `, ${preview.errors.length} skipped` : ""}.
          </p>
          {preview.errors.length > 0 && (
            <ul className="fieldHint" style={{ color: "var(--danger, #b00020)", margin: "4px 0 8px" }}>
              {preview.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
              {preview.errors.length > 6 && <li>…and {preview.errors.length - 6} more.</li>}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div className="tableWrap" style={{ maxHeight: "40vh", overflow: "auto" }}>
              <table className="adminTable">
                <thead>
                  <tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th><th>Currency</th></tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((r, i) => (
                    <tr key={i}>
                      <td>{r.expense_date}</td>
                      <td>{r.title}</td>
                      <td>{r.category}</td>
                      <td>{(r.amount_cents / 100).toFixed(2)}</td>
                      <td>{r.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminModal>
  );
}
