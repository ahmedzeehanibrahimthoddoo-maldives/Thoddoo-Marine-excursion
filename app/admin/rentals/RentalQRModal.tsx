"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

interface RentalQRModalProps {
  siteUrl: string;
  token: string;
  equipmentName: string;
  customerName: string;
  consentSigned: boolean;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

export default function RentalQRModal({
  siteUrl,
  token,
  equipmentName,
  customerName,
  consentSigned,
  onClose,
  showToast,
}: RentalQRModalProps) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const url = `${siteUrl}/rental/${token}`;

  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 520,
      margin: 2,
      color: { dark: "#0b2f5c", light: "#ffffff" },
    })
      .then(setQrImage)
      .catch(() => showToast("error", "Failed to generate QR code."));
  }, [url, showToast]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("success", "Rental consent link copied to clipboard.");
    } catch {
      showToast("error", "Failed to copy link.");
    }
  }, [url, showToast]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Rental Consent QR</h3>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <p style={styles.meta}>
            <strong>{equipmentName}</strong> &middot; {customerName || "Guest"}
          </p>

          <div
            style={{
              ...styles.statusBanner,
              ...(consentSigned ? styles.statusSigned : styles.statusPending),
            }}
          >
            {consentSigned
              ? "✓ Consent & liability signed by the guest."
              : "⚠ Consent pending — do not hand over equipment until signed."}
          </div>

          {qrImage && (
            <div style={styles.qrSection}>
              <p style={styles.qrLabel}>Scan QR to fill in details &amp; sign</p>
              <img src={qrImage} alt="Rental consent QR code" style={styles.qrImage} />
              <code style={styles.url}>{url}</code>
              <div style={styles.qrActions}>
                <button style={styles.smallBtn} onClick={copyLink}>
                  Copy link
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = qrImage;
                    a.download = `rental-consent-${token.slice(0, 8)}.png`;
                    a.click();
                  }}
                >
                  Download
                </button>
              </div>
            </div>
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
    zIndex: 1060,
    padding: "1rem",
  },
  modal: {
    background: "#fff",
    borderRadius: 18,
    width: "100%",
    maxWidth: 440,
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
    textAlign: "center" as const,
  },
  meta: {
    fontSize: "0.85rem",
    color: "var(--ink)",
    margin: "0 0 0.8rem",
  },
  statusBanner: {
    fontSize: "0.8rem",
    fontWeight: 700,
    borderRadius: 10,
    padding: "0.6rem 0.9rem",
    marginBottom: "0.6rem",
  },
  statusSigned: {
    background: "#d4edda",
    color: "#155724",
  },
  statusPending: {
    background: "#fff3cd",
    color: "#856404",
  },
  qrSection: {
    textAlign: "center" as const,
    paddingTop: "0.6rem",
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