// =============================================
// Thoddoo Marine — Cash register (daily till)
// =============================================
// Types + pure helpers for the daily cash register:
//   a register is opened with a float (cash on hand), collections are
//   recorded per method (cash / card / bank transfer / ledger bill,
//   plus cash paid OUT as expenses), then the register is closed by
//   counting the cash remaining.
//
// Money stays in its own currency — USD, MVR and EUR are tracked
// separately (no cross-currency conversion). The physical count is
// entered as note/coin quantities (denominations); total is derived.
//
// Cash position per currency:
//   cash in   = the day's completed cash payments + any ad-hoc drawer entry
//               (an entry linked to a booking is the same money as the
//               payment for it, so it is not counted twice)
//   expected = opening + cash in − cash out (expenses)
//   over/short = counted (closing) − expected
//
// 'bill' is an on-account receivable (money owed, not yet collected as
// cash) — it counts toward revenue but NOT toward cash on hand.
// =============================================

import { currency3ForDisplay, formatMoney3, type Currency3 } from "@/lib/money";

export type CashRegisterMethod = "cash" | "card" | "bank_transfer" | "bill" | "expense";

export const CASH_REGISTER_METHODS: CashRegisterMethod[] = [
  "cash",
  "card",
  "bank_transfer",
  "bill",
  "expense",
];

export const METHOD_LABEL: Record<CashRegisterMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
  bill: "Ledger Bill (on account)",
  expense: "Cash Paid Out",
};

export const CASH_IN_METHODS: CashRegisterMethod[] = ["cash", "card", "bank_transfer", "bill"];

export const CASH_REGISTER_CURRENCIES: Currency3[] = ["USD", "MVR", "EUR"];

/** Minor units per currency — cents for USD/EUR, laari for MVR. */
export type CashCurrency = Currency3;

export interface CashRegisterRow {
  id: string;
  register_date: string;
  status: "open" | "closed";
  opening_cash_usd_cents: number;
  opening_cash_mvr_laari: number;
  opening_cash_eur_cents: number;
  closing_cash_usd_cents: number | null;
  closing_cash_mvr_laari: number | null;
  closing_cash_eur_cents: number | null;
  opening_counts: Record<string, number> | null;
  closing_counts: Record<string, number> | null;
  notes: string | null;
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface CashRegisterEntryRow {
  id: string;
  register_id: string;
  method: CashRegisterMethod;
  amount_cents: number;
  currency: Currency3 | string;
  reference: string | null;
  notes: string | null;
  booking_id: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface PerCurrency {
  usdCents: number;
  mvrLaari: number;
  eurCents: number;
}

export interface CashRegisterTotals {
  /** All money taken in for the day (cash+card+bank+bill), per currency. */
  income: PerCurrency;
  /** Pure cash received, per currency. */
  cashIn: PerCurrency;
  /** Cash paid OUT (expense), per currency. */
  cashOut: PerCurrency;
  /** Expected cash on hand: opening + cashIn − cashOut, per currency. */
  expectedCash: PerCurrency;
}

export function entryCurrency(e: Pick<CashRegisterEntryRow, "currency">): Currency3 {
  return currency3ForDisplay(e.currency);
}

function sum(
  t: PerCurrency,
  e: Pick<CashRegisterEntryRow, "amount_cents" | "currency">
): PerCurrency {
  const cur = entryCurrency(e);
  const n = Number(e.amount_cents) || 0;
  if (cur === "MVR") return { ...t, mvrLaari: t.mvrLaari + n };
  if (cur === "EUR") return { ...t, eurCents: t.eurCents + n };
  return { ...t, usdCents: t.usdCents + n };
}

/** Aggregate entries into income / cash-in / cash-out totals.
 *
 * `cashFromPayments` folds in the cash the books say was taken (completed
 * `payments` with method 'cash' for that day). Drawer entries only ever
 * contain what staff typed in — usually nothing — so without it "Cash
 * Received" reads zero and "Expected Cash on Hand" never grows past the
 * float. A booking-linked cash entry is deliberately NOT added on top: it
 * mirrors a payment that is already counted, and the reconciliation panel
 * is the thing that flags the two sides disagreeing.
 */
export function cashRegisterTotals(
  register: Pick<
    CashRegisterRow,
    | "opening_cash_usd_cents"
    | "opening_cash_mvr_laari"
    | "opening_cash_eur_cents"
  >,
  entries: CashRegisterEntryRow[],
  cashFromPayments: PerCurrency = ZERO_CURRENCY
): CashRegisterTotals {
  let income: PerCurrency = { usdCents: 0, mvrLaari: 0, eurCents: 0 };
  let cashIn: PerCurrency = { ...cashFromPayments };
  let cashOut: PerCurrency = { usdCents: 0, mvrLaari: 0, eurCents: 0 };

  for (const e of entries) {
    if (e.method === "expense") {
      cashOut = sum(cashOut, e);
      continue;
    }
    income = sum(income, e);
    if (e.method === "cash" && !e.booking_id) {
      cashIn = sum(cashIn, e);
    }
  }

  const opening: PerCurrency = {
    usdCents: Number(register.opening_cash_usd_cents) || 0,
    mvrLaari: Number(register.opening_cash_mvr_laari) || 0,
    eurCents: Number(register.opening_cash_eur_cents) || 0,
  };

  return {
    income,
    cashIn,
    cashOut,
    expectedCash: {
      usdCents: opening.usdCents + cashIn.usdCents - cashOut.usdCents,
      mvrLaari: opening.mvrLaari + cashIn.mvrLaari - cashOut.mvrLaari,
      eurCents: opening.eurCents + cashIn.eurCents - cashOut.eurCents,
    },
  };
}

/** Zero in all three currencies — the neutral value for a day with no sales. */
export const ZERO_CURRENCY: PerCurrency = { usdCents: 0, mvrLaari: 0, eurCents: 0 };

/** One day's money flow, as the till reads it: all income, and the cash part. */
export interface TillDayFlow {
  /** Every completed payment received that day, per currency. */
  income: PerCurrency;
  /** The cash-only slice of those payments — what physically hits the drawer. */
  cash: PerCurrency;
}

/**
 * Daily sales: every payment received, bucketed into the currency it was
 * actually paid in. The drawer's own income (entries) is only what staff
 * typed in — in practice usually nothing — so the till's income figure is
 * read from here instead, otherwise a day with real sales reads zero.
 */
export function salesPerCurrency(
  payments: Array<Pick<CashPaymentLike, "amount_cents" | "currency">>
): PerCurrency {
  let out: PerCurrency = { ...ZERO_CURRENCY };
  for (const p of payments || []) {
    out = sum(out, { amount_cents: p.amount_cents ?? 0, currency: p.currency || "USD" });
  }
  return out;
}

/**
 * The cash slice of those same payments: card, bank transfer and ledger
 * money never enters the drawer, so only method 'cash' counts toward the
 * cash position.
 */
export function cashPerCurrency(
  payments: Array<Pick<CashPaymentLike, "amount_cents" | "currency"> & { method?: string | null }>
): PerCurrency {
  let out: PerCurrency = { ...ZERO_CURRENCY };
  for (const p of payments || []) {
    if (p.method !== "cash") continue;
    out = sum(out, { amount_cents: p.amount_cents ?? 0, currency: p.currency || "USD" });
  }
  return out;
}

export interface OverShort {
  usdCents: number;
  mvrLaari: number;
  eurCents: number;
}

/** Counted (closing) minus expected, per currency. Null closing = pending. */
export function cashRegisterOverShort(
  register: CashRegisterRow,
  entries: CashRegisterEntryRow[],
  cashFromPayments: PerCurrency = ZERO_CURRENCY
): OverShort | null {
  if (register.status !== "closed") return null;
  const expected = cashRegisterTotals(register, entries, cashFromPayments).expectedCash;
  const counted: PerCurrency = {
    usdCents: Number(register.closing_cash_usd_cents) || 0,
    mvrLaari: Number(register.closing_cash_mvr_laari) || 0,
    eurCents: Number(register.closing_cash_eur_cents) || 0,
  };
  return {
    usdCents: counted.usdCents - expected.usdCents,
    mvrLaari: counted.mvrLaari - expected.mvrLaari,
    eurCents: counted.eurCents - expected.eurCents,
  };
}

// =============================================
// Reconciliation: till cash vs cash recorded against bookings
// =============================================

/**
 * Money can be taken two ways, and nothing forces them to agree:
 *   * `payments` rows with method 'cash' record what a guest paid in cash
 *     (the booking-side truth, used by reports), and
 *   * `cash_register_entries` with method 'cash' record what physically went
 *     into the till (the cash-side truth).
 * Staff forget one or the other, so the difference is surfaced per currency
 * instead of being silently absorbed.
 */
export interface CashPaymentLike {
  amount_cents: number | null;
  currency: Currency3 | string | null;
}

export interface CurrencyReconciliation {
  /** Cash recorded against bookings that day. */
  paymentsCents: number;
  /** Cash actually recorded in the till that day. */
  tillCents: number;
  /** till − payments: positive means cash in the till is unexplained. */
  gapCents: number;
}

export interface CashReconciliation {
  perCurrency: Record<CashCurrency, CurrencyReconciliation>;
  cashPaymentCount: number;
  tillCashEntryCount: number;
  linkedEntryCount: number;
  /** Currencies where the two sides disagree. */
  mismatchedCurrencies: CashCurrency[];
}

interface TillCashRow {
  method: CashRegisterMethod | string;
  amount_cents: number | null;
  currency: Currency3 | string;
  booking_id?: string | null;
}

function blank(): CurrencyReconciliation {
  return { paymentsCents: 0, tillCents: 0, gapCents: 0 };
}

function bucket(cur: Currency3 | string): CashCurrency {
  return currency3ForDisplay(cur);
}

/**
 * Compare cash taken against bookings with cash actually placed in the till.
 * Card, bank transfer and on-account ("bill") money is deliberately excluded:
 * none of it passes through the drawer.
 */
export function reconcileCashAgainstPayments(
  payments: CashPaymentLike[],
  tillEntries: TillCashRow[]
): CashReconciliation {
  const perCurrency: Record<CashCurrency, CurrencyReconciliation> = {
    USD: blank(),
    MVR: blank(),
    EUR: blank(),
  };
  let cashPaymentCount = 0;
  let tillCashEntryCount = 0;
  let linkedEntryCount = 0;

  for (const p of payments || []) {
    const cur = bucket(p.currency || "USD");
    const n = Number(p.amount_cents) || 0;
    perCurrency[cur].paymentsCents += n;
    cashPaymentCount += 1;
  }

  for (const e of tillEntries || []) {
    if (e.method !== "cash") continue;
    const cur = bucket(e.currency);
    perCurrency[cur].tillCents += Number(e.amount_cents) || 0;
    tillCashEntryCount += 1;
    if (e.booking_id) linkedEntryCount += 1;
  }

  const mismatchedCurrencies: CashCurrency[] = [];
  for (const cur of CASH_REGISTER_CURRENCIES) {
    const row = perCurrency[cur];
    row.gapCents = row.tillCents - row.paymentsCents;
    if (row.gapCents !== 0) mismatchedCurrencies.push(cur);
  }

  return { perCurrency, cashPaymentCount, tillCashEntryCount, linkedEntryCount, mismatchedCurrencies };
}

/** True when both sides of the day agree in every currency. */
export function isCashReconciled(rec: CashReconciliation): boolean {
  return rec.mismatchedCurrencies.length === 0;
}

// =============================================
// Denomination (note/coin) breakdown counting
// =============================================

export interface Denomination {
  /** Unique stable id used as the counts key (e.g. "n10000", "c25"). */
  id: string;
  /** Currency minor units for a single unit (cents or laari). */
  minor: number;
  /** Display value, e.g. "100", "0.50". */
  label: string;
  kind: "note" | "coin";
}

const minorOf = (major: number) => Math.round(major * 100);

const D = (kind: "note" | "coin", minor: number, label: string): Denomination => ({
  id: `${kind === "note" ? "n" : "c"}${minor}`,
  minor,
  label,
  kind,
});

export const DENOMINATIONS: Record<CashCurrency, Denomination[]> = {
  USD: [
    ...[100, 50, 20, 10, 5, 1].map((v) => D("note", v * 100, String(v))),
    ...[0.5, 0.25, 0.1, 0.05, 0.01].map((v) => D("coin", minorOf(v), v.toFixed(2))),
  ],
  MVR: [
    ...[500, 100, 50, 20, 10, 5, 2, 1].map((v) => D("note", v * 100, String(v))),
    ...[0.5, 0.25, 0.1, 0.05, 0.02, 0.01].map((v) => D("coin", minorOf(v), v.toFixed(2))),
  ],
  EUR: [
    ...[500, 200, 100, 50, 20, 10, 5].map((v) => D("note", v * 100, String(v))),
    ...[2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01].map((v) => D("coin", minorOf(v), v.toFixed(2))),
  ],
};

/** Total minor units for a currency given counts keyed by denomination id. */
export function countTotal(currency: CashCurrency, counts: Record<string, number>): number {
  let total = 0;
  for (const d of DENOMINATIONS[currency]) {
    const n = Math.max(Number(counts?.[d.id]) || 0, 0);
    total += n * d.minor;
  }
  return total;
}

/** Format a single-currency amount for display. */
export function fmtEntryAmount(e: Pick<CashRegisterEntryRow, "amount_cents" | "currency">): string {
  return formatMoney3(Number(e.amount_cents) || 0, entryCurrency(e));
}