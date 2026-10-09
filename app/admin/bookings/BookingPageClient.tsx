"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { formatMoney, validCurrency } from "@/lib/money";
import { confirmBookingGroup, createGroupPayment } from "@/lib/supabase/actions";
import BookingForm from "./BookingForm";
import BookingActions from "./BookingActions";
import CheckinQRManager from "./CheckinQRManager";
import ConsentOfferModal from "./ConsentOfferModal";
import WalkinQRModal from "./WalkinQRModal";
import AgentQRModal from "./AgentQRModal";
import AssignTripModal from "./AssignTripModal";
import BookingChargesModal from "./BookingChargesModal";
import BookingGroupModal from "./BookingGroupModal";
import WhatsAppSendModal from "@/app/admin/components/WhatsAppSendModal";
import SendInvoiceButton from "@/app/admin/components/SendInvoiceButton";
import { Toast } from "@/app/admin/components/AdminModal";

interface BookingPageClientProps {
  initialBookings: Record<string, unknown>[];
  currentStatus: string;
}

function sourceBadge(source: unknown): string {
  const s = String(source || "");
  if (s === "online") return "Website";
  if (s === "whatsapp") return "WhatsApp";
  if (s === "walk_in") return "Walk-in";
  if (s === "agent") return "Agent";
  return s || "—";
}

/**
 * Agent attribution for a folio row. Written server-side by submit_agent_booking
 * (migration 076) from the issuing link, so it survives a staff rename — this is
 * purely for "who sold this" on the ledger. Callers only render it when at least
 * one row carries a name.
 */
function agentCell(rows: Record<string, unknown>[]) {
  const names = Array.from(
    new Set(rows.map((r) => String(r.agent_name || "")).filter(Boolean))
  );
  return <span title="Agent this booking was sold by">{names.join(", ")}</span>;
}

interface PaymentShape {
  amount_cents?: number;
  converted_amount_cents?: number;
  status?: string;
}

function bookingTotals(b: Record<string, unknown>) {
  const currency = validCurrency(b.booking_currency);
  const total = Number(b.total_cents) > 0 ? Number(b.total_cents) : Number(b.estimated_total_cents) || 0;
  const paymentsArr = (b.payments as PaymentShape[] | undefined) || [];
  const paid = paymentsArr
    .filter((p) => String(p.status) === "completed")
    .reduce((s, p) => s + Math.round(Number(p.converted_amount_cents ?? p.amount_cents ?? 0) || 0), 0);
  return { currency, total, paid, remaining: Math.max(total - paid, 0) };
}

function partyCell(b: Record<string, unknown>) {
  const adults = Number(b.adults) || 0;
  const childrenCount = Number(b.children_count) || 0;
  const guests = Number(b.guests) || adults + childrenCount || 0;
  if (adults > 0 || childrenCount > 0) {
    return (
      <span title={`Adults: ${adults}, Children: ${childrenCount}`}>
        {guests}
        {adults > 0 && childrenCount > 0 && (
          <small className="textMuted"> ({adults}+{childrenCount})</small>
        )}
      </span>
    );
  }
  return <span>{String(guests)}</span>;
}

export default function BookingPageClient({ initialBookings, currentStatus }: BookingPageClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Record<string, unknown> | undefined>(undefined);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [qrBooking, setQrBooking] = useState<Record<string, unknown> | null>(null);
  const [consentBooking, setConsentBooking] = useState<Record<string, unknown> | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [assignBooking, setAssignBooking] = useState<Record<string, unknown> | null>(null);
  const [chargesBooking, setChargesBooking] = useState<Record<string, unknown> | null>(null);
  const [groupBooking, setGroupBooking] = useState<Record<string, unknown> | null>(null);
  const [waBooking, setWaBooking] = useState<Record<string, unknown> | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL || "https://thoddoomarineexcursion.com";

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  function refresh() {
    router.refresh();
    setFormOpen(false);
    setEditingBooking(undefined);
    setToast({ type: "success", message: editingBooking?.id ? "Booking updated." : "Booking created." });
    setTimeout(() => setToast(null), 3000);
  }

  // Group bookings by shared group_id so a multi-trip folio renders as ONE row.
  const groups = new Map<string, Record<string, unknown>[]>();
  const standalone: Record<string, unknown>[] = [];
  for (const b of initialBookings) {
    const gid = b.group_id ? String(b.group_id) : null;
    if (gid) {
      const list = groups.get(gid) || [];
      list.push(b);
      groups.set(gid, list);
    } else {
      standalone.push(b);
    }
  }

  function toggleGroup(gid: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  async function payGroup(gid: string) {
    if (!window.confirm("Record a full payment for every unpaid booking in this group?")) return;
    try {
      const res = await createGroupPayment(gid, "cash");
      showToast("success", `Paid ${res.paidCount} trip(s); ${res.skippedCount} already settled.`);
      router.refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to pay group");
    }
  }

  async function confirmGroup(gid: string) {
    try {
      await confirmBookingGroup(gid);
      showToast("success", "Group confirmed — trips prepared for each chosen date.");
      router.refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to confirm group");
    }
  }

  function renderBookingRow(b: Record<string, unknown>, sub = false) {
    const customers = b.customers as Record<string, unknown> | undefined;
    const activities = b.activities as Record<string, unknown> | undefined;
    const guestEmail = typeof customers?.email === "string" ? customers.email.trim() : "";
    const adults = Number(b.adults) || 0;
    const childrenCount = Number(b.children_count) || 0;
    const guests = Number(b.guests) || adults + childrenCount || 0;
    const { currency, total, paid, remaining } = bookingTotals(b);
    const paymentStatus = String(b.payment_status || "unpaid");
    const cf = b.consent_forms as { status?: string; signed_at?: string }[] | undefined;
    const pending = cf?.find((c) => c.status === "pending");
    const signed = cf?.find((c) => c.status === "signed");
    const isPaidConfirmed = String(b.payment_status) === "paid" && String(b.status) === "confirmed";
    const trip = b.trips as Record<string, unknown> | undefined;
    const canAssign = !trip && String(b.status) === "confirmed" && Boolean(b.activity_id) && Boolean(b.booking_date);

    return (
      <tr key={String(b.id)} className={`${String(b.status) === "cancelled" ? "is-cancelled" : ""} ${sub ? "folioSubRow" : ""}`}>
        <td className="mono">
          {sub && <span className="textMuted">↳ </span>}
          {String(b.booking_ref)}
          {Boolean(b.group_id) && (
            <span className="badge" style={{ marginLeft: 6 }} title="Multi-activity group">group</span>
          )}
        </td>
        <td>
          {String(customers?.full_name || "—")}
          {b.special_requests ? " *" : ""}
          {/* The guest's own address, so staff can tell bookings apart and see
              where the invoice and waiver went without opening each one. */}
          {guestEmail ? (
            <a
              href={`mailto:${guestEmail}`}
              className="textMuted"
              style={{ display: "block", fontSize: "0.72rem", marginTop: 2 }}
              onClick={(e) => e.stopPropagation()}
            >
              {guestEmail}
            </a>
          ) : (
            <span className="textMuted" style={{ display: "block", fontSize: "0.72rem", marginTop: 2 }}>
              no email
            </span>
          )}
        </td>
        <td>{String(activities?.name || "—")}</td>
        <td>
          <span className={`badge badge-source-${String(b.source || "walk_in")}`}>
            {sourceBadge(b.source)}
          </span>
          {b.agent_name ? (
            <div className="textMuted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
              {String(b.agent_name)}
            </div>
          ) : null}
        </td>
        <td>{b.booking_date ? fmtDate(String(b.booking_date)) : fmtDate(String(b.created_at))}</td>
        <td>{String(b.preferred_time || "—")}</td>
        <td>{partyCell(b)}</td>
        <td>{String(b.pricing_option_label || "—")}</td>
        <td>
          {b.hotel_name ? (
            <span>{String(b.hotel_name)}{b.room_number ? ` / ${b.room_number}` : ""}</span>
          ) : (
            customers?.hotel ? <span>{String(customers.hotel)}</span> : "—"
          )}
        </td>
        <td>{String(b.pickup_location || "—")}</td>
        <td>
          {total > 0 ? (
            <strong>{formatMoney(total, currency)}</strong>
          ) : (
            "—"
          )}
        </td>
        <td>
          <span title={`${formatMoney(paid, currency)} / ${formatMoney(total, currency)}`}>
            <span className={`badge badge-${paymentStatus}`}>{paymentStatus}</span>
            {total > 0 && (
              <span style={{ marginLeft: 6, fontSize: "0.75rem", color: "#647993" }}>
                {formatMoney(paid, currency)} / {formatMoney(total, currency)}
                {remaining > 0 && (
                  <span style={{ color: "#c0392b" }}> ({formatMoney(remaining, currency)} left)</span>
                )}
              </span>
            )}
          </span>
        </td>
        <td><span className={`badge badge-${String(b.status)}`}>{String(b.status)}</span></td>
        <td>
          <span className="inlineActions">
            {signed ? (
              <span className="badge badge-signed" title="Consent signed">Signed ✓</span>
            ) : pending ? (
              <span className="badge badge-pending" title="Pending signature">Pending</span>
            ) : (
              <span className="textMuted">—</span>
            )}
            {!signed && isPaidConfirmed && (
              <button
                className="actionBtn"
                onClick={() => setConsentBooking(b)}
                title="Offer consent form (WhatsApp invite / link / QR)"
              >
                ✉
              </button>
            )}
          </span>
        </td>
        <td>
          <span className="inlineActions">
            {trip ? (
              <a className="tripLink" href="/admin/manifests" title={`Trip ${String(trip.trip_ref)} @ ${String(trip.start_time || "")}`}>
                {String(trip.trip_ref)}
              </a>
            ) : (
              <span className="textMuted">—</span>
            )}
            {canAssign && (
              <button
                className="actionBtn"
                onClick={() => setAssignBooking(b)}
                title="Assign to a boat trip manually"
              >
                ⇢
              </button>
            )}
          </span>
        </td>
        <td>
          <div className="inlineActions">
            <button
              className="actionBtn"
              onClick={() => setWaBooking(b)}
              title="Send WhatsApp message to guest"
              disabled={!String((customers as Record<string, unknown> | undefined)?.phone || "").trim()}
            >
              💬
            </button>
            <button
              className="actionBtn"
              onClick={() => { setEditingBooking(b); setFormOpen(true); }}
              title="Edit"
            >
              ✎
            </button>
            <button
              className="actionBtn"
              onClick={() => setQrBooking(b)}
              title="Guest Consent QR"
            >
              ▣
            </button>
            {Boolean(b.group_id) && (
              <button
                className="actionBtn"
                onClick={() => setGroupBooking(b)}
                title="Multi-activity group"
              >
                ⧉
              </button>
            )}
            <button
              className="actionBtn"
              onClick={() => setChargesBooking(b)}
              title="Damage / accident / fuel charges"
            >
              $
            </button>
            <BookingActions bookingId={String(b.id)} currentStatus={String(b.status)} />
            <button
              className="actionBtn"
              onClick={() => window.open(`/api/admin/invoices/booking/${String(b.id)}/pdf`, "_blank")}
              title="Invoice PDF"
            >
              ¶
            </button>
            <SendInvoiceButton
              kind="booking"
              id={String(b.id)}
              email={(customers?.email as string | undefined) || null}
              onResult={setToast}
            />
            {/* The agent's copy: gross, commission and net. Only for bookings
                that actually have a partner — otherwise the route refuses. */}
            {b.partner ? (
              <button
                className="actionBtn"
                onClick={() => window.open(`/api/admin/invoices/booking/${String(b.id)}/partner/pdf`, "_blank")}
                title="Agent invoice PDF (includes commission)"
              >
                %
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  function renderGroupRow(gid: string, rows: Record<string, unknown>[]) {
    const first = rows[0];
    const customers = first.customers as Record<string, unknown> | undefined;
    const source = sourcesForGroup(rows);
    const { currency, total, paid, remaining } = groupTotals(rows);
    const paymentStatus = remaining <= 0 && total > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    const statusSummary = groupStatusSummary(rows);
    const consentSummary = groupConsentSummary(rows);
    const tripSummary = groupTripSummary(rows);
    const dateRange = groupDateRange(rows);
    const expanded = expandedGroups.has(gid);
    const pendingCount = rows.filter((r) => String(r.status) === "pending").length;

    return (
      <Fragment key={gid}>
        <tr className="folioRow">
          <td className="mono">
            <button
              className="actionBtn"
              onClick={() => toggleGroup(gid)}
              title={expanded ? "Collapse trips" : "Show trips"}
            >
              {expanded ? "▾" : "▸"}
            </button>{" "}
            Folio · {rows.length} trips
            <span className="badge" style={{ marginLeft: 6 }} title="Multi-activity group">group</span>
          </td>
          <td>
            {String(customers?.full_name || "—")}
            {first.special_requests ? " *" : ""}
          </td>
          <td>{rows.map((r) => String((r.activities as Record<string, unknown> | undefined)?.name || "?")).join(" · ")}</td>
          <td>
            {Array.from(source).map((s) => (
              <span key={s} className={`badge badge-source-${s}`} style={{ marginRight: 4 }}>
                {sourceBadge(s)}
              </span>
            ))}
            {first.agent_name ? (
              <div className="textMuted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                {agentCell(rows)}
              </div>
            ) : null}
          </td>
          <td>{dateRange}</td>
          <td>
            {rows.some((r) => r.preferred_time) ? "varying" : "—"}
          </td>
          <td>{partyCell(first)}</td>
          <td className="textMuted">—</td>
          <td>
            {first.hotel_name ? (
              <span>{String(first.hotel_name)}{first.room_number ? ` / ${String(first.room_number)}` : ""}</span>
            ) : (
              customers?.hotel ? <span>{String(customers.hotel)}</span> : "—"
            )}
          </td>
          <td className="textMuted">—</td>
          <td>
            {total > 0 ? (
              <strong>{formatMoney(total, currency)}</strong>
            ) : (
              "—"
            )}
          </td>
          <td>
            <span title={`${formatMoney(paid, currency)} / ${formatMoney(total, currency)}`}>
              <span className={`badge badge-${paymentStatus}`}>{paymentStatus}</span>
              {total > 0 && (
                <span style={{ marginLeft: 6, fontSize: "0.75rem", color: "#647993" }}>
                  {formatMoney(paid, currency)} / {formatMoney(total, currency)}
                  {remaining > 0 && (
                    <span style={{ color: "#c0392b" }}> ({formatMoney(remaining, currency)} left)</span>
                  )}
                </span>
              )}
            </span>
          </td>
          <td>{statusSummary}</td>
          <td>{consentSummary}</td>
          <td>{tripSummary}</td>
          <td>
            <div className="inlineActions">
              <button
                className="actionBtn"
                onClick={() => setWaBooking(first)}
                title="Send WhatsApp message to guest"
                disabled={!String((customers as Record<string, unknown> | undefined)?.phone || "").trim()}
              >
                💬
              </button>
              <button
                className="actionBtn"
                disabled={pendingCount === 0}
                onClick={() => confirmGroup(gid)}
                title={`Confirm all pending (${pendingCount}) — trips prepared for each chosen date`}
              >
                ✓
              </button>
              <button
                className="actionBtn"
                onClick={() => payGroup(gid)}
                title="Pay full group — settle every unpaid trip"
              >
                $
              </button>
              <button
                className="actionBtn"
                onClick={() => setGroupBooking(first)}
                title="Group folio detail"
              >
                ⧉
              </button>
              <button
                className="actionBtn"
                onClick={() => toggleGroup(gid)}
                title="Expand / collapse trips"
              >
                {expanded ? "−" : "+"}
              </button>
            </div>
          </td>
        </tr>
        {expanded && rows.map((r) => renderBookingRow(r, true))}
      </Fragment>
    );
  }

  function sourcesForGroup(rows: Record<string, unknown>[]) {
    return new Set(rows.map((r) => String(r.source || "walk_in")));
  }

  function groupTotals(rows: Record<string, unknown>[]) {
    const cur = new Map<string, { total: number; paid: number }>();
    for (const r of rows) {
      const { currency, total, paid } = bookingTotals(r);
      const acc = cur.get(currency) || { total: 0, paid: 0 };
      acc.total += total;
      acc.paid += paid;
      cur.set(currency, acc);
    }
    const [currencyRaw = "USD", agg = { total: 0, paid: 0 }] = cur.size ? [...cur.entries()][0] : ["USD"];
    return { currency: validCurrency(currencyRaw), total: agg.total, paid: agg.paid, remaining: Math.max(agg.total - agg.paid, 0) };
  }

  function groupStatusSummary(rows: Record<string, unknown>[]) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const s = String(r.status || "pending");
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    return (
      <span>
        {[...counts.entries()].map(([s, n]) => (
          <span key={s} className={`badge badge-${s}`} style={{ marginRight: 4 }}>{s}×{n}</span>
        ))}
      </span>
    );
  }

  function groupConsentSummary(rows: Record<string, unknown>[]) {
    let signed = 0;
    let pending = 0;
    let none = 0;
    for (const r of rows) {
      const cf = (r.consent_forms as { status?: string }[] | undefined) || [];
      if (cf.some((c) => c.status === "signed")) signed += 1;
      else if (cf.some((c) => c.status === "pending")) pending += 1;
      else none += 1;
    }
    if (signed > 0 && pending === 0 && none === 0) {
      return <span className="badge badge-signed">All signed</span>;
    }
    return (
      <span className="textMuted" style={{ fontSize: "0.75rem" }}>
        {signed > 0 && <span>Signed {signed}</span>}
        {pending > 0 && <span>{signed > 0 ? " · " : ""}Pending {pending}</span>}
        {none > 0 && <span>{signed + pending > 0 ? " · " : ""}— {none}</span>}
      </span>
    );
  }

  function groupTripSummary(rows: Record<string, unknown>[]) {
    const assigned = rows.filter((r) => r.trips).length;
    const total = rows.length;
    if (assigned === 0) return <span className="textMuted">—</span>;
    return (
      <a className="tripLink" href="/admin/manifests" title="Open manifests">
        {assigned}/{total} assigned
      </a>
    );
  }

  function groupDateRange(rows: Record<string, unknown>[]) {
    const dates = rows
      .map((r) => (r.booking_date ? String(r.booking_date) : r.created_at ? String(r.created_at) : ""))
      .filter(Boolean)
      .map((d) => new Date(d));
    if (dates.length === 0) return <span className="textMuted">—</span>;
    const min = new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
    const max = new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
    const same = min === max;
    if (same) return fmtDate(min);
    return `${fmtDate(min)} → ${fmtDate(max)}`;
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}
      <div className="pageActions" style={{ marginBottom: 16 }}>
        <button className="addBtn" onClick={() => { setEditingBooking(undefined); setFormOpen(true); }}>
          + New Booking
        </button>
        <button
          className="addBtn"
          style={{ background: "linear-gradient(135deg, #0a7fb0, #0a5fb0)", color: "#fff" }}
          onClick={() => setWalkinOpen(true)}
        >
          Walk-in QR
        </button>
        <button
          className="addBtn"
          style={{ background: "#f0f7ff", color: "var(--blue)", border: "1.5px solid #c8ddf0" }}
          onClick={() => setAgentOpen(true)}
          title="Issue a QR for a trip you already quoted — the guest never sees the price"
        >
          Agent QR
        </button>
      </div>
      <div className="filterBar">
        {["all", "pending", "confirmed", "completed", "cancelled"].map((s) => (
          <a
            key={s}
            href={`/admin/bookings?status=${s}`}
            className={`filterBtn ${currentStatus === s ? "active" : ""}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </a>
        ))}
      </div>
      {initialBookings.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Customer</th>
                <th>Activity</th>
                <th>Source</th>
                <th>Date</th>
                <th>Time</th>
                <th>Pax</th>
                <th>Option</th>
                <th>Hotel / Room</th>
                <th>Pickup</th>
                <th>Est. Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Consent</th>
                <th>Trip</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([gid, rows]) => renderGroupRow(gid, rows))}
              {standalone.map((b) => renderBookingRow(b))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No bookings found{currentStatus !== "all" ? ` with status "${currentStatus}"` : ""}.</p>
        </div>
      )}
      <BookingForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingBooking(undefined); }}
        booking={editingBooking}
        onSaved={refresh}
      />
      {qrBooking && (
        <CheckinQRManager
          bookingId={String(qrBooking.id)}
          bookingRef={String(qrBooking.booking_ref)}
          activityId={String(qrBooking.activity_id)}
          activityName={String(
            (qrBooking.activities as Record<string, unknown>)?.name || ""
          )}
          guestCount={Number(qrBooking.guests) || 1}
          onClose={() => setQrBooking(null)}
        />
      )}
      {consentBooking && (
        <ConsentOfferModal
          bookingId={String(consentBooking.id)}
          bookingRef={String(consentBooking.booking_ref)}
          customerId={String(consentBooking.customer_id)}
          activityId={String(consentBooking.activity_id)}
          guestName={String(
            (consentBooking.customers as Record<string, unknown>)?.full_name || "Guest"
          )}
          phone={(consentBooking.customers as Record<string, unknown>)?.phone as string | undefined}
          activityName={String(
            (consentBooking.activities as Record<string, unknown>)?.name || ""
          )}
          bookingDate={String(consentBooking.booking_date || consentBooking.created_at || "")}
          onClose={() => setConsentBooking(null)}
        />
      )}
      {walkinOpen && (
        <WalkinQRModal
          siteUrl={siteUrl}
          onClose={() => setWalkinOpen(false)}
          showToast={showToast}
        />
      )}
      {agentOpen && (
        <AgentQRModal
          siteUrl={siteUrl}
          onClose={() => setAgentOpen(false)}
          showToast={showToast}
        />
      )}
      {assignBooking && (
        <AssignTripModal
          booking={{
            id: String(assignBooking.id),
            booking_ref: String(assignBooking.booking_ref),
            activity_id: String(assignBooking.activity_id),
            booking_date: String(assignBooking.booking_date || assignBooking.created_at || ""),
            preferred_time: (assignBooking.preferred_time as string | null) || null,
            guests: Number(assignBooking.guests) || 0,
            customer_name: String(
              (assignBooking.customers as Record<string, unknown>)?.full_name || ""
            ),
            activity_name: String(
              (assignBooking.activities as Record<string, unknown>)?.name || ""
            ),
          }}
          onClose={() => setAssignBooking(null)}
          onAssigned={(msg) => {
            setAssignBooking(null);
            showToast("success", msg);
            router.refresh();
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
      {chargesBooking && (
        <BookingChargesModal
          bookingId={String(chargesBooking.id)}
          bookingRef={String(chargesBooking.booking_ref)}
          onClose={() => setChargesBooking(null)}
          showToast={showToast}
        />
      )}
      {groupBooking && (
        <BookingGroupModal
          groupId={String(groupBooking.group_id)}
          groupRef={String(groupBooking.group_id)}
          onClose={() => setGroupBooking(null)}
          showToast={showToast}
        />
      )}
      {waBooking && (
        <WhatsAppSendModal
          open={true}
          onClose={() => setWaBooking(null)}
          phone={String(
            (waBooking.customers as Record<string, unknown> | undefined)?.phone || ""
          )}
          guestName={String(
            (waBooking.customers as Record<string, unknown> | undefined)?.full_name || "Guest"
          )}
          context={{
            activity: String((waBooking.activities as Record<string, unknown> | undefined)?.name || ""),
            date: waBooking.booking_date ? fmtDate(String(waBooking.booking_date)) : "",
            time: (waBooking.preferred_time as string | null) || "",
            reference: String(waBooking.booking_ref || ""),
            amount: (() => {
              const { currency, remaining } = bookingTotals(waBooking);
              return remaining > 0 ? formatMoney(remaining, currency) : "";
            })(),
          }}
        />
      )}
    </>
  );
}