"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { getActivitiesForSelect } from "@/lib/supabase/actions";
import { buildStaffWhatsAppLink } from "@/lib/whatsapp";

interface WalkinQRModalProps {
  siteUrl: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

const MAX_SELECTED = 8;

export default function WalkinQRModal({ siteUrl, onClose, showToast }: WalkinQRModalProps) {
  const [activities, setActivities] = useState<
    Array<{ id: string; slug: string; label: string; sub: string }>
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getActivitiesForSelect()
      .then((list) => setActivities(list))
      .catch(() => showToast("error", "Failed to load activities."));
  }, [showToast]);

  const chosen = selected
    .map((id) => activities.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .filter((a) => Boolean(a.slug) && a.slug.length > 0);

  const makeQr = useCallback(
    async (slugs: string[]) => {
      const [first, ...rest] = slugs;
      if (!first) return;
      const url =
        rest.length > 0
          ? `${siteUrl}/walkin/${first}?activities=${encodeURIComponent(rest.join(","))}`
          : `${siteUrl}/walkin/${first}`;
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
    },
    [siteUrl, showToast]
  );

  function toggle(id: string) {
    let next: string[];
    if (selected.includes(id)) {
      next = selected.filter((x) => x !== id);
    } else {
      if (selected.length >= MAX_SELECTED) {
        showToast("error", `You can combine up to ${MAX_SELECTED} trips in one link.`);
        return;
      }
      next = [...selected, id];
    }
    setSelected(next);
    const slugs = next
      .map((x) => activities.find((a) => a.id === x))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .filter((a) => Boolean(a.slug) && a.slug.length > 0)
      .map((a) => a.slug);
    makeQr(slugs);
  }

  function handleSendWhatsApp() {
    if (!qrUrl || chosen.length === 0) return;
    const msg = [
      "Thoddoo Marine — Walk-in Booking",
      "",
      ...(chosen.length > 1
        ? [`Book ${chosen.length} activities in one go:`]
        : ["Scan the QR code or open the link to book quickly:"]),
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
          <h3 style={styles.title}>Walk-in Booking QR</h3>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <label style={styles.fieldLabel}>
            Select Trips — tick one or more
          </label>
          <div style={styles.list}>
            {activities.map((a) => {
              const checked = selected.includes(a.id);
              return (
                <label key={a.id} style={styles.row}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(a.id)}
                    style={styles.check}
                  />
                  <span style={styles.rowLabel}>
                    {a.label} {a.sub ? <span style={styles.sub}>({a.sub})</span> : null}
                  </span>
                </label>
              );
            })}
          </div>

          <p style={styles.hint}>
            <strong>Tip:</strong> tick several trips to make one link that combines them —
            the guest books them all in a single request. A trip can be booked alone too.
          </p>

          {qrImage && qrUrl && chosen.length > 0 && (
            <div style={styles.qrSection}>
              <p style={styles.qrLabel}>
                {chosen.length === 1
                  ? `${chosen[0].label} — scan to book`
                  : `${chosen.length} trips — scan to book all`}
              </p>
              <img src={qrImage} alt="Walk-in booking QR code" style={styles.qrImage} />
              <code style={styles.url}>{qrUrl}</code>
              <div style={styles.qrActions}>
                <button
                  style={styles.smallBtn}
                  onClick={handleSendWhatsApp}
                  disabled={pending}
                >
                  Send via WhatsApp
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    if (!qrUrl) return;
                    try {
                      await navigator.clipboard.writeText(qrUrl);
                      showToast("success", "Walk-in link copied to clipboard.");
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
                    a.download = `walkin-${chosen.length === 1 ? chosen[0].slug : chosen.length + "-trips"}.png`;
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
  fieldLabel: {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 700,
    color: "var(--ink)",
    marginBottom: "0.4rem",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.2rem",
    maxHeight: 260,
    overflow: "auto",
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.35rem",
    background: "#f9fbfd",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    padding: "0.45rem 0.55rem",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: "0.9rem",
    color: "var(--ink)",
    background: "#fff",
  },
  check: {
    accentColor: "#0a5fb0",
    width: 17,
    height: 17,
    cursor: "pointer",
  },
  rowLabel: {
    flex: 1,
  },
  sub: {
    color: "#8a9aa8",
    fontSize: "0.78rem",
  },
  hint: {
    fontSize: "0.82rem",
    color: "#6b7c8d",
    lineHeight: 1.5,
    margin: "0.9rem 0 0",
  },
  qrSection: {
    textAlign: "center" as const,
    padding: "1.2rem 0 0",
    borderTop: "1px solid #e8eef4",
    marginTop: "1.1rem",
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