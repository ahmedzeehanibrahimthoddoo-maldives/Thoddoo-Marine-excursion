"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { previewCommissionBackfillAction, applyCommissionBackfillAction } from "@/lib/supabase/actions";
import type { CommissionBackfillResult } from "@/lib/supabase/actions";

interface Props {
  from: string;
  to: string;
}

/**
 * Bulk commission repair.
 *
 * The 054/056 split trigger fires on INSERT only, so a rate added to an activity
 * after the fact never reached bookings that already existed — the reason a
 * past trip could only be fixed by opening it one at a time. This recomputes a
 * whole range from each booking's own rule (falling back to the activity's),
 * and it always previews first: the preview runs the identical SQL with
 * p_apply = false, so the number you confirm is the number that gets written.
 */
export default function CommissionBackfill({ from, to }: Props) {
  const [range, setRange] = useState({ from, to });
  const [preview, setPreview] = useState<CommissionBackfillResult | null>(null);
  const [done, setDone] = useState<CommissionBackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;

  function runPreview() {
    if (!valid) {
      setError("Choose a valid date range.");
      return;
    }
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        setPreview(await previewCommissionBackfillAction(range.from, range.to));
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "Preview failed.");
      }
    });
  }

  function runApply() {
    setError(null);
    startTransition(async () => {
      try {
        setDone(await applyCommissionBackfillAction(range.from, range.to));
        setPreview(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Backfill failed.");
      }
    });
  }

  return (
    <div className="adminCard no-print" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Commission backfill</h2>
      <p style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: "0 0 10px" }}>
        Recomputes commission for a date range from each booking&apos;s rule (percentage or fixed,
        in the booking&apos;s currency). Use it after setting a rate on an activity, to catch bookings
        created before it. Cancelled bookings are skipped; a net that still equals the sale is
        treated as never-entered and reduced by the commission.
      </p>

      <div className="reportControls" style={{ marginBottom: 8 }}>
        <label>From <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label>To <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        <button type="button" className="addBtn" onClick={runPreview} disabled={pending || !valid}>
          Preview changes
        </button>
        {preview && preview.changed > 0 ? (
          <button type="button" className="addBtn" onClick={runApply} disabled={pending}>
            {pending ? "Working…" : `Apply to ${preview.changed} booking${preview.changed === 1 ? "" : "s"}`}
          </button>
        ) : null}
      </div>

      {error ? <div className="errorState"><p>{error}</p></div> : null}

      {preview ? (
        <div style={{ fontSize: 13 }}>
          <p style={{ margin: "4px 0" }}>
            <strong>{preview.changed}</strong> booking{preview.changed === 1 ? "" : "s"} would change,
            {" "}<strong>{preview.unchanged}</strong> already correct
            {preview.netsAdjusted > 0 ? (
              <> · net adjusted on {preview.netsAdjusted}</>
            ) : null}
            .
          </p>
          {preview.changed > 0 ? (
            <p style={{ margin: "4px 0" }}>
              Commission {formatMoney(preview.oldCommissionCents, "USD")} →{" "}
              <strong>{formatMoney(preview.newCommissionCents, "USD")}</strong>
              {" "}({preview.newCommissionCents - preview.oldCommissionCents >= 0 ? "+" : ""}
              {formatMoney(preview.newCommissionCents - preview.oldCommissionCents, "USD")})
            </p>
          ) : null}
          {preview.samples.length > 0 ? (
            <details>
              <summary style={{ cursor: "pointer" }}>Sample ({preview.samples.length} of {preview.changed})</summary>
              <table className="dataTable" style={{ marginTop: 8 }}>
                <thead><tr><th>Ref</th><th>Date</th><th>Was</th><th>Becomes</th></tr></thead>
                <tbody>
                  {preview.samples.map((s) => (
                    <tr key={`${s.ref}-${s.date}`}>
                      <td className="mono">{s.ref}</td>
                      <td>{s.date}</td>
                      <td>{formatMoney(s.old_cents, "USD")}</td>
                      <td><strong>{formatMoney(s.new_cents, "USD")}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </div>
      ) : null}

      {done ? (
        <div className="successState" style={{ fontSize: 13, marginTop: 8 }}>
          <p style={{ margin: "4px 0" }}>
            Updated <strong>{done.changed}</strong> booking{done.changed === 1 ? "" : "s"} between {done.from} and {done.to}.
            Commission is now {formatMoney(done.newCommissionCents, "USD")}.
          </p>
        </div>
      ) : null}
    </div>
  );
}