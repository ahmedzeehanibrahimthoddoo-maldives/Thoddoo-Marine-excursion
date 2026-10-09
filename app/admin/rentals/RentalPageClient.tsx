"use client";

import { useState, useTransition, useCallback } from "react";
import { fmtDateTime } from "@/lib/format";
import { formatMoney, validCurrency } from "@/lib/money";
import RentalCheckoutForm from "./RentalCheckoutForm";
import RentalReturnForm from "./RentalReturnForm";
import RentalPaymentModal from "./RentalPaymentModal";
import RentalQRModal from "./RentalQRModal";
import RentalWalkinQRModal from "./RentalWalkinQRModal";
import RentalRequestsPanel from "./RentalRequestsPanel";
import IssueRentalRequestModal from "./IssueRentalRequestModal";
import SendInvoiceButton from "@/app/admin/components/SendInvoiceButton";
import { cancelRentalRequest, type RentalRequestRow } from "@/lib/supabase/actions";

interface RentalPageClientProps {
  rentals: Record<string, unknown>[];
  requests: RentalRequestRow[];
  currentStatus: string;
}

interface ConsentEmbed {
  status?: string | null;
  guest_name?: string | null;
  is_minor?: boolean | null;
  signed_at?: string | null;
}

const toConsent = (r: Record<string, unknown>): ConsentEmbed | null => {
  const raw = r.consent_forms;
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) as ConsentEmbed | undefined ?? null;
};

const SITE_URL = typeof window !== "undefined" ? window.location.origin : "";

export default function RentalPageClient({ rentals, requests, currentStatus }: RentalPageClientProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [returnRental, setReturnRental] = useState<Record<string, unknown> | null>(null);
  const [payRental, setPayRental] = useState<Record<string, unknown> | null>(null);
  const [qrRental, setQrRental] = useState<Record<string, unknown> | null>(null);
  const [walkinQrOpen, setWalkinQrOpen] = useState(false);
  const [issueRequest, setIssueRequest] = useState<RentalRequestRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
  }, []);

  const refresh = () => {
    startTransition(() => {
      window.location.reload();
    });
  };

  const copyLink = useCallback((signingToken: string) => {
    const url = `${SITE_URL}/rental/${signingToken}`;
    navigator.clipboard.writeText(url).then(
      () => setToast({ type: "success", message: "Rental agreement link copied." }),
      () => setToast({ type: "error", message: "Failed to copy link." }),
    );
  }, []);

  const shareWhatsApp = useCallback((signingToken: string, customerName: string) => {
    const url = `${SITE_URL}/rental/${signingToken}`;
    const text = `Hi ${customerName}, please review and sign your Thoddoo Marine equipment rental agreement:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }, []);

  const isExpired = (expiryDate: unknown) => {
    if (!expiryDate) return false;
    return new Date(expiryDate as string) < new Date();
  };

  const handleCancelRequest = useCallback(
    (req: RentalRequestRow) => {
      startTransition(async () => {
        try {
          await cancelRentalRequest(req.id);
          showToast("success", "Walk-in request cancelled.");
          refresh();
        } catch (err) {
          showToast("error", err instanceof Error ? err.message : "Could not cancel the request.");
        }
      });
    },
    [showToast]
  );

  return (
    <>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 300, padding: "10px 16px", borderRadius: 8, background: toast.type === "success" ? "#059669" : "#dc2626", color: "#fff", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
          {toast.message}
        </div>
      )}

      <div className="adminPageHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Equipment Rentals</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setWalkinQrOpen(true)}>
            ▦ Walk-in QR
          </button>
          <button className="btn btn-primary" onClick={() => setCheckoutOpen(true)}>
            + Checkout Equipment
          </button>
        </div>
      </div>

      <RentalRequestsPanel
        requests={requests}
        siteUrl={SITE_URL}
        onIssue={setIssueRequest}
        onCancel={handleCancelRequest}
        showToast={showToast}
        busy={isPending}
      />

      <div className="filterBar">
        {["all", "checked_out", "returned", "overdue"].map((s) => (
          <a
            key={s}
            href={`/admin/rentals?status=${s}`}
            className={`filterBtn ${currentStatus === s ? "active" : ""}`}
          >
            {s === "checked_out" ? "Checked Out" : s.charAt(0).toUpperCase() + s.slice(1)}
          </a>
        ))}
      </div>

      {rentals.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Asset #</th>
                <th>Customer</th>
                <th>Checked Out</th>
                <th>Expected Return</th>
                <th>Returned</th>
                <th>Charge</th>
                <th>Consent</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rentals.map((r) => {
                const equip = r.equipment as Record<string, unknown> | undefined;
                const cust = r.customers as Record<string, unknown> | undefined;
                const expired = isExpired(r.signing_token_expires_at);
                // Walk-in baskets (085) carry ONE request-level waiver that the guest
                // already signed — the per-unit QR/share links do not apply to them.
                const isWalkinBasket = Boolean(r.rental_request_id);
                const canShareLink =
                  !isWalkinBasket && r.status === "checked_out" && !expired && Boolean(r.signing_token);
                const isOverdue = r.status === "checked_out" && r.expected_return_at && new Date(r.expected_return_at as string) < new Date();
                const rentalCurrency = validCurrency(r.currency);
                const chargeTotal = (Number(r.rental_charge_cents) || 0) + (Number(r.additional_charges_cents) || 0);
                const rentalPayments = (r.payments as { amount_cents?: number; converted_amount_cents?: number; status?: string }[]) || [];
                const paidCents = rentalPayments
                  .filter((p) => String(p.status) === "completed")
                  .reduce((s, p) => s + Math.round(Number(p.converted_amount_cents ?? p.amount_cents ?? 0) || 0), 0);
                const balance = Math.max(chargeTotal - paidCents, 0);
                const paymentStatus = String(r.payment_status || (chargeTotal > 0 ? "unpaid" : "—"));
                const consent = toConsent(r);
                const consentSigned = consent?.status === "signed";
                const consentMinor = Boolean(consent?.is_minor);
                return (
                  <tr key={r.id as string}>
                    <td><strong>{(equip?.name as string) || "—"}</strong></td>
                    <td className="mono">{(equip?.asset_number as string) || "—"}</td>
                    <td>{(cust?.full_name as string) || "—"}</td>
                    <td>{fmtDateTime(r.checked_out_at as string)}</td>
                    <td>{fmtDateTime(r.expected_return_at as string)}</td>
                    <td>{fmtDateTime(r.returned_at as string)}</td>
                    <td>{formatMoney(chargeTotal, rentalCurrency)}</td>
                    <td>
                      {consent ? (
                        <span
                          className={`badge ${consentSigned ? "badge-signed" : "badge-pending"}`}
                          title={
                            consentSigned
                              ? `Signed ${fmtDateTime(consent.signed_at as string)}${consentMinor ? " · minor (guardian)" : ""}`
                              : consent?.guest_name
                                ? `Pending signature for ${consent.guest_name}`
                                : "Pending signature"
                          }
                        >
                          {consentSigned ? "Signed" : "Pending"}
                          {consentMinor && <span style={{ opacity: 0.75 }}> · 18−</span>}
                        </span>
                      ) : (
                        <span className="badge">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${paymentStatus}`}>{paymentStatus}</span>
                      {chargeTotal > 0 && (
                        <span style={{ marginLeft: 6, fontSize: "0.75rem", color: "#647993" }}>
                          {formatMoney(paidCents, rentalCurrency)} / {formatMoney(chargeTotal, rentalCurrency)}
                          {balance > 0 && (
                            <span style={{ color: "#c0392b" }}> ({formatMoney(balance, rentalCurrency)} left)</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${r.status}`}>
                        {(r.status as string).replace("_", " ")}
                        {isOverdue ? " (overdue)" : ""}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="inlineActions" style={{ justifyContent: "flex-end", gap: 4 }}>
                        {canShareLink && (
                          <>
                            <button
                              className="actionBtn"
                              onClick={() => setQrRental(r)}
                              title="Show consent QR code"
                            >
                              ▦
                            </button>
                            <button
                              className="actionBtn"
                              onClick={() => copyLink(r.signing_token as string)}
                              title="Copy rental agreement link"
                            >
                              🔗
                            </button>
                            <button
                              className="actionBtn"
                              onClick={() => shareWhatsApp(r.signing_token as string, (cust?.full_name as string) || "Guest")}
                              title="Share via WhatsApp"
                            >
                              💬
                            </button>
                          </>
                        )}
                        {r.status === "checked_out" && (
                          <button
                            className="actionBtn actionBtn-confirmed"
                            onClick={() => setReturnRental(r)}
                            disabled={isPending}
                            title="Return equipment"
                          >
                            ↩
                          </button>
                        )}
                        {balance > 0 && (
                          <button
                            className="actionBtn actionBtn-confirmed"
                            onClick={() => setPayRental(r)}
                            disabled={isPending}
                            title="Collect rental payment"
                          >
                            $
                          </button>
                        )}
                        <button
                          className="actionBtn"
                          onClick={() => window.open(`/api/admin/invoices/rental/${String(r.id)}/pdf`, "_blank")}
                          title="Rental receipt PDF"
                        >
                          ¶
                        </button>
                        <SendInvoiceButton
                          kind="rental"
                          id={String(r.id)}
                          email={(cust?.email as string | undefined) || null}
                          onResult={setToast}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <p>No rentals found{currentStatus !== "all" ? ` with status "${currentStatus}"` : ""}.</p>
        </div>
      )}

      <RentalCheckoutForm open={checkoutOpen} onClose={() => setCheckoutOpen(false)} onSaved={refresh} />
      {returnRental && (
        <RentalReturnForm
          open={Boolean(returnRental)}
          onClose={() => setReturnRental(null)}
          rental={returnRental}
          onSaved={refresh}
        />
      )}
      {payRental && (
        <RentalPaymentModal
          rental={payRental}
          onClose={() => setPayRental(null)}
          onSaved={refresh}
        />
      )}
      {qrRental && (
        <RentalQRModal
          siteUrl={SITE_URL}
          token={String(qrRental.signing_token)}
          equipmentName={String((qrRental.equipment as Record<string, unknown> | undefined)?.name || "Equipment")}
          customerName={String((qrRental.customers as Record<string, unknown> | undefined)?.full_name || "Guest")}
          consentSigned={toConsent(qrRental)?.status === "signed"}
          onClose={() => setQrRental(null)}
          showToast={showToast}
        />
      )}
      {walkinQrOpen && (
        <RentalWalkinQRModal
          siteUrl={SITE_URL}
          onClose={() => setWalkinQrOpen(false)}
          showToast={showToast}
        />
      )}
      {issueRequest && (
        <IssueRentalRequestModal
          request={issueRequest}
          onClose={() => setIssueRequest(null)}
          onIssued={refresh}
          showToast={showToast}
        />
      )}
    </>
  );
}
