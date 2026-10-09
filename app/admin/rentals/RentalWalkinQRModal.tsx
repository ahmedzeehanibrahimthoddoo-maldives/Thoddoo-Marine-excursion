"use client";

import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { buildStaffWhatsAppLink } from "@/lib/whatsapp";

interface RentalWalkinQRModalProps {
  siteUrl: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

/** QR for the guest-facing walk-in rental page: scan → details → gear → sign. */
export default function RentalWalkinQRModal({ siteUrl, onClose, showToast }: RentalWalkinQRModalProps) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const makeQr = useCallback(async () => {
    const url = `${siteUrl}/walkin/rental`;
    try {
      const img = await QRCode.toDataURL(url, {
        width: 520,
        margin: 2,
        color: { dark: "#0b2f5c", light: "#ffffff" },
      });
      setQrImage(img);
      setQrUrl(url);
    } catch {
      showToast("error", "Failed to generate QR code.");
    }
  }, [siteUrl, showToast]);

  useEffect(() => {
    makeQr();
  }, [makeQr]);

  function handleSendWhatsApp() {
    if (!qrUrl) return;
    const msg = [
      "Thoddoo Marine — Equipment Rental",
      "",
      "Scan the QR code or open the link to pick your gear and sign the waiver:",
      qrUrl,
    ].join("\n");
    const link = buildStaffWhatsAppLink("", msg);
    if (link) window.open(link, "_blank");
    else showToast("error", "No guest number provided. Use Copy link instead.");
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Walk-in Rental QR</h3>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <p style={styles.hintTop}>
            Hand this to the guest (or show it on screen). They choose their gear and sign the liability
            waiver on their own phone — the request then appears in <strong>Walk-in requests</strong> below,
            ready to issue.
          </p>

          {qrImage && qrUrl ? (
            <div style={styles.qrSection}>
              <p style={styles.qrLabel}>Scan to rent equipment</p>
              <img src={qrImage} alt="Walk-in rental QR code" style={styles.qrImage} />
              <code style={styles.url}>{qrUrl}</code>
              <div style={styles.qrActions}>
                <button style={styles.smallBtn} onClick={handleSendWhatsApp}>
                  Send via WhatsApp
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    if (!qrUrl) return;
                    try {
                      await navigator.clipboard.writeText(qrUrl);
                      showToast("success", "Walk-in rental link copied to clipboard.");
                    } catch {
                      showToast("error", "Failed to copy link.");
                    }
                  }}
                >
                  Copy link
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={() => {
                    if (!qrImage) return;
                    const a = document.createElement("a");
                    a.href = qrImage;
                    a.download = "walkin-rental.png";
                    a.click();
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          ) : (
            <p style={styles.hint}>Generating QR code…</p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1050,
    padding: "1rem",
  },
  modal: {
    background: "#fff",
    borderRadius: 18,
    width: "100%",
    maxWidth: 460,
    maxHeight: "90vh",
    overflow: "auto",
    position: "relative" as const,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1.2rem 1.5rem 0.8rem",
    borderBottom: "1px solid #e8eef4",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 800,
    color: "var(--navy)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: "1.5rem",
    cursor: "pointer",
    color: "#9ba8b5",
    lineHeight: 1,
    padding: "0 0.3rem",
  },
  body: {
    padding: "1.2rem 1.5rem 1.5rem",
  },
  hintTop: {
    fontSize: "0.82rem",
    color: "#6b7c8d",
    lineHeight: 1.55,
    margin: "0 0 1rem",
  },
  hint: {
    fontSize: "0.82rem",
    color: "#6b7c8d",
    textAlign: "center" as const,
    margin: "1rem 0 0",
  },
  qrSection: {
    textAlign: "center" as const,
    padding: "0.4rem 0 0",
  },
  qrLabel: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "var(--navy)",
    margin: "0 0 0.8rem",
  },
  qrImage: {
    maxWidth: 300,
    width: "100%",
    borderRadius: 12,
    border: "2px solid #e8eef4",
  },
  url: {
    display: "block",
    wordBreak: "break-all" as const,
    background: "#f5f8fb",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: "0.75rem",
    color: "#475569",
    marginTop: "0.8rem",
  },
  qrActions: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "center",
    marginTop: "0.8rem",
    flexWrap: "wrap" as const,
  },
  smallBtn: {
    background: "#f0f7ff",
    color: "var(--blue)",
    border: "1.5px solid #c8ddf0",
    borderRadius: 8,
    padding: "0.4rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};
