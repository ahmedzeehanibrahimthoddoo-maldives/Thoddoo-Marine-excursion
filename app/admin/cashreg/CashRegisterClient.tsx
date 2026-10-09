"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  openCashRegister,
  closeCashRegister,
  addCashRegisterEntry,
  deleteCashRegisterEntry,
  updateCashRegisterNotes,
  searchCashRegisterBookings,
  type CashRegisterBookingCandidate,
  type CashReconciliation,
  type CashReconciliationDay,
} from "@/lib/supabase/actions";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { formatMoney, formatMoney3, parseMajorInput, type Currency3 } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import DenominationCounter from "./DenominationCounter";
import {
  METHOD_LABEL,
  cashRegisterTotals,
  cashRegisterOverShort,
  countTotal,
  ZERO_CURRENCY,
  type CashRegisterMethod,
  type PerCurrency,
  type TillDayFlow,
} from "@/lib/cashreg";

const PICKED_CURRENCIES = new Set<string>(["USD", "MVR", "EUR"]);

/** Minor units back to a plain "12.34" string for the amount input. */
function centsToInput(cents: number | null): string {
  if (!cents || cents <= 0) return "";
  return (cents / 100).toFixed(2);
}

type CashReconciliationPayload = { days: CashReconciliationDay[] };

interface Props {
  registers: Record<string, unknown>[];
  openRegister: Record<string, unknown> | null;
  entriesByRegister: Record<string, Record<string, unknown>>;
  from: string;
  to: string;
  reconciliation: CashReconciliationPayload | null;
  reconciliationError: string | null;
  dailySales: Record<string, TillDayFlow> | null;
}

type Flag = { type: "success" | "error"; message: string };

const METHOD_OPTIONS: { value: CashRegisterMethod; label: string }[] = [
  { value: "cash", label: "Cash received" },
  { value: "card", label: "Card payment" },
  { value: "bank_transfer", label: "Bank transfer received" },
  { value: "bill", label: "Ledger bill (on account)" },
  { value: "expense", label: "Cash paid out (expense)" },
];

const CURRENCY_OPTIONS: { value: Currency3; label: string }[] = [
  { value: "USD", label: "USD" },
  { value: "MVR", label: "MVR" },
  { value: "EUR", label: "EUR" },
];

const METHOD_BADGE: Record<CashRegisterMethod, string> = {
  cash: "badge-paid",
  card: "badge-completed",
  bank_transfer: "badge-confirmed",
  bill: "badge-pending",
  expense: "badge-cancelled",
};

/** Render all three currencies of a per-currency total compactly. */
function triple(t: PerCurrency) {
  return (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      {t.mvrLaari !== 0 && <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>}
      {t.eurCents !== 0 && <small className="textMuted"> / {formatMoney3(t.eurCents, "EUR")}</small>}
    </>
  );
}

const validCurrency3 = (v: string): Currency3 => (v === "MVR" ? "MVR" : v === "EUR" ? "EUR" : "USD");

/**
 * Cash taken against bookings versus cash actually in the till, per day.
 * A non-zero gap means one side is missing entries — usually a collection
 * recorded on the booking but never dropped in the drawer, or the reverse.
 */
function CashReconciliationPanel({
  reconciliation,
  error,
}: {
  reconciliation: CashReconciliationPayload | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="cardHeader">
          <h2>Cash reconciliation</h2>
          <span className="badge badge-cancelled">Unavailable</span>
        </div>
        <p className="textMuted">Could not compare the till with bookings: {error}</p>
      </div>
    );
  }
  if (!reconciliation) return null;

  const days = reconciliation.days;
  const sum = (key: "paymentsCents" | "tillCents") => ({
    usdCents: days.reduce((a, d) => a + d.reconciliation.perCurrency.USD[key], 0),
    mvrLaari: days.reduce((a, d) => a + d.reconciliation.perCurrency.MVR[key], 0),
    eurCents: days.reduce((a, d) => a + d.reconciliation.perCurrency.EUR[key], 0),
  });
  const rangePayments = sum("paymentsCents");
  const rangeTill = sum("tillCents");
  const rangeGap: PerCurrency = {
    usdCents: rangeTill.usdCents - rangePayments.usdCents,
    mvrLaari: rangeTill.mvrLaari - rangePayments.mvrLaari,
    eurCents: rangeTill.eurCents - rangePayments.eurCents,
  };
  const mismatched: Currency3[] = (["USD", "MVR", "EUR"] as const).filter((cur) =>
    cur === "USD" ? rangeGap.usdCents !== 0 : cur === "MVR" ? rangeGap.mvrLaari !== 0 : rangeGap.eurCents !== 0
  );
  const active = days.filter(
    (d) => d.hasRegister || d.reconciliation.mismatchedCurrencies.length > 0
  );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="cardHeader">
        <h2>Cash reconciliation</h2>
        <span className={mismatched.length === 0 ? "badge badgeSuccess" : "badge badgePending"}>
          {mismatched.length === 0 ? "Till matches bookings" : `Gap in ${mismatched.join(", ")}`}
        </span>
      </div>
      {active.length === 0 ? (
        <p className="textMuted">
          No cash was taken against bookings and no till was opened in this range.
        </p>
      ) : (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Till</th>
                <th>Cash vs bookings</th>
                <th>Cash in till</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const rec = d.reconciliation;
                const gap = rec.mismatchedCurrencies.length === 0;
                return (
                  <tr key={d.date}>
                    <td>{fmtDate(d.date)}</td>
                    <td>
                      {d.hasRegister ? (
                        <span className="badge badge-completed">Opened</span>
                      ) : (
                        <span className="badge badge-cancelled">None</span>
                      )}
                    </td>
                    <td>{triple(toPerCurrency(rec, "paymentsCents"))}</td>
                    <td>{triple(toPerCurrency(rec, "tillCents"))}</td>
                    <td>
                      {gap ? (
                        <span className="textMuted">—</span>
                      ) : (
                        <strong className="textDanger">
                          {rec.mismatchedCurrencies
                            .map((cur) => {
                              const v = rec.perCurrency[cur].gapCents;
                              return `${v < 0 ? "−" : "+"}${formatMoney3(Math.abs(v), cur)}`;
                            })
                            .join(" / ")}
                        </strong>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="textMuted" style={{ marginTop: 8 }}>
        Cash recorded against bookings is compared with cash entered in that day&apos;s till. Card, bank
        transfer and ledger-bill money never passes through the drawer, so it is excluded. A − difference
        means cash was collected from a guest but never entered in the till.
      </p>
    </div>
  );
}

/** Flatten one currency metric of a day into the shape the table helpers take. */
function toPerCurrency(rec: CashReconciliation, key: "paymentsCents" | "tillCents" | "gapCents"): PerCurrency {
  return {
    usdCents: rec.perCurrency.USD[key],
    mvrLaari: rec.perCurrency.MVR[key],
    eurCents: rec.perCurrency.EUR[key],
  };
}

export default function CashRegisterClient({
  registers,
  openRegister,
  entriesByRegister,
  from,
  to,
  reconciliation,
  reconciliationError,
  dailySales,
}: Props) {
  const router = useRouter();
  const [toast, setToast] = useState<Flag | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [entryModal, setEntryModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [notesModal, setNotesModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = (openRegister as Record<string, unknown> | null) || null;
  const openId = open ? String(open.id) : null;
  const openEntries = useMemo(() => {
    if (!openId) return [];
    return Object.values(entriesByRegister[openId] || {});
  }, [openId, entriesByRegister]);

  function notify(message: string, type: Flag["type"] = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  function refresh(message: string) {
    setOpenModal(false);
    setEntryModal(false);
    setCloseModal(false);
    setNotesModal(false);
    setBusy(false);
    router.refresh();
    notify(message);
  }

  function presets() {
    return [
      { label: "Today", q: `?from=${to}&to=${to}` },
      { label: "This month", q: `?from=${from.slice(0, 8) + "01"}&to=${to}` },
    ];
  }

  /** The day's payment-derived flow, or null when the sales query failed. */
  function flowFor(date: string): TillDayFlow | null {
    if (!dailySales) return null;
    return dailySales[date] || { income: ZERO_CURRENCY, cash: ZERO_CURRENCY };
  }

  const openFlow = open ? flowFor(String(open.register_date)) : null;

  const openTotals = open
    ? cashRegisterTotals(open as never, openEntries as never, openFlow ? openFlow.cash : ZERO_CURRENCY)
    : null;

  /**
   * Income for a business day: every payment received that day, in the
   * currency it was paid in. The drawer entries are only used as a fallback
   * when the sales query itself failed — otherwise a day with real sales but
   * no typed-in entries (the normal case) would read zero.
   */
  function incomeFor(date: string, entriesIncome: PerCurrency): PerCurrency {
    const flow = flowFor(date);
    return flow ? flow.income : entriesIncome;
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="pageActions no-print" style={{ marginBottom: 16 }}>
        <form method="get" action="/admin/cashreg" className="reportControls">
          <label>From <input type="date" name="from" defaultValue={from} /></label>
          <label>To <input type="date" name="to" defaultValue={to} /></label>
          <button type="submit" className="addBtn">Apply</button>
        </form>
        {presets().map((p) => (
          <a key={p.label} href={`/admin/cashreg${p.q}`} className="addBtn">{p.label}</a>
        ))}
        {open ? (
          <button className="addBtn" onClick={() => setEntryModal(true)}>+ Add Entry</button>
        ) : (
          <button className="addBtn" onClick={() => setOpenModal(true)}>Open Register</button>
        )}
      </div>

      <CashReconciliationPanel reconciliation={reconciliation} error={reconciliationError} />

      {open && openTotals ? (
        <div className="adminSection">
          <div className="adminSectionHeaderRow">
            <h2>Open Till — {fmtDate(String(open.register_date))}</h2>
            <div className="inlineActions">
              {typeof open.notes === "string" && open.notes.trim() && (
                <a className="actionBtn" href={`/admin/cashreg#till-notes`} title="Notes">📝</a>
              )}
              <button className="addBtn" onClick={() => setNotesModal(true)} title="Add / edit till note">
                {typeof open.notes === "string" && open.notes.trim() ? "Edit Note" : "+ Note"}
              </button>
              <button className="addBtn" onClick={() => setCloseModal(true)}>Close Register</button>
            </div>
          </div>

          {typeof open.notes === "string" && open.notes.trim() && (
            <div className="walkinAddGroup" id="till-notes" style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontWeight: 800 }}>Till note:</span>
              <span>{open.notes}</span>
            </div>
          )}

          <div className="reportSummary">
            <div className="reportStat">
              <span className="reportStatValue">
                {triple({
                  usdCents: Number(open.opening_cash_usd_cents) || 0,
                  mvrLaari: Number(open.opening_cash_mvr_laari) || 0,
                  eurCents: Number(open.opening_cash_eur_cents) || 0,
                })}
              </span>
              <span className="reportStatLabel">Opening Cash</span>
            </div>
            <div className="reportStat">
              <span className="reportStatValue">
                {triple(incomeFor(String(open.register_date), openTotals.income))}
              </span>
              <span className="reportStatLabel">Income Today</span>
            </div>
            <div className="reportStat">
              <span className="reportStatValue">
                {triple(openTotals.cashIn)}
              </span>
              <span className="reportStatLabel">Cash Received</span>
            </div>
            <div className="reportStat">
              <span className="reportStatValue">
                {triple(openTotals.cashOut)}
              </span>
              <span className="reportStatLabel">Cash Paid Out</span>
            </div>
            <div className="reportStat">
              <span className="reportStatValue reportStatValue-strong">
                {triple(openTotals.expectedCash)}
              </span>
              <span className="reportStatLabel">Expected Cash on Hand</span>
            </div>
            <div className="reportStat">
              <span className="reportStatValue">
                <small className="textMuted">USD + MVR + EUR counted separately</small>
              </span>
              <span className="reportStatLabel">3-Currency Till</span>
            </div>
          </div>

          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Notes</th>
                  <th>Recorded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {openEntries.length > 0 ? openEntries.map((eRaw, i) => {
                  const e = eRaw as { id: string; method: string; amount_cents: number; currency: string; reference: string | null; notes: string | null; booking_id?: string | null; created_at: string };
                  const cur = validCurrency3(e.currency);
                  return (
                    <tr key={e.id || i}>
                      <td><span className={`badge ${METHOD_BADGE[e.method as CashRegisterMethod] || "badge-pending"}`}>{METHOD_LABEL[e.method as CashRegisterMethod] || e.method}</span></td>
                      <td><strong>{formatMoney3(Number(e.amount_cents) || 0, cur)}</strong></td>
                      <td>
                        {e.booking_id ? (
                          <a className="badge badgePaid" href={`/admin/bookings/${e.booking_id}`}>
                            {e.reference || "Linked"}
                          </a>
                        ) : (
                          e.reference || "—"
                        )}
                      </td>
                      <td className="textTruncate">{e.notes || "—"}</td>
                      <td>{fmtDate(e.created_at)}</td>
                      <td>
                        <button
                          className="actionBtn actionBtn-cancelled"
                          title="Delete"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm("Delete this entry? This cannot be undone.")) return;
                            setBusy(true);
                            deleteCashRegisterEntry(e.id)
                              .then(() => refresh("Entry deleted."))
                              .catch((err) => { notify(err instanceof Error ? err.message : "Failed to delete.", "error"); setBusy(false); });
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={6} className="emptyState"><p>No entries yet. Record your first collection or cash-out.</p></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="adminSection">
          <h2>Till</h2>
          <div className="emptyState">
            <p>No register is open. Open the till at the start of the day with the float, then record every collection and cash-out as it happens.</p>
          </div>
        </div>
      )}

      <div className="adminSection">
        <h2>History</h2>
        {registers.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Opening</th>
                  <th>Income</th>
                  <th>Cash Out</th>
                  <th>Closing Count</th>
                  <th>Over / Short</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {registers.map((rRaw) => {
                  const r = rRaw as { id: string; register_date: string; status: string; opening_cash_usd_cents: number; opening_cash_mvr_laari: number; opening_cash_eur_cents: number; closing_cash_usd_cents: number | null; closing_cash_mvr_laari: number | null; closing_cash_eur_cents: number | null; notes: string | null };
                  const entries = Object.values(entriesByRegister[r.id] || {}) as never[];
                  const flow = flowFor(r.register_date);
                  const cashFromPayments = flow ? flow.cash : ZERO_CURRENCY;
                  const t = cashRegisterTotals(r as never, entries, cashFromPayments);
                  const os = cashRegisterOverShort(r as never, entries, cashFromPayments);
                  const closed = r.status === "closed";
                  return (
                    <tr key={r.id}>
                      <td>{fmtDate(r.register_date)}</td>
                      <td><span className={`badge ${closed ? "badge-completed" : "badge-pending"}`}>{closed ? "Closed" : "Open"}</span></td>
                      <td>
                        {triple({
                          usdCents: Number(r.opening_cash_usd_cents) || 0,
                          mvrLaari: Number(r.opening_cash_mvr_laari) || 0,
                          eurCents: Number(r.opening_cash_eur_cents) || 0,
                        })}
                      </td>
                      <td>
                        {triple(incomeFor(r.register_date, t.income))}
                      </td>
                      <td>
                        {triple(t.cashOut)}
                      </td>
                      <td>
                        {closed ? (
                          triple({
                            usdCents: Number(r.closing_cash_usd_cents) || 0,
                            mvrLaari: Number(r.closing_cash_mvr_laari) || 0,
                            eurCents: Number(r.closing_cash_eur_cents) || 0,
                          })
                        ) : "—"}
                      </td>
                      <td>
                        {closed && os ? (
                          <>
                            <strong className={os.usdCents !== 0 ? (os.usdCents > 0 ? "textOk" : "textDanger") : ""}>
                              {os.usdCents > 0 ? "+" : ""}{formatMoney(os.usdCents, "USD")}
                            </strong>
                            {os.mvrLaari !== 0 && (
                              <small className="textMuted"> / {os.mvrLaari > 0 ? "+" : ""}{formatMoney(os.mvrLaari, "MVR")}</small>
                            )}
                            {os.eurCents !== 0 && (
                              <small className="textMuted"> / {os.eurCents > 0 ? "+" : ""}{formatMoney3(os.eurCents, "EUR")}</small>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="textTruncate">{r.notes ? r.notes : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No registers in this range.</p></div>
        )}
      </div>

      <OpenRegisterModal open={openModal} onClose={() => setOpenModal(false)} onDone={refresh} onError={notify} />
      {open && (
        <EntryModal
          open={entryModal}
          onClose={() => setEntryModal(false)}
          registerId={openId as string}
          onDone={refresh}
          onError={notify}
        />
      )}
      {open && (
        <NotesModal
          open={notesModal}
          onClose={() => setNotesModal(false)}
          registerId={openId as string}
          currentNotes={typeof open.notes === "string" ? open.notes : ""}
          onDone={refresh}
          onError={notify}
        />
      )}
      {open && openTotals && (
        <CloseRegisterModal
          open={closeModal}
          onClose={() => setCloseModal(false)}
          registerId={openId as string}
          expected={openTotals.expectedCash}
          onDone={refresh}
          onError={notify}
        />
      )}
    </>
  );
}

function OpenRegisterModal({ open, onClose, onDone, onError }: {
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string, type: "error") => void;
}) {
  const [pending, setPending] = useState(false);
  const [usdCounts, setUsdCounts] = useState<Record<string, number>>({});
  const [mvrCounts, setMvrCounts] = useState<Record<string, number>>({});
  const [eurCounts, setEurCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    openCashRegister({
      register_date: new Date().toISOString().slice(0, 10),
      opening_cash_usd_cents: countTotal("USD", usdCounts),
      opening_cash_mvr_laari: countTotal("MVR", mvrCounts),
      opening_cash_eur_cents: countTotal("EUR", eurCounts),
      opening_counts_usd: usdCounts,
      opening_counts_mvr: mvrCounts,
      opening_counts_eur: eurCounts,
      notes,
    })
      .then(() => onDone("Cash register opened."))
      .catch((err) => { onError(err instanceof Error ? err.message : "Failed to open register.", "error"); setPending(false); });
  }

  return (
    <AdminModal open={open} onClose={onClose} title="Open Cash Register" wide>
      <form onSubmit={submit}>
        <p className="formHint">
          Record the float (cash on hand) you start the day with by entering how many of each note and coin you have per currency. Leave all empty to start with zero float.
        </p>
        <div className="denomGrid">
          <DenominationCounter currency="USD" counts={usdCounts} onChange={setUsdCounts} />
          <DenominationCounter currency="MVR" counts={mvrCounts} onChange={setMvrCounts} />
          <DenominationCounter currency="EUR" counts={eurCounts} onChange={setEurCounts} />
        </div>
        <FormField label="Notes" htmlFor="open_notes">
          <textarea id="open_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>{pending ? "Opening..." : "Open Register"}</button>
        </div>
      </form>
    </AdminModal>
  );
}

function EntryModal({ open, onClose, registerId, onDone, onError }: {
  open: boolean;
  onClose: () => void;
  registerId: string;
  onDone: (msg: string) => void;
  onError: (msg: string, type: "error") => void;
}) {
  const [pending, setPending] = useState(false);
  const [method, setMethod] = useState<CashRegisterMethod>("cash");
  const [currency, setCurrency] = useState<Currency3>("USD");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingLabel, setBookingLabel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CashRegisterBookingCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Keep the last matched ref so the reference field can be cleared back to it.
  function resetPicker() {
    setBookingId(null);
    setBookingLabel(null);
    setResults([]);
    setSearch("");
    setShowPicker(false);
  }

  async function findBookings() {
    setSearching(true);
    try {
      setResults(await searchCashRegisterBookings(search));
      setShowPicker(true);
    } catch {
      setResults([]);
      setShowPicker(true);
    } finally {
      setSearching(false);
    }
  }

  /** Prefill the till entry from the booking: its currency and amount due. */
  function pickBooking(b: CashRegisterBookingCandidate) {
    setBookingId(b.id);
    setBookingLabel(b.booking_ref);
    setReference(b.booking_ref);
    if (b.currency && PICKED_CURRENCIES.has(b.currency)) setCurrency(b.currency as Currency3);
    if (method === "cash") {
      const due = (b.net_cents || b.total_cents || 0) - (b.cash_paid_cents || 0);
      setAmount(due > 0 ? centsToInput(due) : centsToInput(b.net_cents || b.total_cents));
    }
    setShowPicker(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMajorInput(amount);
    if (cents <= 0) {
      onError("Amount must be greater than zero.", "error");
      return;
    }
    setPending(true);
    addCashRegisterEntry({
      register_id: registerId,
      method,
      amount_cents: cents,
      currency,
      reference,
      notes,
      booking_id: bookingId
    })
      .then((saved) =>
        onDone(
          (saved as { booking_ref?: string | null } | null)?.booking_ref
            ? `Entry recorded and linked to ${(saved as { booking_ref: string }).booking_ref}.`
            : "Entry recorded."
        )
      )
      .catch((err) => { onError(err instanceof Error ? err.message : "Failed to record entry.", "error"); setPending(false); });
  }

  return (
    <AdminModal open={open} onClose={onClose} title="Add Cash Register Entry">
      <form onSubmit={submit}>
        <FormField label="Type" htmlFor="entry_method">
          <select id="entry_method" value={method} onChange={(e) => setMethod(e.target.value as CashRegisterMethod)}>
            {METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
        <div className="formField">
          <label htmlFor="entry_booking_search">Link to booking</label>
          {bookingLabel ? (
            <div className="formActions" style={{ marginTop: 6 }}>
              <span className="badge badgeSuccess">Linked to {bookingLabel}</span>
              <button type="button" className="formCancel" onClick={resetPicker}>Unlink</button>
            </div>
          ) : (
            <div className="formActions" style={{ marginTop: 6 }}>
              <input
                id="entry_booking_search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findBookings(); } }}
                placeholder="Booking ref (OB-260922-6C5E) or recent bookings"
              />
              <button type="button" className="formCancel" onClick={findBookings} disabled={searching}>
                {searching ? "Searching..." : "Find"}
              </button>
            </div>
          )}
          {showPicker && !bookingLabel && (
            <div className="formHint" style={{ marginTop: 8 }}>
              {results.length === 0 ? (
                <span>No bookings found. You can still add the entry and type the ref below — it links automatically.</span>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {results.map((b) => {
                    const due = (b.net_cents || b.total_cents || 0) - (b.cash_paid_cents || 0);
                    return (
                      <li key={b.id} style={{ marginBottom: 4 }}>
                        <button type="button" className="formCancel" style={{ width: "100%", textAlign: "left" }} onClick={() => pickBooking(b)}>
                          <strong>{b.booking_ref}</strong> — {b.activity_name || "Booking"}
                          {b.guest_name ? ` · ${b.guest_name}` : ""} · {fmtDate(b.booking_date)} ·{" "}
                          {b.payment_status || "unpaid"} · due{" "}
                          {formatMoney((due > 0 ? due : b.net_cents || b.total_cents || 0) / 100, (b.currency || "USD") as never)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <FormRow cols={2}>
          <FormField label="Amount" htmlFor="entry_amount" required>
            <input id="entry_amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </FormField>
          <FormField label="Currency" htmlFor="entry_currency">
            <select id="entry_currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency3)}>
              {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormField label="Reference" htmlFor="entry_reference">
          <input id="entry_reference" type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Booking ref, invoice #, guest name" />
        </FormField>
        <FormField label="Notes" htmlFor="entry_notes">
          <textarea id="entry_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>{pending ? "Saving..." : "Add Entry"}</button>
        </div>
      </form>
    </AdminModal>
  );
}

function CloseRegisterModal({ open, onClose, registerId, expected, onDone, onError }: {
  open: boolean;
  onClose: () => void;
  registerId: string;
  expected: PerCurrency;
  onDone: (msg: string) => void;
  onError: (msg: string, type: "error") => void;
}) {
  const [pending, setPending] = useState(false);
  const [usdCounts, setUsdCounts] = useState<Record<string, number>>({});
  const [mvrCounts, setMvrCounts] = useState<Record<string, number>>({});
  const [eurCounts, setEurCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");

  const countedUsd = countTotal("USD", usdCounts);
  const countedMvr = countTotal("MVR", mvrCounts);
  const countedEur = countTotal("EUR", eurCounts);
  const overUsd = countedUsd - expected.usdCents;
  const overMvr = countedMvr - expected.mvrLaari;
  const overEur = countedEur - expected.eurCents;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    closeCashRegister(registerId, {
      closing_cash_usd_cents: countedUsd,
      closing_cash_mvr_laari: countedMvr,
      closing_cash_eur_cents: countedEur,
      closing_counts_usd: usdCounts,
      closing_counts_mvr: mvrCounts,
      closing_counts_eur: eurCounts,
      notes
    })
      .then(() => onDone("Cash register closed."))
      .catch((err) => { onError(err instanceof Error ? err.message : "Failed to close register.", "error"); setPending(false); });
  }

  return (
    <AdminModal open={open} onClose={onClose} title="Close Cash Register" wide>
      <form onSubmit={submit}>
        <div className="reportSummary" style={{ marginBottom: 12 }}>
          <div className="reportStat">
            <span className="reportStatValue">{formatMoney(expected.usdCents, "USD")}</span>
            <span className="reportStatLabel">Expected (USD)</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{formatMoney(expected.mvrLaari, "MVR")}</span>
            <span className="reportStatLabel">Expected (MVR)</span>
          </div>
          <div className="reportStat">
            <span className="reportStatValue">{formatMoney3(expected.eurCents, "EUR")}</span>
            <span className="reportStatLabel">Expected (EUR)</span>
          </div>
        </div>
        <p className="formHint">
          Count the physical cash in the till and enter how many of each note and coin per currency. Each currency&apos;s over/short is auto-calculated against expected.
        </p>
        <div className="denomGrid">
          <DenominationCounter currency="USD" counts={usdCounts} onChange={setUsdCounts} />
          <DenominationCounter currency="MVR" counts={mvrCounts} onChange={setMvrCounts} />
          <DenominationCounter currency="EUR" counts={eurCounts} onChange={setEurCounts} />
        </div>
        <div className="reportSummary" style={{ marginBottom: 12 }}>
          <div className="reportStat">
            <span className={`reportStatValue ${overUsd > 0 ? "textOk" : overUsd < 0 ? "textDanger" : ""}`}>
              {overUsd !== 0 ? (overUsd > 0 ? "+" : "") + formatMoney(overUsd, "USD") : "Balanced"}
            </span>
            <span className="reportStatLabel">Over / Short (USD)</span>
          </div>
          <div className="reportStat">
            <span className={`reportStatValue ${overMvr > 0 ? "textOk" : overMvr < 0 ? "textDanger" : ""}`}>
              {overMvr !== 0 ? (overMvr > 0 ? "+" : "") + formatMoney(overMvr, "MVR") : "Balanced"}
            </span>
            <span className="reportStatLabel">Over / Short (MVR)</span>
          </div>
          <div className="reportStat">
            <span className={`reportStatValue ${overEur > 0 ? "textOk" : overEur < 0 ? "textDanger" : ""}`}>
              {overEur !== 0 ? (overEur > 0 ? "+" : "") + formatMoney3(overEur, "EUR") : "Balanced"}
            </span>
            <span className="reportStatLabel">Over / Short (EUR)</span>
          </div>
        </div>
        <FormField label="Notes" htmlFor="close_notes">
          <textarea id="close_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. discrepancy reason, who counted" />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>{pending ? "Closing..." : "Close Register"}</button>
        </div>
      </form>
    </AdminModal>
  );
}

function NotesModal({ open, onClose, registerId, currentNotes, onDone, onError }: {
  open: boolean;
  onClose: () => void;
  registerId: string;
  currentNotes: string;
  onDone: (msg: string) => void;
  onError: (msg: string, type: "error") => void;
}) {
  const [pending, setPending] = useState(false);
  const [notes, setNotes] = useState(currentNotes);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    updateCashRegisterNotes(registerId, notes)
      .then(() => onDone("Till note updated."))
      .catch((err) => { onError(err instanceof Error ? err.message : "Failed to save note.", "error"); setPending(false); });
  }

  return (
    <AdminModal open={open} onClose={onClose} title="Till Note">
      <form onSubmit={submit}>
        <p className="formHint">
          Add a note to this open till — e.g. who opened it, float given, mid-day transfers, or a reason for a discrepancy. It stays on the register record.
        </p>
        <FormField label="Notes" htmlFor="till_notes">
          <textarea id="till_notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. opened with $200 + MVR 1,000 float" />
        </FormField>
        <div className="formActions">
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="formSubmit" disabled={pending}>{pending ? "Saving..." : "Save Note"}</button>
        </div>
      </form>
    </AdminModal>
  );
}