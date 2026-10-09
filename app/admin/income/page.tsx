import { getOtherIncome } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import {
  type OtherIncome,
  sumOtherIncomeByCurrency, totals, type Totals, firstOfMonth,
} from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import IncomePageClient from "./IncomePageClient";

export const metadata = { title: "Other Income | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = maldivesToday();
  const from = params.from && DATE_RE.test(params.from) ? params.from : firstOfMonth(today);
  const to = params.to && DATE_RE.test(params.to) ? params.to : today;

  let rows: OtherIncome[] = [];
  try {
    const fetched = await getOtherIncome(from, to);
    rows = (fetched ?? []) as unknown as OtherIncome[];
  } catch {
    rows = [];
  }

  const dual = (t: Totals) => (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>
    </>
  );

  const incomeTotal = totals(sumOtherIncomeByCurrency(rows));

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Other Income</h1>
        <p className="adminPageSub">{from} → {to} — everything received: manual income (our boat hired by another operator, charters) plus guest payments as they are taken. Guest revenue is counted once, in Payments, so reports do not double it.</p>
      </div>

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{rows.length}</span><span className="reportStatLabel">Income entries</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(incomeTotal)}</span><span className="reportStatLabel">Total Received</span></div>
      </div>

      <IncomePageClient
        initialRows={rows as unknown as Record<string, unknown>[]}
        from={from}
        to={to}
      />
    </div>
  );
}