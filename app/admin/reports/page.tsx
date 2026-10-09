import { createClient } from "@/lib/supabase/server";
import { maldivesToday } from "@/lib/operations";
import {
  type RangeBooking, type Expense, type OtherIncome,
  isBookedRow,
  grossCents, netCents, commissionCents,
  sumByCurrency, totals, sumExpensesByCurrency, expensesByCategory,
  sumOtherIncomeByCurrency, profitTotals,
  firstOfMonth, addDaysStr, breakdownBy, breakdownByDay,
  paidByBooking, isCompletedPayment, paymentAmountInBookingCurrency,
  cashInCents, cashInCurrency,
  collectedGrossCents, collectedNetCents, type PaymentLike,
} from "@/lib/reports";
import { isAdminRole } from "@/lib/permissions";
import ReportsClient from "./ReportsClient";
import CommissionBackfill from "./CommissionBackfill";

export const metadata = { title: "Reports | Thoddoo Marine Admin" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampDate(v: string | null | undefined, fallback: string): string {
  if (v && DATE_RE.test(v)) return v;
  return fallback;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = maldivesToday();
  const from = clampDate(params.from, firstOfMonth(today));
  const to = clampDate(params.to, today);

  const supabase = await createClient();
  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  const canFinance = role === "owner" || role === "manager" || role === "reception";
  const canExpenses = isAdminRole(role);

  const query = `id, booking_ref, booking_date, status, payment_status, booking_currency,
                 guests, adults, children_count, source, total_cents, estimated_total_cents,
                 net_cents, commission_cents, activities(name), customers(full_name)`;

  const [bookingsRes, rentalsRes, expensesRes, otherIncomeRes] = await Promise.all([
    supabase.from("bookings").select(query).gte("booking_date", from).lte("booking_date", to),
    supabase.from("equipment_rentals").select("rental_charge_cents, additional_charges_cents, currency")
      .gte("created_at", `${from}T00:00:00+05:00`)
      .lte("created_at", `${to}T23:59:59+05:00`)
      .not("payment_status", "eq", "unpaid"),
    canExpenses
      ? supabase.from("expenses").select("title, category, amount_cents, currency, expense_date, vendor, notes")
          .is("archived_at", null)
          .gte("expense_date", from)
          .lte("expense_date", to)
          .order("expense_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    canExpenses
      ? supabase.from("other_income").select("title, category, amount_cents, currency, income_date, vendor, notes")
          .is("archived_at", null)
          .gte("income_date", from)
          .lte("income_date", to)
      : Promise.resolve({ data: [] }),
  ]);

  const rows = (bookingsRes.data || []) as unknown as RangeBooking[];
  const bookingIds = rows.map((b) => b.id).filter(Boolean);

  // Two payment reads, because they answer different questions:
  //   windowPayments — everything received inside the date range, whichever
  //     booking or rental it belongs to: this is the cash-in figure.
  //   bookingPayments — everything ever paid against these bookings, so a
  //     partial payment taken last month still counts in this month's
  //     Collected-by-activity / by-day figures.
  const winStart = `${from}T00:00:00+05:00`;
  const winEnd = `${to}T23:59:59+05:00`;
  const paymentCols = "id, booking_id, rental_id, amount_cents, converted_amount_cents, booking_currency, currency, created_at, status";
  const [windowPaymentsRes, bookingPaymentsRes] = await Promise.all([
    canFinance
      ? supabase.from("payments")
          .select(paymentCols)
          .eq("status", "completed")
          .gte("created_at", winStart)
          .lte("created_at", winEnd)
      : Promise.resolve({ data: [] }),
    canFinance && bookingIds.length > 0
      ? supabase.from("payments")
          .select(paymentCols)
          .eq("status", "completed")
          .in("booking_id", bookingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const windowPayments = (windowPaymentsRes.data || []) as unknown as PaymentLike[];
  const bookingPayments = (bookingPaymentsRes.data || []) as unknown as PaymentLike[];
  const rentalPayments = windowPayments.filter((p) => p.rental_id);
  const paidMap = paidByBooking(bookingPayments);

  const rentalRows = (rentalsRes.data || []) as { rental_charge_cents: number; additional_charges_cents: number; currency: string }[];
  const expenseRows = (expensesRes.data || []) as unknown as Expense[];
  const expenses = totals(sumExpensesByCurrency(expenseRows));
  // Payment-mirrored rows are excluded: guest revenue is counted once, from the
  // payments themselves. (Migration 083 mirrors them into other_income purely so
  // the Income page shows them, badged as Guest payment.)
  const otherIncomeRows = ((otherIncomeRes.data || []) as unknown as (OtherIncome & { payment_id?: string | null })[])
    .filter((r) => !r.payment_id);
  const otherIncomeTotal = totals(sumOtherIncomeByCurrency(otherIncomeRows));

  const booked = rows.filter(isBookedRow);
  const paidOf = (b: RangeBooking) => paidMap.get(String(b.id)) || 0;

  // Cash-in for the range: every completed payment whose money arrived in it,
  // counted in the currency it was received in.
  const collectedByCurrency = { USD: 0, MVR: 0 };
  for (const p of windowPayments) {
    collectedByCurrency[cashInCurrency(p)] += cashInCents(p);
  }
  const collectedPayments = totals(collectedByCurrency);

  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) days.push(d);

  const netTotal = totals(sumByCurrency(booked, netCents));
  // Profit is taken from what has been received, not from what was booked: an
  // unpaid trip is a promise, not income. So recording a payment raises the P&L
  // on the day it is marked paid, and a balance payment lands in income then.
  const collectedNet = totals(sumByCurrency(booked, (b) => collectedNetCents(b, paidOf(b))));
  const stats = {
    bookings: rows.length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    pax: booked.reduce((s, b) => s + Math.max(Number(b.guests) || 0, 0), 0),
    gross: totals(sumByCurrency(booked, grossCents)),
    net: netTotal,
    commission: totals(sumByCurrency(booked, commissionCents)),
    collected: totals(sumByCurrency(booked, (b) => collectedGrossCents(b, paidOf(b)))),
    collectedPayments,
    avg: booked.length ? Math.round(totals(sumByCurrency(booked, grossCents)).usdCents / booked.length) : 0,
    expenses: canExpenses ? expenses : undefined,
    otherIncome: canExpenses ? otherIncomeTotal : undefined,
    profit: canExpenses ? profitTotals(collectedNet, expenses, otherIncomeTotal) : undefined,
  };

  const byActivity = breakdownBy(rows, (b) => b.activities?.name || "Unknown", paidOf);
  const bySource = breakdownBy(rows, (b) => String(b.source || "walk_in"), paidOf);
  const byDay = breakdownByDay(rows, days, paidOf);

  // Append Rentals row
  if (rentalRows.length > 0) {
    const rentalByCurrency = { USD: 0, MVR: 0 } as { USD: number; MVR: number };
    const rentalCollected = { USD: 0, MVR: 0 } as { USD: number; MVR: number };
    for (const r of rentalRows) {
      const gross = (Number(r.rental_charge_cents) || 0) + (Number(r.additional_charges_cents) || 0);
      rentalByCurrency[r.currency === "MVR" ? "MVR" : "USD"] += Math.round(gross);
    }
    for (const p of rentalPayments) {
      rentalCollected[cashInCurrency(p)] += cashInCents(p);
    }
    byActivity.push({
      key: "Rentals",
      name: "Rentals",
      bookings: rentalRows.length,
      pax: 0,
      gross: totals(rentalByCurrency),
      net: totals(rentalByCurrency),
      commission: { usdCents: 0, mvrLaari: 0 },
      collected: totals(rentalCollected),
    });
  }

  let outstanding: { ref: string; name: string; activity: string; currency: "USD" | "MVR"; dueCents: number }[] = [];
  if (canFinance && to === today) {
    const { data: ob } = await supabase
      .from("bookings")
      .select(`
        id, booking_ref, booking_currency, status, payment_status,
        total_cents, estimated_total_cents, activities(name), customers(full_name),
        payments(status, amount_cents, converted_amount_cents, booking_currency, currency)
      `)
      .eq("payments.status", "completed")
      .in("payment_status", ["unpaid", "partial"])
      .not("status", "in", `(${["cancelled", "no_show"].join(",")})`);
    for (const b of (ob || []) as unknown as (RangeBooking & { payments?: PaymentLike[] })[]) {
      const g = grossCents(b);
      // A voided payment used to be counted as money in, understating what the
      // guest still owes (and making a paid-in-full booking look outstanding).
      const paid = (b.payments || []).filter(isCompletedPayment)
        .reduce((s, p) => s + paymentAmountInBookingCurrency(p), 0);
      const due = Math.max(g - paid, 0);
      if (due > 0) outstanding.push({
        ref: String(b.booking_ref || ""), name: String(b.customers?.full_name || "—"),
        activity: String(b.activities?.name || "—"), currency: b.booking_currency === "MVR" ? "MVR" : "USD", dueCents: due,
      });
    }
    outstanding.sort((a, b) => b.dueCents - a.dueCents);
    outstanding = outstanding.slice(0, 40);
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Reports</h1>
        <p className="adminPageSub">{from} → {to} (Maldives time, UTC+5)</p>
      </div>
      <ReportsClient
        from={from}
        to={to}
        stats={stats}
        byActivity={byActivity}
        bySource={bySource}
        byDay={byDay}
        outstanding={outstanding}
        canFinance={canFinance}
        canExpenses={canExpenses}
        expenseCategories={expensesByCategory(expenseRows)}
      />
      {/* Same roles the backfill RPC allows: owner, manager, reception. */}
      {canFinance ? <CommissionBackfill from={from} to={to} /> : null}
    </div>
  );
}