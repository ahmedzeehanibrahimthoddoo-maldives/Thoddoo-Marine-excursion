import { getCashRegisters, getCashRegisterEntries, getOpenCashRegister, getCashReconciliation, getDailySales } from "@/lib/supabase/actions";
import { maldivesToday } from "@/lib/operations";
import { firstOfMonth } from "@/lib/reports";
import type { CashRegisterRow, CashRegisterEntryRow, TillDayFlow } from "@/lib/cashreg";
import type { CashReconciliationDay } from "@/lib/supabase/actions";
import CashRegisterClient from "./CashRegisterClient";

export const metadata = { title: "Cash Register | Thoddoo Marine Admin" };
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CashRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = maldivesToday();
  const from = params.from && DATE_RE.test(params.from) ? params.from : firstOfMonth(today);
  const to = params.to && DATE_RE.test(params.to) ? params.to : today;

  let registers: CashRegisterRow[] = [];
  let openRegister: CashRegisterRow | null = null;
  let entriesByRegister: Record<string, CashRegisterEntryRow[]> = {};

  try {
    const regs = await getCashRegisters(from, to);
    registers = (regs ?? []) as unknown as CashRegisterRow[];
    const open = await getOpenCashRegister();
    openRegister = (open ?? null) as unknown as CashRegisterRow | null;
  } catch {
    registers = [];
    openRegister = null;
  }

  if (registers.length > 0 || (openRegister && openRegister.register_date >= from && openRegister.register_date <= to)) {
    const ids = Array.from(
      new Set([
        ...registers.map((r) => r.id),
        ...(openRegister ? [openRegister.id] : []),
      ])
    );
    if (ids.length > 0) {
      try {
        for (const id of ids) {
          const es = await getCashRegisterEntries(id);
          entriesByRegister[id] = (es ?? []) as unknown as CashRegisterEntryRow[];
        }
      } catch {
        entriesByRegister = {};
      }
    }
  }

  // Cash vs bookings, per day across the visible range — the only place the
  // two sides are compared. Failures are reported instead of hidden, so a
  // broken query can never look like "nothing to reconcile".
  let reconciliation: { days: CashReconciliationDay[] } | null = null;
  let reconciliationError: string | null = null;
  try {
    reconciliation = await getCashReconciliation(from, to);
  } catch (err) {
    reconciliationError = err instanceof Error ? err.message : "Unknown error.";
  }

  // Daily sales (every completed payment, per currency) drive the income
  // figures and the drawer's cash position — the open till's "Income Today",
  // "Cash Received" and "Expected Cash on Hand", plus the History columns.
  // The range is widened to include the open register's date so a filtered
  // view still reports today's takings.
  let dailySales: Record<string, TillDayFlow> | null = null;
  try {
    const openDate = openRegister ? String(openRegister.register_date) : null;
    const salesFrom = openDate && openDate < from ? openDate : from;
    const salesTo = openDate && openDate > to ? openDate : to;
    dailySales = await getDailySales(salesFrom, salesTo);
  } catch {
    dailySales = null;
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Cash Register</h1>
        <p className="adminPageSub">{from} → {to} — daily till: open in the morning, record collections &amp; cash-outs, close and count the till.</p>
      </div>

      <CashRegisterClient
        registers={registers as unknown as Record<string, unknown>[]}
        openRegister={(openRegister as unknown as Record<string, unknown>) || null}
        entriesByRegister={entriesByRegister as unknown as Record<string, Record<string, unknown>>}
        from={from}
        to={to}
        reconciliation={reconciliation}
        reconciliationError={reconciliationError}
        dailySales={dailySales}
      />
    </div>
  );
}