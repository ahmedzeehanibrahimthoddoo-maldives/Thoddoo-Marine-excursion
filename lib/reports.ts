// Shared aggregation helpers for the KPI dashboard + Reports.
// Pure functions — no Supabase imports (server/client safe data only).

import { convertMvrCentsToUsdCents, convertUsdCentsToMvrCents, type Currency } from "@/lib/money";

export interface RangeBooking {
  id: string;
  booking_ref: string | null;
  booking_date: string | null;
  status: string | null;
  payment_status: string | null;
  booking_currency: string | null;
  guests: number | null;
  adults: number | null;
  children_count: number | null;
  source: string | null;
  total_cents: number | null;
  estimated_total_cents: number | null;
  net_cents: number | null;
  commission_cents: number | null;
  activities?: { name?: string | null } | null;
  customers?: { full_name?: string | null } | null;
}

export const REVENUE_EXCLUDED_STATUSES = ["cancelled", "no_show"];

export function isBookedRow(b: RangeBooking): boolean {
  return !REVENUE_EXCLUDED_STATUSES.includes(String(b.status || ""));
}

export function currencyOf(b: RangeBooking): Currency {
  return b.booking_currency === "MVR" ? "MVR" : "USD";
}

export function grossCents(b: RangeBooking): number {
  return Math.max(Number(b.total_cents || b.estimated_total_cents) || 0, 0);
}

export function netCents(b: RangeBooking): number {
  const g = grossCents(b);
  const n = Math.max(Number(b.net_cents) || 0, 0);
  return n > 0 ? n : g;
}

export function commissionCents(b: RangeBooking): number {
  return Math.max(Number(b.commission_cents) || 0, 0);
}

export function isOutstanding(b: RangeBooking): boolean {
  return !REVENUE_EXCLUDED_STATUSES.includes(String(b.status || "")) &&
    (b.payment_status === "unpaid" || b.payment_status === "partial");
}

/** The money fields a payment row needs to be counted against a booking. */
export interface PaymentLike {
  id?: string | null;
  booking_id?: string | null;
  rental_id?: string | null;
  amount_cents?: number | null;
  converted_amount_cents?: number | null;
  currency?: string | null;
  booking_currency?: string | null;
  status?: string | null;
  created_at?: string | null;
}

/** Only money that is actually in. Voided, failed, pending and refunded do not count. */
export function isCompletedPayment(p: PaymentLike): boolean {
  return String(p.status || "completed") === "completed";
}

/**
 * What a payment is worth in the booking's own currency.
 *
 * converted_amount_cents is written by create_booking_payment and is already in
 * booking_currency. Older rows predate that column, so fall back to the raw
 * amount only when the two currencies agree — otherwise the number would be
 * wrong rather than merely missing.
 */
export function paymentAmountInBookingCurrency(p: PaymentLike): number {
  const converted = Math.round(Number(p.converted_amount_cents || 0) || 0);
  if (converted > 0) return converted;
  const amount = Math.round(Number(p.amount_cents || 0) || 0);
  if (amount > 0 && String(p.booking_currency || "") === String(p.currency || "")) return amount;
  return 0;
}

/**
 * Cash-in value of a payment: the converted figure when there is one (it is
 * already in the booking's currency), otherwise the raw amount.
 *
 * Rental payments carry no booking, so `converted_amount_cents` is simply the
 * amount taken — same answer, one rule for both.
 */
export function cashInCents(p: PaymentLike): number {
  const converted = Math.round(Number(p.converted_amount_cents || 0) || 0);
  if (converted > 0) return converted;
  return Math.max(Math.round(Number(p.amount_cents) || 0), 0);
}

/** The currency cashInCents is expressed in: the booking's when there is one. */
export function cashInCurrency(p: PaymentLike): "USD" | "MVR" {
  const cur = p.booking_currency || p.currency || "USD";
  return cur === "MVR" ? "MVR" : "USD";
}

/** completed payments grouped by booking, in the booking's currency. */
export function paidByBooking(payments: PaymentLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of payments || []) {
    if (!p.booking_id || !isCompletedPayment(p)) continue;
    const id = String(p.booking_id);
    out.set(id, (out.get(id) || 0) + paymentAmountInBookingCurrency(p));
  }
  return out;
}

/** Share of the booking's total that has been received, 0..1. */
export function paidRatio(totalCents: number, paidCents: number): number {
  const total = Number(totalCents) || 0;
  const paid = Number(paidCents) || 0;
  if (total <= 0 || paid <= 0) return 0;
  return Math.min(1, paid / total);
}

/**
 * Still owed on an invoice: what it asks for, less money actually received.
 *
 * The same numbers the invoice PDF prints as Total / Balance, so "Mark paid"
 * always clears exactly what the guest sees outstanding.
 */
export function invoiceBalanceCents(payableCents: number, payments: PaymentLike[]): number {
  const payable = Math.max(Math.round(Number(payableCents) || 0), 0);
  const paid = (payments || [])
    .filter(isCompletedPayment)
    .reduce((s, p) => s + paymentAmountInBookingCurrency(p), 0);
  return Math.max(payable - paid, 0);
}

/**
 * Money received against this booking, as a share of its gross.
 *
 * A partial payment used to contribute nothing to "Collected": the old rule
 * only accepted fully paid bookings, so a booking with 90% paid showed 0 —
 * the exact number an operator checking the day's takings needs.
 */
export function collectedGrossCents(b: RangeBooking, paidCents = 0): number {
  if (!isBookedRow(b)) return 0;
  return Math.round(grossCents(b) * paidRatio(grossCents(b), paidCents));
}

/**
 * The operator's share of what has been received (gross less partner
 * commission, pro-rated by what was actually paid).
 *
 * This is what makes a payment show up as revenue: profit is summed from this
 * rather than from booked totals, so money arrives into the P&L on the day it is
 * marked paid instead of the day the booking was made.
 */
export function collectedNetCents(b: RangeBooking, paidCents = 0): number {
  if (!isBookedRow(b)) return 0;
  return Math.round(netCents(b) * paidRatio(grossCents(b), paidCents));
}

/** Sum a per-row cents value grouped by currency. */
export function sumByCurrency(rows: RangeBooking[], centsFn: (b: RangeBooking) => number): { USD: number; MVR: number } {
  const out = { USD: 0, MVR: 0 };
  for (const b of rows) {
    out[currencyOf(b)] += Math.round(centsFn(b) || 0);
  }
  return out;
}

export interface Totals {
  usdCents: number;
  mvrLaari: number;
}

export interface Expense {
  id: string;
  title: string | null;
  category: string | null;
  amount_cents: number | null;
  currency: string | null;
  expense_date: string | null;
  vendor: string | null;
  notes: string | null;
}

export function expenseCents(e: Expense): number {
  return Math.max(Number(e.amount_cents) || 0, 0);
}

export function expenseCurrency(e: Expense): Currency {
  return e.currency === "MVR" ? "MVR" : "USD";
}

/** Sum expenses grouped by currency. */
export function sumExpensesByCurrency(rows: Expense[]): { USD: number; MVR: number } {
  const out = { USD: 0, MVR: 0 };
  for (const e of rows) {
    out[expenseCurrency(e)] += expenseCents(e);
  }
  return out;
}

export interface ExpenseCategoryTotal {
  category: string;
  count: number;
  total: Totals;
}

export function expensesByCategory(rows: Expense[]): ExpenseCategoryTotal[] {
  const map = new Map<string, ExpenseCategoryTotal>();
  for (const e of rows) {
    const cat = String(e.category || "Other");
    let t = map.get(cat);
    if (!t) {
      t = { category: cat, count: 0, total: { usdCents: 0, mvrLaari: 0 } };
      map.set(cat, t);
    }
    t.count += 1;
    const d = totals(sumExpensesByCurrency([e]));
    t.total.usdCents += d.usdCents;
    t.total.mvrLaari += d.mvrLaari;
  }
  return Array.from(map.values()).sort((a, b) => b.total.usdCents - a.total.usdCents);
}

export interface OtherIncome {
  id: string;
  title: string | null;
  category: string | null;
  amount_cents: number | null;
  currency: string | null;
  income_date: string | null;
  vendor: string | null;
  notes: string | null;
}

export function otherIncomeCents(e: OtherIncome): number {
  return Math.max(Number(e.amount_cents) || 0, 0);
}

export function otherIncomeCurrency(e: OtherIncome): Currency {
  return e.currency === "MVR" ? "MVR" : "USD";
}

/** Sum other income grouped by currency. */
export function sumOtherIncomeByCurrency(rows: OtherIncome[]): { USD: number; MVR: number } {
  const out = { USD: 0, MVR: 0 };
  for (const e of rows) {
    out[otherIncomeCurrency(e)] += otherIncomeCents(e);
  }
  return out;
}

/** Net profit = Net revenue + Other income − Expenses (per currency, no FX). */
export function profitTotals(net: Totals, expenses: Totals, otherIncome: Totals = { usdCents: 0, mvrLaari: 0 }): Totals {
  return {
    usdCents: net.usdCents + otherIncome.usdCents - expenses.usdCents,
    mvrLaari: net.mvrLaari + otherIncome.mvrLaari - expenses.mvrLaari,
  };
}

/** Convert a per-currency total into simultaneous USD-equivalent + MVR-equivalent totals. */
export function totals(byCurrency: { USD: number; MVR: number }): Totals {
  const usdCents = byCurrency.USD + convertMvrCentsToUsdCents(byCurrency.MVR);
  const mvrLaari = byCurrency.MVR + convertUsdCentsToMvrCents(byCurrency.USD);
  return { usdCents, mvrLaari };
}

export function firstOfMonth(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export interface NamedTotal {
  key: string;
  name: string;
  bookings: number;
  pax: number;
  gross: Totals;
  net: Totals;
  commission: Totals;
  /** Money received, pro-rated: gross x paid ratio. Zero when paidOf is absent. */
  collected: Totals;
}

export function breakdownBy(
  rows: RangeBooking[],
  nameOf: (b: RangeBooking) => string,
  paidOf?: (b: RangeBooking) => number,
): NamedTotal[] {
  const map = new Map<string, NamedTotal>();
  for (const b of rows) {
    if (!isBookedRow(b)) continue;
    const name = nameOf(b) || "Unknown";
    let e = map.get(name);
    if (!e) {
      e = {
        key: name, name, bookings: 0, pax: 0,
        gross: { usdCents: 0, mvrLaari: 0 },
        net: { usdCents: 0, mvrLaari: 0 },
        commission: { usdCents: 0, mvrLaari: 0 },
        collected: { usdCents: 0, mvrLaari: 0 },
      };
      map.set(name, e);
    }
    e.bookings += 1;
    e.pax += Math.max(Number(b.guests) || 0, 0);
    const g = totals(sumByCurrency([b], grossCents));
    const n = totals(sumByCurrency([b], netCents));
    const c = totals(sumByCurrency([b], commissionCents));
    const r = totals(sumByCurrency([b], (row) => collectedGrossCents(row, paidOf ? paidOf(row) : 0)));
    e.gross.usdCents += g.usdCents;
    e.gross.mvrLaari += g.mvrLaari;
    e.net.usdCents += n.usdCents;
    e.net.mvrLaari += n.mvrLaari;
    e.commission.usdCents += c.usdCents;
    e.commission.mvrLaari += c.mvrLaari;
    e.collected.usdCents += r.usdCents;
    e.collected.mvrLaari += r.mvrLaari;
  }
  return Array.from(map.values()).sort((a, b) => b.gross.usdCents - a.gross.usdCents);
}

export interface DayRow {
  day: string;
  bookings: number;
  pax: number;
  gross: Totals;
  collected: Totals;
}

export function breakdownByDay(
  rows: RangeBooking[],
  days: string[],
  paidOf?: (b: RangeBooking) => number,
): DayRow[] {
  const byDay = new Map<string, RangeBooking[]>();
  for (const b of rows) {
    const d = String(b.booking_date || "").slice(0, 10);
    if (!d) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(b);
  }
  const out: DayRow[] = [];
  for (const d of days) {
    const dayRows = byDay.get(d) || [];
    const booked = dayRows.filter(isBookedRow);
    out.push({
      day: d,
      bookings: dayRows.length,
      pax: booked.reduce((s, b) => s + (Math.max(Number(b.guests) || 0, 0)), 0),
      gross: totals(sumByCurrency(booked, grossCents)),
      // Counted per booking against what has been received, not "fully paid or
      // not": a day where guests settled part-way shows that money.
      collected: totals(sumByCurrency(booked, (b) => collectedGrossCents(b, paidOf ? paidOf(b) : 0))),
    });
  }
  return out;
}