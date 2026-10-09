/**
 * Day-end report — the nightly 23:00 (Maldives time) email to the booking mailbox.
 *
 * One message, two halves, in the order the office reads them:
 *   1. Finance — what was sold today, what ran today, what cash came in, what
 *      was spent, and what is still owed.
 *   2. Operations — tomorrow's trips with pax, guest names and consent state, so
 *      whoever opens the mail at 23:00 can staff the morning.
 *
 * Collection uses the service-role client because the cron runs with no staff
 * session, and queries the tables directly rather than get_tomorrow_bookings(),
 * which is gated on current_staff_role() and would answer "Access denied" to a
 * cron call. Reading the same columns the Reports page reads keeps the two in
 * agreement — this is the Reports page pinned to a single day.
 *
 * Rendering is a pure function so the layout can be unit-tested with no DB and
 * no network, and so a Resend outage can never cost us the numbers.
 *
 * Every day boundary is a +05:00 string. The DB stores timestamptz, so building
 * the bounds from the server's local zone would silently shift the day on any
 * box that is not already on Maldives time (Vercel runs UTC).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/money";
import {
  addDaysStr,
  breakdownBy,
  commissionCents,
  grossCents,
  isBookedRow,
  netCents,
  profitTotals,
  sumByCurrency,
  sumExpensesByCurrency,
  sumOtherIncomeByCurrency,
  totals,
  type Expense,
  type NamedTotal,
  type OtherIncome,
  type RangeBooking,
  type Totals,
  isCompletedPayment,
  paymentAmountInBookingCurrency,
  cashInCents,
  cashInCurrency,
} from "@/lib/reports";
import { friendlyDate, maldivesToday } from "@/lib/operations";

/** Maldives is UTC+5 with no DST, so a fixed offset is correct year-round. */
export const MALDIVES_UTC_OFFSET = "+05:00";

/** Outstanding lists get long; the mail shows the worst and counts the rest. */
export const OUTSTANDING_LIMIT = 10;
/** Guest lines per activity in tomorrow's manifest. */
export const TOMORROW_LINES_PER_ACTIVITY = 12;

const DAY_START = "T00:00:00";
const DAY_END = "T23:59:59";

/** 2026-10-02 + 2026-10-02T00:00:00+05:00 */
export function dayStartIso(dateStr: string): string {
  return `${dateStr}${DAY_START}${MALDIVES_UTC_OFFSET}`;
}

export function dayEndIso(dateStr: string): string {
  return `${dateStr}${DAY_END}${MALDIVES_UTC_OFFSET}`;
}

const SOURCE_LABEL: Record<string, string> = {
  walk_in: "Walk-in",
  online: "Website",
  whatsapp: "WhatsApp",
  agent: "Agent",
};

export function sourceLabel(source: unknown): string {
  const key = String(source || "walk_in");
  return SOURCE_LABEL[key] || key;
}

export interface DayEndAgentRow {
  name: string;
  bookings: number;
  gross: Totals;
}

export interface DayEndOutstandingRow {
  ref: string;
  name: string;
  activity: string;
  due: Totals;
}

export interface DayEndGuestLine {
  ref: string;
  time: string;
  guests: number;
  names: string;
  status: string;
  payment: string;
  source: string;
  agent: string | null;
  consentPending: number;
}

export interface DayEndActivityRow {
  activity: string;
  bookings: number;
  pax: number;
  consentPending: number;
  lines: DayEndGuestLine[];
  hidden: number;
}

export interface DayEndReport {
  /** Maldives day this report covers (the day that just ended). */
  date: string;
  /** The day after — the manifest half. */
  tomorrow: string;
  /** Bookings *created* today, i.e. what the team sold today. */
  taken: { bookings: number; pax: number; gross: Totals; bySource: NamedTotal[]; agents: DayEndAgentRow[] };
  /** Bookings *dated* today, i.e. what actually ran today. */
  ran: { bookings: number; pax: number; gross: Totals; net: Totals; commission: Totals; byActivity: NamedTotal[] };
  cash: {
    payments: number;
    collected: Totals;
    expenses: Totals;
    otherIncome: Totals;
    rentals: Totals;
    profit: Totals;
  };
  outstanding: { rows: DayEndOutstandingRow[]; hidden: number; total: Totals };
  tomorrowTrips: { bookings: number; pax: number; consentPending: number; byActivity: DayEndActivityRow[] };
  /** Section labels whose query failed, so a thin report says why. */
  failures: string[];
  generatedAt: string;
}

// ================================================================
// Collection (server-only — talks to the DB with the service role)
// ================================================================

const BOOKING_QUERY = `id, booking_ref, booking_date, status, payment_status, booking_currency,
                       guests, adults, children_count, source, agent_name, total_cents,
                       estimated_total_cents, net_cents, commission_cents, created_at,
                       preferred_time, activities(name), customers(full_name)`;

const OUTSTANDING_QUERY = `id, booking_ref, booking_currency, status, payment_status,
                           total_cents, estimated_total_cents, activities(name), customers(full_name),
                           payments(status, amount_cents, converted_amount_cents, booking_currency, currency)`;

const TOMORROW_QUERY = `id, booking_ref, booking_date, status, payment_status, booking_currency,
                        guests, adults, children_count, source, agent_name, total_cents,
                        estimated_total_cents, preferred_time, activities(name), customers(full_name),
                        booking_participants(full_name, participant_type, consent_status)`;

type PaymentRow = { amount_cents: number | null; converted_amount_cents: number | null; booking_currency: string | null; currency: string | null };
type RentalRow = { rental_charge_cents: number | null; additional_charges_cents: number | null; currency: string | null };
type OutstandingRow = RangeBooking & { payments?: { amount_cents: number | null; converted_amount_cents: number | null }[] };
type ParticipantRow = { full_name: string | null; participant_type: string | null; consent_status: string | null };
type TomorrowRow = RangeBooking & {
  preferred_time?: string | null;
  agent_name?: string | null;
  booking_participants?: ParticipantRow[];
};

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** True for the shapes the DB actually uses; anything else is a typo guard. */
export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function sumPayments(rows: PaymentRow[]): Totals {
  const byCurrency = { USD: 0, MVR: 0 };
  for (const p of rows) {
    byCurrency[cashInCurrency(p)] += cashInCents(p);
  }
  return totals(byCurrency);
}

function sumRentals(rows: RentalRow[]): Totals {
  const byCurrency = { USD: 0, MVR: 0 };
  for (const r of rows) {
    const gross = (Number(r.rental_charge_cents) || 0) + (Number(r.additional_charges_cents) || 0);
    byCurrency[r.currency === "MVR" ? "MVR" : "USD"] += Math.round(gross);
  }
  return totals(byCurrency);
}

function agentsByName(rows: RangeBooking[]): DayEndAgentRow[] {
  const map = new Map<string, DayEndAgentRow>();
  for (const b of rows) {
    if (String(b.source || "") !== "agent") continue;
    const name = String((b as { agent_name?: string | null }).agent_name || "").trim() || "Unnamed";
    let e = map.get(name);
    if (!e) {
      e = { name, bookings: 0, gross: { usdCents: 0, mvrLaari: 0 } };
      map.set(name, e);
    }
    e.bookings += 1;
    const g = totals(sumByCurrency([b], grossCents));
    e.gross.usdCents += g.usdCents;
    e.gross.mvrLaari += g.mvrLaari;
  }
  return Array.from(map.values()).sort((a, b) => b.gross.usdCents - a.gross.usdCents);
}

function outstandingRows(rows: OutstandingRow[]): { rows: DayEndOutstandingRow[]; hidden: number; total: Totals } {
  const byCurrency = { USD: 0, MVR: 0 };
  const all: DayEndOutstandingRow[] = [];
  for (const b of rows) {
    const g = grossCents(b);
    const paid = (b.payments || [])
      .filter(isCompletedPayment)
      .reduce((s, p) => s + paymentAmountInBookingCurrency(p), 0);
    const due = Math.max(g - paid, 0);
    if (due <= 0) continue;
    byCurrency[b.booking_currency === "MVR" ? "MVR" : "USD"] += due;
    all.push({
      ref: String(b.booking_ref || "—"),
      name: String(b.customers?.full_name || "—"),
      activity: String(b.activities?.name || "—"),
      due: totals({ USD: b.booking_currency === "MVR" ? 0 : due, MVR: b.booking_currency === "MVR" ? due : 0 }),
    });
  }
  all.sort((a, b) => b.due.usdCents - a.due.usdCents || b.due.mvrLaari - a.due.mvrLaari);
  return { rows: all.slice(0, OUTSTANDING_LIMIT), hidden: Math.max(all.length - OUTSTANDING_LIMIT, 0), total: totals(byCurrency) };
}

function tomorrowRows(rows: TomorrowRow[]): DayEndActivityRow[] {
  const byActivity = new Map<string, DayEndGuestLine[]>();
  for (const b of rows) {
    const activity = String(b.activities?.name || "Unknown");
    const participants = b.booking_participants || [];
    const consentPending = participants.filter((p) => p.consent_status !== "signed").length;
    const names = participants
      .map((p) => String(p.full_name || "").trim())
      .filter(Boolean)
      .join(", ");
    if (!byActivity.has(activity)) byActivity.set(activity, []);
    byActivity.get(activity)!.push({
      ref: String(b.booking_ref || "—"),
      time: String(b.preferred_time || "—"),
      guests: Math.max(Number(b.guests) || 0, 0),
      names: names || String(b.customers?.full_name || "—"),
      status: String(b.status || "—"),
      payment: String(b.payment_status || "—"),
      source: sourceLabel(b.source),
      agent: String(b.agent_name || "").trim() || null,
      consentPending,
    });
  }

  const out: DayEndActivityRow[] = [];
  for (const [activity, lines] of byActivity) {
    const ordered = lines.slice().sort((a, b) => a.time.localeCompare(b.time) || a.ref.localeCompare(b.ref));
    out.push({
      activity,
      bookings: ordered.length,
      pax: ordered.reduce((s, l) => s + l.guests, 0),
      consentPending: ordered.reduce((s, l) => s + l.consentPending, 0),
      lines: ordered.slice(0, TOMORROW_LINES_PER_ACTIVITY),
      hidden: Math.max(ordered.length - TOMORROW_LINES_PER_ACTIVITY, 0),
    });
  }
  return out.sort((a, b) => b.pax - a.pax || a.activity.localeCompare(b.activity));
}

export type DayEndCollectResult =
  | { ok: true; report: DayEndReport }
  | { ok: false; reason: "missing_service_key" | "bad_date" | "collect_failed"; message?: string };

/**
 * Read one Maldives day (defaults to today) plus the following day's manifest.
 *
 * A failed section is recorded in `failures` rather than thrown: a single
 * missing column must not cost the office the whole report, but the mail has to
 * say which part is thin.
 */
export async function collectDayEndReport(dateInput?: string | null): Promise<DayEndCollectResult> {
  const supabase = serviceClient();
  if (!supabase) return { ok: false, reason: "missing_service_key" };

  const date = dateInput ? String(dateInput).trim() : maldivesToday();
  if (!isDateStr(date)) return { ok: false, reason: "bad_date", message: `Expected YYYY-MM-DD, got ${dateInput}` };

  const failures: string[] = [];
  // `data` is typed unknown and cast per call site: PostgREST infers nested
  // relation selects as arrays where the code wants a single joined row, the
  // same cast the Reports page makes when it reuses these columns.
  const safe = async <T,>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await query;
    if (error) {
      failures.push(`${label}: ${error.message}`);
      return [];
    }
    return (data || []) as T[];
  };

  const startIso = dayStartIso(date);
  const endIso = dayEndIso(date);
  const tomorrow = addDaysStr(date, 1);

  const [takenRows, ranRows, paymentRows, expenseRows, incomeRows, rentalRows, outstandingDb, tomorrowDb] = await Promise.all([
    safe<RangeBooking>("sales taken", supabase.from("bookings").select(BOOKING_QUERY).gte("created_at", startIso).lte("created_at", endIso)),
    safe<RangeBooking>("trips run", supabase.from("bookings").select(BOOKING_QUERY).eq("booking_date", date)),
    safe<PaymentRow>("payments", supabase.from("payments").select("amount_cents, converted_amount_cents, booking_currency, currency").eq("status", "completed").gte("created_at", startIso).lte("created_at", endIso)),
    safe<Expense>("expenses", supabase.from("expenses").select("id, title, category, amount_cents, currency, expense_date, vendor, notes").is("archived_at", null).eq("expense_date", date)),
    // payment_id rows are mirrors of guest payments (migration 083); guest
    // revenue is already counted through cash collected, so including them
    // would book every trip twice.
    safe<OtherIncome>("other income", supabase.from("other_income").select("id, title, category, amount_cents, currency, income_date, vendor, notes, payment_id").is("archived_at", null).is("payment_id", null).eq("income_date", date)),
    safe<RentalRow>("rentals", supabase.from("equipment_rentals").select("rental_charge_cents, additional_charges_cents, currency").gte("created_at", startIso).lte("created_at", endIso).not("payment_status", "eq", "unpaid")),
    safe<OutstandingRow>("outstanding", supabase.from("bookings").select(OUTSTANDING_QUERY).eq("payments.status", "completed").in("payment_status", ["unpaid", "partial"]).not("status", "in", "(cancelled,no_show)")),
    safe<TomorrowRow>("tomorrow", supabase.from("bookings").select(TOMORROW_QUERY).eq("booking_date", tomorrow).not("status", "in", "(cancelled,no_show)")),
  ]);

  const bookedTaken = takenRows.filter(isBookedRow);
  const bookedRan = ranRows.filter(isBookedRow);
  const expenses = totals(sumExpensesByCurrency(expenseRows));
  const otherIncome = totals(sumOtherIncomeByCurrency(incomeRows));
  const netRan = totals(sumByCurrency(bookedRan, netCents));
  const outstanding = outstandingRows(outstandingDb);
  const byActivityTomorrow = tomorrowRows(tomorrowDb);

  return {
    ok: true,
    report: {
      date,
      tomorrow,
      taken: {
        bookings: bookedTaken.length,
        pax: bookedTaken.reduce((s, b) => s + Math.max(Number(b.guests) || 0, 0), 0),
        gross: totals(sumByCurrency(bookedTaken, grossCents)),
        bySource: breakdownBy(takenRows, (b) => sourceLabel(b.source)),
        agents: agentsByName(bookedTaken),
      },
      ran: {
        bookings: bookedRan.length,
        pax: bookedRan.reduce((s, b) => s + Math.max(Number(b.guests) || 0, 0), 0),
        gross: totals(sumByCurrency(bookedRan, grossCents)),
        net: netRan,
        commission: totals(sumByCurrency(bookedRan, commissionCents)),
        byActivity: breakdownBy(ranRows, (b) => b.activities?.name || "Unknown"),
      },
      cash: {
        payments: paymentRows.length,
        collected: sumPayments(paymentRows),
        expenses,
        otherIncome,
        rentals: sumRentals(rentalRows),
        profit: profitTotals(netRan, expenses, otherIncome),
      },
      outstanding,
      tomorrowTrips: {
        bookings: byActivityTomorrow.reduce((s, a) => s + a.bookings, 0),
        pax: byActivityTomorrow.reduce((s, a) => s + a.pax, 0),
        consentPending: byActivityTomorrow.reduce((s, a) => s + a.consentPending, 0),
        byActivity: byActivityTomorrow,
      },
      failures,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ================================================================
// Rendering (pure — unit-tested without a DB or the network)
// ================================================================

/** "$1,240.00 / MVR 22,320.00" — the dual display the Reports page uses. */
export function formatTotals(t: Totals): string {
  return `${formatMoney(t.usdCents, "USD")} / ${formatMoney(t.mvrLaari, "MVR")}`;
}

export function dayEndRecipient(): string {
  return (
    process.env.DAYEND_REPORT_TO ||
    process.env.RESEND_REPLY_TO ||
    "booking@thoddoomarineexcursion.com"
  ).trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** "6 bookings, 34 pax" style counts that stay grammatical at 1. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const REPORT_URL_PATH = "/admin/reports";

function reportUrl(date: string): string | null {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  return site ? `${site}${REPORT_URL_PATH}?from=${date}&to=${date}` : null;
}

function buildSubject(r: DayEndReport): string {
  const head = `Day End ${r.date} — ${count(r.taken.bookings, "booking")}, ${count(r.taken.pax, "guest")}, net ${formatMoney(r.cash.profit.usdCents, "USD")}`;
  return `Thoddoo Marine ${head}`;
}

function buildText(r: DayEndReport): string {
  const L: string[] = [];
  const push = (line = "") => L.push(line);

  push(`THODDOO MARINE — DAY END REPORT`);
  push(`${friendlyDate(r.date)} (Maldives time, UTC+5)`);
  push();

  push("SALES TAKEN TODAY");
  push(`  ${count(r.taken.bookings, "booking")} · ${count(r.taken.pax, "guest")} · gross ${formatTotals(r.taken.gross)}`);
  if (r.taken.bySource.length === 0) {
    push("  No bookings were taken today.");
  } else {
    push(`  ${pad("SOURCE", 14)}${pad("BOOKINGS", 10)}${pad("PAX", 7)}GROSS`);
    for (const s of r.taken.bySource) {
      push(`  ${pad(sourceLabel(s.key), 14)}${pad(String(s.bookings), 10)}${pad(String(s.pax), 7)}${formatTotals(s.gross)}`);
    }
  }
  for (const a of r.taken.agents) {
    push(`    agent: ${a.name} — ${count(a.bookings, "booking")}, ${formatTotals(a.gross)}`);
  }
  push();

  push("TRIPS BY ACTIVITY TODAY");
  if (r.ran.byActivity.length === 0) {
    push("  No trips were scheduled to run today.");
  } else {
    push(`  ${pad("ACTIVITY", 26)}${pad("BKNGS", 8)}${pad("PAX", 7)}${pad("GROSS", 30)}NET`);
    for (const a of r.ran.byActivity) {
      push(`  ${pad(a.name, 26)}${pad(String(a.bookings), 8)}${pad(String(a.pax), 7)}${pad(formatTotals(a.gross), 30)}${formatTotals(a.net)}`);
    }
  }
  push();

  push("CASH & LEDGER");
  push(`  Cash collected   ${count(r.cash.payments, "payment")} · ${formatTotals(r.cash.collected)}`);
  push(`  Equipment rental ${formatTotals(r.cash.rentals)}`);
  push(`  Expenses         ${formatTotals(r.cash.expenses)}`);
  push(`  Other income     ${formatTotals(r.cash.otherIncome)}`);
  push(`  Net (trips)      ${formatTotals(r.ran.net)}`);
  push(`  Profit estimate  ${formatTotals(r.cash.profit)}`);
  push();

  push("OUTSTANDING BALANCES");
  if (r.outstanding.rows.length === 0) {
    push("  Nothing outstanding.");
  } else {
    for (const o of r.outstanding.rows) {
      push(`  ${pad(o.ref, 10)}${pad(o.name, 24)}${pad(o.activity, 22)}${formatTotals(o.due)}`);
    }
    if (r.outstanding.hidden > 0) {
      push(`  +${r.outstanding.hidden} more · total outstanding ${formatTotals(r.outstanding.total)}`);
    }
  }
  push();

  push(`TOMORROW — ${friendlyDate(r.tomorrow)}`);
  push(`  ${count(r.tomorrowTrips.bookings, "booking")} · ${count(r.tomorrowTrips.pax, "guest")} · ${count(r.tomorrowTrips.consentPending, "waiver")} outstanding`);
  if (r.tomorrowTrips.byActivity.length === 0) {
    push("  Nothing booked for tomorrow.");
  } else {
    for (const a of r.tomorrowTrips.byActivity) {
      push();
      push(`  ${a.activity} — ${count(a.bookings, "booking")}, ${count(a.pax, "guest")}, ${count(a.consentPending, "waiver")} outstanding`);
      for (const line of a.lines) {
        const bits = [line.time, line.ref, count(line.guests, "guest")];
        if (line.source === "Agent") bits.push(line.agent ? `agent ${line.agent}` : "agent");
        if (line.consentPending > 0) bits.push(`${count(line.consentPending, "waiver")} pending`);
        if (line.payment !== "paid") bits.push(line.payment);
        push(`    ${line.names} — ${bits.join(" · ")}`);
      }
      if (a.hidden > 0) push(`    +${a.hidden} more booking(s)`);
    }
  }
  push();

  if (r.failures.length > 0) {
    push("INCOMPLETE SECTIONS");
    for (const f of r.failures) push(`  ${f}`);
    push();
  }

  const url = reportUrl(r.date);
  if (url) {
    push(`Full day report: ${url}`);
  }
  push("Sent automatically at 23:00 Maldives time. Reply to this email with corrections.");
  return L.join("\n");
}

const S = {
  body: "margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#12212e;",
  wrap: "max-width:760px;margin:0 auto;padding:16px;",
  head: "background:#0d3b53;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0;",
  h1: "margin:0;font-size:19px;letter-spacing:.02em;",
  sub: "margin:4px 0 0;font-size:13px;color:#a9cede;",
  card: "background:#fff;border:1px solid #e3e9ee;border-radius:10px;padding:16px 18px;margin:12px 0;",
  h2: "margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#4a6273;",
  th: "text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#7a8f9d;padding:6px 8px;border-bottom:1px solid #e3e9ee;",
  td: "padding:6px 8px;border-bottom:1px solid #eef2f5;font-size:13px;vertical-align:top;",
  num: "text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;",
  note: "font-size:12px;color:#6c7f8c;margin:6px 0 0;",
  foot: "font-size:12px;color:#6c7f8c;padding:4px 4px 20px;",
  sub2: "margin:10px 0 4px;font-size:14px;font-weight:600;",
  warn: "background:#fff6e5;border:1px solid #f0d9a8;border-radius:8px;padding:10px 12px;font-size:12px;color:#7a5a12;",
};

function table(head: string[], rows: string[][], opts: { numericFrom?: number } = {}): string {
  const numericFrom = opts.numericFrom ?? head.length;
  const th = head
    .map((h, i) => `<th style="${S.th}${i >= numericFrom ? S.num : ""}">${escapeHtml(h)}</th>`)
    .join("");
  const tr = rows
    .map((cells) => {
      const tds = cells
        .map((c, i) => `<td style="${S.td}${i >= numericFrom ? S.num : ""}">${c}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  if (rows.length === 0) return "";
  return `<table style="width:100%;border-collapse:collapse;margin:4px 0 0">${`<tr>${th}</tr>`}${tr}</table>`;
}

function section(title: string, inner: string): string {
  return `<div style="${S.card}"><h2 style="${S.h2}">${escapeHtml(title)}</h2>${inner}</div>`;
}

function buildHtml(r: DayEndReport): string {
  const parts: string[] = [];

  parts.push(
    `<div style="${S.head}"><h1 style="${S.h1}">Thoddoo Marine — Day End Report</h1>` +
      `<p style="${S.sub}">${escapeHtml(friendlyDate(r.date))} · Maldives time (UTC+5)</p></div>`
  );

  // --- Sales taken today -------------------------------------------------
  const takenRows = r.taken.bySource.map((s) => [
    escapeHtml(sourceLabel(s.key)),
    escapeHtml(String(s.bookings)),
    escapeHtml(String(s.pax)),
    escapeHtml(formatTotals(s.gross)),
  ]);
  const agentNote = r.taken.agents.length
    ? `<p style="${S.note}">Agents: ${r.taken.agents.map((a) => `${escapeHtml(a.name)} (${a.bookings})`).join(", ")}</p>`
    : "";
  parts.push(
    section(
      "Sales taken today",
      `<p style="${S.note};margin:0 0 6px">${count(r.taken.bookings, "booking")} · ${count(r.taken.pax, "guest")} · gross ${escapeHtml(formatTotals(r.taken.gross))}</p>` +
        (takenRows.length
          ? table(["Source", "Bookings", "Pax", "Gross"], takenRows, { numericFrom: 1 })
          : `<p style="${S.note};margin:0">No bookings were taken today.</p>`) +
        agentNote
    )
  );

  // --- Trips by activity today ------------------------------------------
  const ranRows = r.ran.byActivity.map((a) => [
    escapeHtml(a.name),
    escapeHtml(String(a.bookings)),
    escapeHtml(String(a.pax)),
    escapeHtml(formatTotals(a.gross)),
    escapeHtml(formatTotals(a.net)),
  ]);
  parts.push(
    section(
      "Trips by activity today",
      ranRows.length
        ? table(["Activity", "Bookings", "Pax", "Gross", "Net"], ranRows, { numericFrom: 1 })
        : `<p style="${S.note};margin:0">No trips were scheduled to run today.</p>`
    )
  );

  // --- Cash & ledger -----------------------------------------------------
  parts.push(
    section(
      "Cash & ledger",
      table(
        ["Line", "Amount"],
        [
          [`Cash collected (${count(r.cash.payments, "payment")})`, escapeHtml(formatTotals(r.cash.collected))],
          ["Equipment rental", escapeHtml(formatTotals(r.cash.rentals))],
          ["Expenses", escapeHtml(formatTotals(r.cash.expenses))],
          ["Other income", escapeHtml(formatTotals(r.cash.otherIncome))],
          ["Net (trips)", escapeHtml(formatTotals(r.ran.net))],
          ["<strong>Profit estimate</strong>", `<strong>${escapeHtml(formatTotals(r.cash.profit))}</strong>`],
        ],
        { numericFrom: 1 }
      )
    )
  );

  // --- Outstanding -------------------------------------------------------
  const outRows = r.outstanding.rows.map((o) => [
    escapeHtml(o.ref),
    escapeHtml(o.name),
    escapeHtml(o.activity),
    escapeHtml(formatTotals(o.due)),
  ]);
  parts.push(
    section(
      "Outstanding balances",
      (outRows.length
        ? table(["Ref", "Guest", "Activity", "Due"], outRows, { numericFrom: 3 })
        : `<p style="${S.note};margin:0">Nothing outstanding.</p>`) +
        (r.outstanding.hidden > 0
          ? `<p style="${S.note}">+${r.outstanding.hidden} more · total outstanding ${escapeHtml(formatTotals(r.outstanding.total))}</p>`
          : "")
    )
  );

  // --- Tomorrow ----------------------------------------------------------
  const tomorrowInner = r.tomorrowTrips.byActivity.length
    ? r.tomorrowTrips.byActivity
        .map((a) => {
          const lineRows = a.lines.map((l) => {
            const bits = [l.time, l.ref, count(l.guests, "guest")];
            if (l.source === "Agent") bits.push(l.agent ? `agent ${l.agent}` : "agent");
            if (l.consentPending > 0) bits.push(`${count(l.consentPending, "waiver")} pending`);
            if (l.payment !== "paid") bits.push(l.payment);
            return [escapeHtml(l.names), escapeHtml(bits.join(" · "))];
          });
          return (
            `<p style="${S.sub2}">${escapeHtml(a.activity)} — ${count(a.bookings, "booking")}, ${count(a.pax, "guest")}` +
            (a.consentPending > 0 ? `, ${count(a.consentPending, "waiver")} outstanding` : "") +
            `</p>` +
            table(["Guest", "Detail"], lineRows, { numericFrom: 9 }) +
            (a.hidden > 0 ? `<p style="${S.note}">+${a.hidden} more booking(s)</p>` : "")
          );
        })
        .join("")
    : `<p style="${S.note};margin:0">Nothing booked for tomorrow.</p>`;

  parts.push(
    section(
      `Tomorrow — ${friendlyDate(r.tomorrow)}`,
      `<p style="${S.note};margin:0 0 6px">${count(r.tomorrowTrips.bookings, "booking")} · ${count(r.tomorrowTrips.pax, "guest")} · ${count(r.tomorrowTrips.consentPending, "waiver")} outstanding</p>` +
        tomorrowInner
    )
  );

  if (r.failures.length > 0) {
    parts.push(
      `<div style="${S.warn}"><strong>Incomplete sections</strong><br />${r.failures.map((f) => escapeHtml(f)).join("<br />")}</div>`
    );
  }

  const url = reportUrl(r.date);
  parts.push(
    `<p style="${S.foot}">` +
      (url ? `<a href="${escapeHtml(url)}" style="color:#0d3b53">Open the full day report</a> · ` : "") +
      `Sent automatically at 23:00 Maldives time. Reply to this email with corrections.</p>`
  );

  return (
    `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">${parts.join("")}</div></body></html>`
  );
}

export interface DayEndMail {
  subject: string;
  text: string;
  html: string;
}

export function renderDayEndMail(report: DayEndReport): DayEndMail {
  return {
    subject: buildSubject(report),
    text: buildText(report),
    html: buildHtml(report),
  };
}
