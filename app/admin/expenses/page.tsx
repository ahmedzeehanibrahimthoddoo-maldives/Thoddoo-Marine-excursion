import { getExpenses } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import {
  type Expense,
  sumExpensesByCurrency, expensesByCategory, type Totals, totals, firstOfMonth,
} from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import ExpensePageClient from "./ExpensePageClient";

export const metadata = { title: "Expenses | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = maldivesToday();
  const from = params.from && DATE_RE.test(params.from) ? params.from : firstOfMonth(today);
  const to = params.to && DATE_RE.test(params.to) ? params.to : today;

  let rows: Expense[] = [];
  try {
    const fetched = await getExpenses(from, to);
    rows = (fetched ?? []) as unknown as Expense[];
  } catch {
    rows = [];
  }

  const dual = (t: Totals) => (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>
    </>
  );

  const expenseTotals = totals(sumExpensesByCurrency(rows));
  const byCategory = expensesByCategory(rows);

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Expenses</h1>
        <p className="adminPageSub">{from} → {to} — operating costs (fuel, water, crew, maintenance…) deducted from Net revenue</p>
      </div>

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{rows.length}</span><span className="reportStatLabel">Expenses</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(expenseTotals)}</span><span className="reportStatLabel">Total Spent</span></div>
      </div>

      <ExpensePageClient
        initialExpenses={rows as unknown as Record<string, unknown>[]}
        from={from}
        to={to}
        byCategory={byCategory}
      />
    </div>
  );
}