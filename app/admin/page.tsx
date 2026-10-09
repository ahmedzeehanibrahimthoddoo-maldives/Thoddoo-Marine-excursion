import { createClient } from "@/lib/supabase/server";
import { getTrips } from "@/lib/supabase/actions";
import { formatMoney, currencyForDisplay } from "@/lib/money";
import { maldivesToday, TRIP_STATUS_LABEL, tripBookedPax } from "@/lib/operations";
import { isOpsStaff } from "@/lib/permissions";
import MyTasksClient from "@/app/admin/tasks/MyTasksClient";
import {
  type RangeBooking, type Totals, type NamedTotal, type Expense, type OtherIncome,
  isBookedRow,
  grossCents, netCents, commissionCents,
  sumByCurrency, totals, sumExpensesByCurrency, expensesByCategory, profitTotals, firstOfMonth, breakdownBy,
  paidByBooking, collectedNetCents, sumOtherIncomeByCurrency, cashInCents, cashInCurrency,
  paymentAmountInBookingCurrency, type PaymentLike,
} from "@/lib/reports";

export const metadata = { title: "Dashboard | Thoddoo Marine Admin" };

function dual(t: Totals) {
  return (
    <>
      <strong>{formatMoney(t.usdCents, "USD")}</strong>
      <small className="textMuted"> / {formatMoney(t.mvrLaari, "MVR")}</small>
    </>
  );
}

export default async function AdminDashboard() {
  const supabase = await createClient();
  const today = maldivesToday();
  const monthStart = firstOfMonth(today);

  const { data: roleData } = await supabase.rpc("current_staff_role");
  const role = typeof roleData === "string" ? roleData : null;
  const staffMode = isOpsStaff(role);

  const trips = await getTrips(today).catch(() => []);
  const bookedPaxToday = trips.reduce((s, t) => s + tripBookedPax(t), 0);
  const doneTripsToday = trips.filter((t) => t.status === "departed" || t.status === "returned").length;
  const plannedTrips = trips.filter((t) => t.status === "planned").length;
  const readyTrips = trips.filter((t) => t.status === "ready").length;

  if (staffMode) {
    return (
      <div className="adminPage">
        <div className="adminPageHeader">
          <h1>Dashboard</h1>
          <p className="adminPageSub">{today} (Maldives time, UTC+5) — day plan for the crew</p>
        </div>
        <div className="reportSummary">
          <div className="reportStat"><span className="reportStatValue">{trips.length}</span><span className="reportStatLabel">Trips Today</span></div>
          <div className="reportStat"><span className="reportStatValue">{plannedTrips}</span><span className="reportStatLabel">Planned</span></div>
          <div className="reportStat"><span className="reportStatValue">{readyTrips}</span><span className="reportStatLabel">Ready</span></div>
          <div className="reportStat"><span className="reportStatValue">{bookedPaxToday}</span><span className="reportStatLabel">Pax Booked</span></div>
          <div className="reportStat"><span className="reportStatValue">{doneTripsToday}</span><span className="reportStatLabel">Trips Done</span></div>
        </div>
        <TripCards trips={trips} />
        <MyTasksClient />
        <div className="adminSection">
          <h2>Today&apos;s Work</h2>
          <ul className="staffLinks">
            <li><a href="/admin/operations">Ops Board — advance trip status (ready → departed → returned)</a></li>
            <li><a href="/admin/manifests">Manifests — print the guest list & check guests in</a></li>
            <li><a href="/admin/trips">Trips — adjust today&apos;s plan</a></li>
            <li><a href="/admin/incidents">Incidents — log anything that happens on the water</a></li>
          </ul>
        </div>
      </div>
    );
  }

  const query = `id, booking_ref, booking_date, status, payment_status, booking_currency,
                 guests, adults, children_count, source, total_cents, estimated_total_cents,
                 net_cents, commission_cents, activities(name), customers(full_name)`;

  const [todayRes, monthRes, unassignedRes, rentalsRes, expensesRes, otherIncomeRes] = await Promise.all([
    supabase.from("bookings").select(query).eq("booking_date", today),
    supabase.from("bookings").select(query).gte("booking_date", monthStart).lte("booking_date", today),
    supabase.from("bookings").select("id").eq("booking_date", today).eq("status", "confirmed").eq("payment_status", "paid").is("trip_id", null),
    supabase.from("equipment_rentals").select("rental_charge_cents, additional_charges_cents, currency")
      .gte("created_at", `${monthStart}T00:00:00+05:00`)
      .lte("created_at", `${today}T23:59:59+05:00`)
      .not("payment_status", "eq", "unpaid"),
    supabase.from("expenses").select("amount_cents, currency, expense_date")
      .gte("expense_date", monthStart)
      .lte("expense_date", today)
      .order("expense_date", { ascending: false }),
    supabase.from("other_income").select("amount_cents, currency, income_date, payment_id")
      .is("archived_at", null)
      .gte("income_date", monthStart)
      .lte("income_date", today),
  ]);

  const todayBookings = (todayRes.data || []) as unknown as RangeBooking[];
  const monthBookings = (monthRes.data || []) as unknown as RangeBooking[];
  const unassignedCount = unassignedRes.count ?? 0;

  // Payments are read after the bookings so they can be scoped to them:
  //   cash-inRes — money that arrived this month (headline Collected).
  //   bookingPayRes — every payment against this month's bookings, whenever it
  //     arrived, so partial balances paid earlier still count as received income.
  const monthIds = monthBookings.map((b) => b.id).filter(Boolean);
  const [cashInRes, bookingPayRes] = await Promise.all([
    supabase.from("payments").select("amount_cents, converted_amount_cents, booking_currency, currency, created_at")
      .eq("status", "completed")
      .gte("created_at", `${monthStart}T00:00:00+05:00`)
      .lte("created_at", `${today}T23:59:59+05:00`),
    monthIds.length > 0
      ? supabase.from("payments").select("id, booking_id, amount_cents, converted_amount_cents, booking_currency, currency, status")
          .eq("status", "completed")
          .in("booking_id", monthIds)
      : Promise.resolve({ data: [] }),
  ]);
  const payments = cashInRes.data || [];
  const paidMap = paidByBooking((bookingPayRes.data || []) as unknown as PaymentLike[]);
  const paidOf = (b: RangeBooking) => paidMap.get(String(b.id)) || 0;

  // Rental revenue this month (charges + additional charges, from paid/partial rentals)
  const rentalRows = (rentalsRes.data || []) as { rental_charge_cents: number; additional_charges_cents: number; currency: string }[];
  const rentalByCurrency = { USD: 0, MVR: 0 } as { USD: number; MVR: number };
  for (const r of rentalRows) {
    const gross = (Number(r.rental_charge_cents) || 0) + (Number(r.additional_charges_cents) || 0);
    const cur = r.currency === "MVR" ? "MVR" : "USD";
    rentalByCurrency[cur] += Math.round(gross);
  }
  const rentalsMonth = totals(rentalByCurrency);

  const bookedToday = todayBookings.filter(isBookedRow);
  const paxToday = bookedToday.reduce((s, b) => s + Math.max(Number(b.guests) || 0, 0), 0);
  const confirmedToday = todayBookings.filter((b) => b.status === "confirmed").length;

  const monthBooked = monthBookings.filter(isBookedRow);
  const grossMonth = totals(sumByCurrency(monthBooked, grossCents));
  const netMonth = totals(sumByCurrency(monthBooked, netCents));
  const commMonth = totals(sumByCurrency(monthBooked, commissionCents));
  const grossToday = totals(sumByCurrency(bookedToday, grossCents));
  const collectedByCurrency = { USD: 0, MVR: 0 };
  for (const p of payments) {
    collectedByCurrency[cashInCurrency(p as PaymentLike)] += cashInCents(p as PaymentLike);
  }
  const collectedMonth = totals(collectedByCurrency);

  const isAdmin = role === "owner" || role === "manager";
  const expenseRows = (expensesRes.data || []) as unknown as Expense[];
  const expensesMonth = totals(sumExpensesByCurrency(expenseRows));
  // Income received so far (guest net share of payments taken) plus manual
  // other income (boat hire etc.), less expenses. Payment-mirrored other_income
  // rows are skipped: that revenue is already inside collectedNet.
  const collectedNetMonth = totals(sumByCurrency(monthBooked, (b) => collectedNetCents(b, paidOf(b))));
  const otherIncomeRows = ((otherIncomeRes.data || []) as unknown as (OtherIncome & { payment_id?: string | null })[])
    .filter((r) => !r.payment_id);
  const otherIncomeMonth = isAdmin ? totals(sumOtherIncomeByCurrency(otherIncomeRows)) : undefined;
  const profitMonth = profitTotals(collectedNetMonth, expensesMonth, otherIncomeMonth);

  const byActivity = breakdownBy(monthBookings, (b) => b.activities?.name || "Unknown", paidOf);
  const bySource = breakdownBy(monthBookings, (b) => String(b.source || "walk_in"), paidOf);

  // Append Rentals row if there is any rental revenue
  if (rentalRows.length > 0) {
    byActivity.push({
      key: "Rentals",
      name: "Rentals",
      bookings: rentalRows.length,
      pax: 0,
      gross: rentalsMonth,
      net: rentalsMonth,
      commission: { usdCents: 0, mvrLaari: 0 },
      collected: rentalsMonth,
    });
  }

  let outstanding: {
    id: string; ref: string; name: string; activity: string; guests: number;
    currency: "USD" | "MVR"; dueCents: number; booking_date: string | null;
  }[] = [];
  {
    const { data: ob } = await supabase
      .from("bookings")
      .select(`
        id, booking_ref, booking_date, guests, status, payment_status, booking_currency,
        total_cents, estimated_total_cents, net_cents,
        activities(name), customers(full_name),
        payments(status, amount_cents, converted_amount_cents, booking_currency, currency)
      `)
      .eq("payments.status", "completed")
      .in("payment_status", ["unpaid", "partial"])
      .not("status", "in", `(${["cancelled", "no_show"].join(",")})`);
    for (const b of (ob || []) as unknown as (RangeBooking & { payments?: PaymentLike[] })[]) {
      const g = grossCents(b);
      // Voided payments used to count as paid, so a settled booking could still
      // show up as owing money.
      const paid = (b.payments || [])
        .filter((p) => (p.status || "completed") === "completed")
        .reduce((sum, p) => sum + paymentAmountInBookingCurrency(p), 0);
      const due = Math.max(g - paid, 0);
      if (due <= 0) continue;
      outstanding.push({
        id: String(b.id), ref: String(b.booking_ref || ""), name: String(b.customers?.full_name || "—"),
        activity: String(b.activities?.name || "—"), guests: Math.max(Number(b.guests) || 0, 0),
        currency: b.booking_currency === "MVR" ? "MVR" : "USD", dueCents: due,
        booking_date: b.booking_date,
      });
    }
    outstanding.sort((a, b) => b.dueCents - a.dueCents);
    outstanding = outstanding.slice(0, 25);
  }

  const recentBookings = [...monthBookings].sort(
    (a, b) => String(b.booking_date).localeCompare(String(a.booking_date))
  ).slice(0, 6);

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Dashboard</h1>
        <p className="adminPageSub">{today} (Maldives time, UTC+5)</p>
      </div>

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{todayBookings.length}</span><span className="reportStatLabel">Bookings Today</span></div>
        <div className="reportStat"><span className="reportStatValue">{confirmedToday}</span><span className="reportStatLabel">Confirmed Today</span></div>
        <div className="reportStat"><span className="reportStatValue">{paxToday}</span><span className="reportStatLabel">Pax Today</span></div>
        <div className="reportStat"><span className="reportStatValue">{String(trips.length)}</span><span className="reportStatLabel">Trips / {bookedPaxToday} pax</span></div>
        <div className="reportStat"><span className="reportStatValue">{doneTripsToday}</span><span className="reportStatLabel">Trips Done</span></div>
        <div className="reportStat"><span className="reportStatValue">{unassignedCount}</span><span className="reportStatLabel">Unassigned (paid)</span></div>
      </div>

      <div className="reportSummary">
        <div className="reportStat"><span className="reportStatValue">{dual(grossMonth)}</span><span className="reportStatLabel">Gross · this month</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(netMonth)}</span><span className="reportStatLabel">Net · this month</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(collectedMonth)}</span><span className="reportStatLabel">Collected · this month</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(commMonth)}</span><span className="reportStatLabel">Commission</span></div>
        <div className="reportStat"><span className="reportStatValue">{dual(rentalsMonth)}</span><span className="reportStatLabel">Rentals · this month</span></div>
        {isAdmin && (
          <>
            <div className="reportStat"><span className="reportStatValue">{dual(otherIncomeMonth || { usdCents: 0, mvrLaari: 0 })}</span><span className="reportStatLabel">Other Income · this month</span></div>
            <div className="reportStat"><span className="reportStatValue">{dual(expensesMonth)}</span><span className="reportStatLabel">Expenses · this month</span></div>
            <div className="reportStat"><span className="reportStatValue">{dual(profitMonth)}</span><span className="reportStatLabel">Net Profit (received) · this month</span></div>
          </>
        )}
        <div className="reportStat"><span className="reportStatValue">{bookedToday.length ? formatMoney(Math.round(grossToday.usdCents / bookedToday.length), "USD") : "—"}</span><span className="reportStatLabel">Avg Booking Today</span></div>
        <div className="reportStat"><span className="reportStatValue">{outstanding.length}</span><span className="reportStatLabel">Bookings w/ Balance</span></div>
      </div>

      <TripCards trips={trips} />

      <div className="adminSection">
        <h2>Outstanding Balances</h2>
        {outstanding.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Ref</th><th>Customer</th><th>Activity</th><th>Guests</th><th>Date</th><th>Due</th></tr>
              </thead>
              <tbody>
                {outstanding.map((o) => (
                  <tr key={o.id}>
                    <td className="mono"><a href="/admin/payments" className="tripLink">{o.ref}</a></td>
                    <td>{o.name}</td>
                    <td>{o.activity}</td>
                    <td>{o.guests}</td>
                    <td>{o.booking_date || "—"}</td>
                    <td><strong>{formatMoney(o.dueCents, o.currency)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No unpaid balances. All bookings are settled.</p></div>
        )}
      </div>

      <div className="adminSection">
        <h2>Revenue This Month · by Activity</h2>
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
          <div className="emptyState"><p>No revenue yet this month.</p></div>
        )}
      </div>

      <div className="adminSection">
        <h2>Revenue This Month · by Source</h2>
        {bySource.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Source</th><th>Bookings</th><th>Pax</th><th>Gross</th><th>Net</th></tr>
              </thead>
              <tbody>
                {bySource.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.bookings}</td>
                    <td>{r.pax}</td>
                    <td>{dual(r.gross)}</td>
                    <td>{dual(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No source data yet.</p></div>
        )}
      </div>

      {isAdmin && expenseRows.length > 0 && (
        <div className="adminSection">
          <h2>Expenses This Month · by Category</h2>
          <div className="tableWrap">
            <table className="adminTable reportTable">
              <thead>
                <tr><th>Category</th><th>Items</th><th>Total</th></tr>
              </thead>
              <tbody>
                {expensesByCategory(expenseRows).map((c) => (
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
      )}

      <div className="adminSection">
        <h2>Recent Bookings</h2>
        {recentBookings.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr><th>Ref</th><th>Customer</th><th>Activity</th><th>Guests</th><th>Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentBookings.map((b) => (
                  <tr key={String(b.id)}>
                    <td className="mono"><a href="/admin/bookings" className="tripLink">{b.booking_ref}</a></td>
                    <td>{String(b.customers?.full_name || "—")}</td>
                    <td>{String(b.activities?.name || "—")}</td>
                    <td>{Math.max(Number(b.guests) || 0, 0)}</td>
                    <td>{grossCents(b) ? formatMoney(grossCents(b), currencyForDisplay(b.booking_currency)) : "—"}</td>
                    <td><span className={`badge badge-${b.status}`}>{String(b.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState"><p>No bookings this month yet.</p></div>
        )}
      </div>
    </div>
  );
}

function TripCards({ trips }: { trips: Awaited<ReturnType<typeof getTrips>> }) {
  return (
    <div className="kpiGrid">
      {trips.length === 0 && (
        <div className="emptyState" style={{ gridColumn: "1 / -1" }}><p>No trips today yet. Create one under Trips.</p></div>
      )}
      {trips.map((t) => (
        <a key={String(t.id)} href="/admin/operations" className="kpiCard">
          <div className="kpiCardTop">
            <span className="kpiCardTitle">{String(t.activities?.name || "Trip")}</span>
            <span className={`badge badge-trip-${t.status}`}>{TRIP_STATUS_LABEL[String(t.status)]}</span>
          </div>
          <div className="kpiCardSub">{String(t.trip_ref)} · {String(t.boats?.name || "—")} · {String(t.start_time || "")}</div>
          <div className="kpiCardBar">
            <div
              className="kpiCardBarFill"
              style={{ width: `${Math.min(100, Math.round((tripBookedPax(t) / Math.max(t.capacity_pax, 1)) * 100))}%` }}
            />
          </div>
          <div className="kpiCardFoot">{tripBookedPax(t)} / {t.capacity_pax} pax · {String(t.guide?.full_name || "—")}</div>
        </a>
      ))}
    </div>
  );
}