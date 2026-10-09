"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { formatMoney, validCurrency } from "@/lib/money";
import { invoiceBalanceCents, type PaymentLike } from "@/lib/reports";
import { markInvoicePaid } from "@/lib/supabase/actions";
import { Toast } from "@/app/admin/components/AdminModal";
import SendInvoiceButton from "@/app/admin/components/SendInvoiceButton";
import QuickInvoiceModal, {
  type QuickInvoiceActivity,
  type QuickInvoiceCreated,
} from "./QuickInvoiceModal";

interface InvoicePayment {
  amount_cents?: number | null;
  converted_amount_cents?: number | null;
  status?: string | null;
}

export interface InvoiceRow {
  id: string;
  booking_ref: string;
  created_at: string;
  booking_date: string | null;
  status: string | null;
  payment_status: string | null;
  total_cents: number | null;
  estimated_total_cents: number | null;
  booking_currency: string | null;
  guests: number | null;
  pricing_option_label: string | null;
  activities: { name?: string | null } | null;
  customers: { full_name?: string | null; email?: string | null } | null;
  payments?: InvoicePayment[] | null;
}

interface InvoicesClientProps {
  partners: string[];
  from: string;
  to: string;
  activities: QuickInvoiceActivity[];
  invoices: InvoiceRow[];
}

export default function InvoicesClient({
  partners,
  from,
  to,
  activities,
  invoices,
}: InvoicesClientProps) {
  const router = useRouter();
  const [partner, setPartner] = useState<string>("");
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [created, setCreated] = useState<QuickInvoiceCreated | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [marking, startMarking] = useTransition();

  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL || "https://thoddoomarineexcursion.com";

  function openPartnerStatement(download: boolean) {
    const p = partner.trim();
    if (!p) return;
    const url = `${siteUrl}/api/admin/invoices/partner/pdf?partner=${encodeURIComponent(p)}&from=${fromDate}&to=${toDate}${download ? "&download=1" : ""}`;
    setBusy(true);
    try {
      window.open(url, "_blank");
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  }

  function handleCreated(invoice: QuickInvoiceCreated) {
    setCreated(invoice);
    setModalOpen(false);
    router.refresh();
  }

  function handleMarkPaid(invoice: InvoiceRow, dueCents: number, currency: "USD" | "MVR") {
    const name = String(invoice.customers?.full_name || "this bill-to");
    if (!window.confirm(`Record ${formatMoney(dueCents, currency)} received from ${name}? This marks ${invoice.booking_ref} paid and adds it to revenue.`)) return;
    startMarking(async () => {
      try {
        await markInvoicePaid(invoice.id, "cash");
        setToast({ type: "success", message: `${invoice.booking_ref} marked paid.` });
        router.refresh();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Could not mark the invoice paid." });
      }
    });
  }

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} />}

      <div className="adminSection">
        <div className="adminSectionHeaderRow">
          <div>
            <h2>New invoice</h2>
            <p className="adminPageSub" style={{ margin: 0 }}>
              Type who is paying, what the trip is and how much — you get an invoice number, a PDF, an email button
              and a paid switch that lands the money in your reports.
            </p>
          </div>
          <button className="addBtn" onClick={() => setModalOpen(true)}>+ New invoice</button>
        </div>

        {created && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderLeft: "4px solid #16a34a",
              borderRadius: 10,
              padding: "12px 16px",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <strong>Invoice {created.booking_ref} created.</strong>{" "}
              <span style={{ color: "#475569", fontSize: "0.85rem" }}>
                Download it, email it, then mark it paid when the money arrives.
              </span>
            </div>
            <span className="inlineActions">
              <a
                className="actionBtn"
                href={`/api/admin/invoices/booking/${created.id}/pdf?download=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open invoice PDF"
              >
                ¶
              </a>
              <SendInvoiceButton
                kind="booking"
                id={created.id}
                email={invoices.find((i) => i.id === created.id)?.customers?.email || null}
                onResult={setToast}
              />
              <button className="actionBtn" onClick={() => setCreated(null)} title="Dismiss">
                ✕
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="adminSection">
        <h2>Recent invoices</h2>
        {invoices.length > 0 ? (
          <div className="tableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Billed to</th>
                  <th>Trip</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const payable = Math.max(Number(inv.total_cents || inv.estimated_total_cents) || 0, 0);
                  const balance = invoiceBalanceCents(payable, (inv.payments || []) as PaymentLike[]);
                  const paid = Math.max(payable - balance, 0);
                  const currency = validCurrency(inv.booking_currency);
                  const activity = String(inv.activities?.name || "—");
                  const email = inv.customers?.email || null;
                  const paymentStatus = balance <= 0 && payable > 0 ? "paid" : String(inv.payment_status || "unpaid");
                  return (
                    <tr key={inv.id}>
                      <td className="mono">{inv.booking_ref}</td>
                      <td>{String(inv.customers?.full_name || "—")}</td>
                      <td>
                        <div>{activity}</div>
                        {inv.pricing_option_label ? (
                          <div style={{ color: "#647993", fontSize: "0.75rem" }}>{inv.pricing_option_label}</div>
                        ) : null}
                      </td>
                      <td>{fmtDate(inv.booking_date || inv.created_at)}</td>
                      <td><strong>{formatMoney(payable, currency)}</strong></td>
                      <td>{formatMoney(paid, currency)}</td>
                      <td>
                        <span className={`badge badge-${paymentStatus}`}>{paymentStatus}</span>{" "}
                        <span style={{ fontSize: "0.75rem", color: balance > 0 ? "#c0392b" : "#647993" }}>
                          {formatMoney(balance, currency)} due
                        </span>
                      </td>
                      <td>
                        <span className="inlineActions">
                          <a
                            className="actionBtn"
                            href={`/api/admin/invoices/booking/${inv.id}/pdf?download=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Invoice PDF"
                          >
                            ¶
                          </a>
                          <SendInvoiceButton kind="booking" id={inv.id} email={email} onResult={setToast} />
                          {balance > 0 ? (
                            <button
                              className="actionBtn"
                              disabled={marking}
                              onClick={() => handleMarkPaid(inv, balance, currency)}
                              title={`Mark paid — record ${formatMoney(balance, currency)} received`}
                            >
                              $
                            </button>
                          ) : (
                            <span className="badge badge-paid" title="Nothing outstanding">Paid ✓</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptyState">
            <p>No invoices yet — press + New invoice to raise your first one.</p>
          </div>
        )}
      </div>

      <div className="adminSection">
        <h2>Partner Statement</h2>
        <p className="adminPageSub" style={{ marginTop: 4 }}>
          Generate a PDF statement for one partner, itemising their bookings, gross value, commission and net across a date range.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="adminLabel" htmlFor="inv-partner">Partner</label>
            {partners.length > 0 ? (
              <select
                id="inv-partner"
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                style={{ minWidth: 240, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                <option value="">Select a partner…</option>
                {partners.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <input
                id="inv-partner"
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                placeholder="Type a partner name…"
                style={{ minWidth: 240, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
              />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="adminLabel" htmlFor="inv-from">From</label>
            <input id="inv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label className="adminLabel" htmlFor="inv-to">To</label>
            <input id="inv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={busy || !partner.trim()} onClick={() => openPartnerStatement(false)} style={{ padding: "8px 16px" }}>
              View PDF
            </button>
            <button className="addBtn" disabled={busy || !partner.trim()} onClick={() => openPartnerStatement(true)}>
              Download
            </button>
          </div>
        </div>
      </div>

      <div className="adminSection">
        <h2>How guest invoices work</h2>
        <p className="adminPageSub" style={{ marginTop: 4 }}>
          Every invoice is a booking, so the same PDF, email and payment also appear on{" "}
          <a href="/admin/bookings" style={{ textDecoration: "underline" }}>Bookings</a>. Press ¶ for the PDF or ✉ to
          email it (the page asks for an address when the bill-to has none). When the money arrives, press $ — the
          payment is recorded, the balance clears and the amount lands in Collected, Net Profit and the income
          ledger. To take a deposit or a part payment instead, record it on the{" "}
          <a href="/admin/payments" style={{ textDecoration: "underline" }}>Payments</a> page.
        </p>
      </div>

      {modalOpen && (
        <QuickInvoiceModal activities={activities} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
      )}
    </>
  );
}
