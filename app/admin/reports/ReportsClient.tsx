"use client";

import { formatMoney } from "@/lib/money";
import type { NamedTotal, DayRow, Totals, ExpenseCategoryTotal } from "@/lib/reports";

export interface ReportStats {
  bookings: number;
  confirmed: number;
  pax: number;
  gross: Totals;
  net: Totals;
  commission: Totals;
  collected: Totals;
  collectedPayments: Totals;
  avg: number;
  expenses?: Totals;
  otherIncome?: Totals;
  profit?: Totals;
}

interface OutstandingRow {
  ref: string;
  name: string;
  activity: string;
  currency: "USD" | "MVR";
  dueCents: number;
}

interface Props {
  from: string;
  to: string;
  stats: ReportStats;
  byActivity: NamedTotal[];
  bySource: NamedTotal[];
  byDay: DayRow[];
  outstanding: OutstandingRow[];
  canFinance: boolean;
  canExpenses?: boolean;
  expenseCategories?: ExpenseCategoryTotal[];
}

function dual(t: Totals) {
  return (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>
    </>
  );
}

export default function ReportsClient({ from, to, stats, byActivity, bySource, byDay, outstanding, canFinance, canExpenses, expenseCategories }: Props) {
  const presets = [
    { label: "Today", q: `?from=${from}&to=${from}` },
    { label: "Last 7 days", q: `?from=${sevenDaysAgo(from)}&to=${from}` },
    { label: "This month", q: `?from=${from.slice(0, 8) + "01"}&to=${from}` },
  ];

  return (
    <>
      <div className="reportActions no-print">
        <form method="get" action="/admin/reports" className="reportControls">
          <label>From <input type="date" name="from" defaultValue={from} /></label>
          <label>To <input type="date" name="to" defaultValue={to} /></label>
          <button type="submit" className="addBtn">Apply</button>
        </form>
        {presets.map((p) => (
          <a key={p.label} href={`/admin/reports${p.q}`} className="addBtn">{p.label}</a>
        ))}
        <button className="addBtn" onClick={() => window.print()}>⎙ Print</button>
      </div>

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{stats.bookings}</span><span className="reportStatLabel">Bookings</span></div>
        <div className="reportStat"><span className="reportStatValue">{stats.confirmed}</span><span className="reportStatLabel">Confirmed</span></div>
        <div className="reportStat"><span className="reportStatValue">{stats.pax}</span><span className="reportStatLabel">Pax</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(stats.gross)}</span><span className="reportStatLabel">Gross</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(stats.net)}</span><span className="reportStatLabel">Net</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(stats.commission)}</span><span className="reportStatLabel">Commission</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(stats.collectedPayments)}</span><span className="reportStatLabel">Collected (cash-in)</span></div>
        {stats.expenses && stats.profit ? (
          <>
            {stats.otherIncome ? (
              <div className="reportStat"><span className="reportStatValue">{dual(stats.otherIncome)}</span><span className="reportStatLabel">Other Income</span></div>
            ) : null}
            <div className="reportStat"><span className="reportStatValue">{dual(stats.expenses)}</span><span className="reportStatLabel">Expenses</span></div>
            <div className="reportStat"><span className="reportStatValue">{dual(stats.profit)}</span><span className="reportStatLabel">Net Profit (Received + Other − Expenses)</span></div>
          </>
        ) : null}
        <div className="reportStat"><span className="reportStatValue">{stats.avg ? formatMoney(stats.avg, "USD") : "—"}</span><span className="reportStatLabel">Avg / Booking</span></div>
      </div>

      <div className="adminSection">
        <h2>Daily Breakdown</h2>
        {byDay.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Day</th><th>Bookings</th><th>Pax</th><th>Gross</th><th>Collected</th></tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.day}>
                    <td><strong>{d.day}</strong></td>
                    <td>{d.bookings}</td>
                    <td>{d.pax}</td>
                    <td>{dual(d.gross)}</td>
                    <td>{dual(d.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No bookings in this range.</p></div>
        )}
      </div>

      <div className="adminSection">
        <h2>By Activity</h2>
        {byActivity.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Activity</th><th>Bookings</th><th>Pax</th><th>Gross</th><th>Collected</th><th>Net</th><th>Commission</th></tr>
              </thead>
              <tbody>
                {byActivity.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.bookings}</td>
                    <td>{r.pax}</td>
                    <td>{dual(r.gross)}</td>
                    <td>{dual(r.collected)}</td>
                    <td>{dual(r.net)}</td>
                    <td>{dual(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>Nothing yet.</p></div>
        )}
      </div>

      <div className="adminSection">
        <h2>By Source</h2>
        {bySource.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Source</th><th>Bookings</th><th>Pax</th><th>Gross</th><th>Collected</th><th>Net</th></tr>
              </thead>
              <tbody>
                {bySource.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.bookings}</td>
                    <td>{r.pax}</td>
                    <td>{dual(r.gross)}</td>
                    <td>{dual(r.collected)}</td>
                    <td>{dual(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>Nothing yet.</p></div>
        )}
      </div>

      {canExpenses && (expenseCategories || []).length > 0 ? (
        <div className="adminSection">
          <h2>Expenses by Category</h2>
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Category</th><th>Items</th><th>Total</th></tr>
              </thead>
              <tbody>
                {(expenseCategories || []).map((c) => (
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
      ) : null}

      {canFinance ? (
        <div className="adminSection">
          <h2>Outstanding Balances</h2>
          {outstanding.length > 0 ? (
            <div className="tableWrap">
              <table className="adminTable reportTable">
                <thead>
                  <tr><th>Ref</th><th>Customer</th><th>Activity</th><th>Due</th></tr>
                </thead>
                <tbody>
                  {outstanding.map((o, i) => (
                    <tr key={`${o.ref}-${i}`}>
                      <td className="mono">{o.ref}</td>
                      <td>{o.name}</td>
                      <td>{o.activity}</td>
                      <td><strong>{formatMoney(o.dueCents, o.currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="emptyState"><p>No unpaid balances.</p></div>
          )}
        </div>
      ) : null}
    </>
  );
}

function sevenDaysAgo(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 6));
  return dt.toISOString().slice(0, 10);
}