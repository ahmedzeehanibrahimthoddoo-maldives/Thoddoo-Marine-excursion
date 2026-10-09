"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import AdminModal, { Toast } from "@/app/admin/components/AdminModal";
import { getConsentForBooking, createConsentForm } from "@/lib/supabase/actions";
import { buildStaffWhatsAppLink, buildConsentInviteMessage } from "@/lib/whatsapp";

interface ConsentOfferModalProps {
  bookingId: string;
  bookingRef: string;
  customerId: string;
  activityId: string;
  guestName: string;
  phone?: string | null;
  activityName?: string;
  bookingDate?: string | null;
  onClose: () => void;
}

interface ConsentInfo {
  id: string;
  status: string;
  activity_name?: string | null;
  guest_name?: string | null;
  booking_ref?: string | null;
  signing_token?: string | null;
  phone?: string | null;
  signed_at?: string | null;
}

export default function ConsentOfferModal({
  bookingId,
  bookingRef,
  customerId,
  activityId,
  guestName,
  phone,
  activityName,
  bookingDate,
  onClose,
}: ConsentOfferModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";

  const loadConsent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getConsentForBooking(bookingId);
      setConsent((data as ConsentInfo | null) ?? null);
      if (data?.signing_token) {
        const url = `${siteUrl}/consent/${data.signing_token}`;
        setQrUrl(url);
        const img = await QRCode.toDataURL(url, {
          width: 420,
          margin: 2,
          color: { dark: "#0b2f5c", light: "#ffffff" },
        });
        setQrImage(img);
      } else {
        setQrUrl(null);
        setQrImage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load consent form");
    } finally {
      setLoading(false);
    }
  }, [bookingId, siteUrl]);

  useEffect(() => {
    loadConsent();
  }, [loadConsent]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  function copyUrl() {
    if (!qrUrl) return;
    navigator.clipboard.writeText(qrUrl).then(
      () => showToast("success", "Consent link copied to clipboard."),
      () => showToast("error", "Failed to copy link."),
    );
  }

  function openWhatsApp() {
    if (!qrUrl || !consent) return;
    const invite = buildConsentInviteMessage(
      consent.guest_name || guestName,
      consent.activity_name || activityName || "Activity",
      (bookingDate || "").toString(),
      qrUrl,
    );
    const link = buildStaffWhatsAppLink(consent.phone || phone || "", invite);
    if (link) {
      window.open(link, "_blank");
    } else {
      showToast("error", "No valid phone number on file to open WhatsApp.");
    }
  }

  function createNow() {
    startTransition(async () => {
      try {
        await createConsentForm({
          booking_id: bookingId,
          customer_id: customerId,
          activity_id: activityId,
          guest_name: guestName,
          guest_phone: phone || undefined,
        });
        showToast("success", "Consent form created.");
        await loadConsent();
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Failed to create consent form");
      }
    });
  }

  const signed = consent?.status === "signed";
  const empty = !consent;

  return (
    <AdminModal
      open
      onClose={onClose}
      title={`Consent & Liability — ${bookingRef}`}
      footer={
        <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>
          Close
        </button>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}

      {loading && <p className="textMuted">Loading consent form…</p>}
      {error && !loading && <div className="errorState"><p>{error}</p></div>}

      {!loading && !error && empty && (
        <div>
          <p>
            No consent form exists yet for this booking. It is created automatically the moment a
            booking is <strong>confirmed and paid</strong>. Staff can also create one now:
          </p>
          <button className="btn btn-primary" onClick={createNow} disabled={isPending}>
            {isPending ? "Creating…" : "Create consent form"}
          </button>
        </div>
      )}

      {!loading && !error && consent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={`badge ${signed ? "badge-signed" : "badge-pending"}`}>
              {signed ? "Signed" : "Pending"}
            </span>
            <span className="textMuted">
              {signed && consent.signed_at
                ? `Signed ${new Date(consent.signed_at).toLocaleString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                  })}`
                : "Awaiting guest signature"}
            </span>
          </div>

          {signed && (
            <p>
              <button
                className="actionBtn"
                title="Open signed form"
                onClick={() => window.open(`/api/admin/consents/${consent.id}/pdf`, "_blank")}
              >
                🖨 View signed PDF
              </button>{" "}
              <span className="textMuted">Guest has signed the consent &amp; liability form.</span>
            </p>
          )}

          {!signed && qrUrl && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  {qrImage && (
                    <img
                      src={qrImage}
                      alt="Consent signing QR code"
                      style={{ width: 220, height: 220, border: "1px solid #dce6ef", borderRadius: 8 }}
                    />
                  )}
                  <p className="textMuted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
                    Scan to open the signing page (Maldives law consent)
                  </p>
                </div>
                <div style={{ minWidth: 220, maxWidth: 320 }}>
                  <p className="fieldHint" style={{ marginBottom: 6 }}>
                    Consent signing link for this guest:
                  </p>
                  <code
                    style={{
                      display: "block",
                      wordBreak: "break-all",
                      background: "#f5f8fb",
                      padding: "8px 10px",
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      color: "#0b2f5c",
                    }}
                  >
                    {qrUrl}
                  </code>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button className="btn btn-primary" onClick={openWhatsApp}>
                      Send via WhatsApp
                    </button>
                    <button className="btn btn-secondary" onClick={copyUrl}>
                      Copy link
                    </button>
                  </div>
                </div>
              </div>
              <p className="fieldHint">
                WhatsApp opens pre-filled for this guest with the consent link. Guests who do not
                sign cannot be checked in on the manifest.
              </p>
            </>
          )}
        </div>
      )}
    </AdminModal>
  );
}