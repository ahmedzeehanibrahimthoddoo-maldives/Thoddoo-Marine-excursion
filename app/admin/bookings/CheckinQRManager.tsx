"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import {
  createCheckinSession,
  revokeCheckinSession,
  getCheckinSessionStatus,
  getCheckinSessionsForBooking,
  getActivitiesForSelect,
  type StoredSessionSummary,
} from "@/lib/supabase/actions";

interface CheckinQRManagerProps {
  bookingId: string;
  bookingRef: string;
  activityId: string;
  activityName: string;
  guestCount: number;
  onClose: () => void;
}

export default function CheckinQRManager({
  bookingId,
  bookingRef,
  activityId,
  activityName,
  guestCount,
  onClose,
}: CheckinQRManagerProps) {
  const [sessions, setSessions] = useState<StoredSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [showWalkinModal, setShowWalkinModal] = useState(false);
  const [pending, startTransition] = useTransition();

  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL || "https://thoddoomarineexcursion.com";

  const loadSessions = useCallback(async () => {
    try {
      const data = await getCheckinSessionsForBooking(bookingId);
      setSessions(data || []);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleCreateSession() {
    startTransition(async () => {
      try {
        const result = await createCheckinSession(bookingId, activityId);
        const { raw_token } = result;
        if (!raw_token || !/^[0-9a-f]{64}$/i.test(raw_token)) {
          showToast("error", "Server returned an invalid token. Please try again.");
          return;
        }
        const url = `${siteUrl}/checkin#token=${raw_token}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 400,
          margin: 2,
          color: { dark: "#0b2f5c", light: "#ffffff" },
        });
        setQrImage(dataUrl);
        setQrUrl(url);
        setQrSessionId(result.session_id);
        showToast("success", "Check-in QR created successfully.");
        await loadSessions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create session";
        showToast("error", msg);
      }
    });
  }

  async function handleRevoke(sessionId: string) {
    if (!confirm("Revoke this check-in link? Guests will no longer be able to scan it.")) return;
    startTransition(async () => {
      try {
        await revokeCheckinSession(sessionId);
        if (qrSessionId === sessionId) {
          setQrImage(null);
          setQrUrl(null);
          setQrSessionId(null);
        }
        showToast("success", "Session revoked.");
        await loadSessions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to revoke";
        showToast("error", msg);
      }
    });
  }

  function formatExpiry(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function sessionStatus(s: StoredSessionSummary) {
    if (s.revoked_at) return "revoked";
    if (new Date(s.expires_at) < new Date()) return "expired";
    return "active";
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {toast && (
          <div
            style={{
              ...styles.toast,
              background: toast.type === "success" ? "#d4edda" : "#f8d7da",
              color: toast.type === "success" ? "#155724" : "#842029",
            }}
          >
            {toast.message}
          </div>
        )}

        <div style={styles.header}>
          <h2 style={styles.headerTitle}>Guest Consent QR</h2>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.bookingInfo}>
            <span style={styles.bookingRef}>{bookingRef}</span>
            <span style={styles.bookingActivity}>{activityName}</span>
            <span style={styles.bookingPax}>
              {guestCount} guest{guestCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div style={styles.actions}>
            <button
              style={styles.primaryBtn}
              onClick={handleCreateSession}
              disabled={pending}
            >
              {pending ? "Creating..." : "Generate Check-in QR"}
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => setShowWalkinModal(true)}
            >
              Walk-in QR
            </button>
          </div>

          {qrImage && (
            <div style={styles.qrSection}>
              <p style={styles.qrLabel}>Scan this QR code to begin check-in</p>
              <img src={qrImage} alt="Check-in QR Code" style={styles.qrImage} />
              <p style={styles.qrHint}>
                Guest scans this with their phone camera. Each participant signs
                their own consent form individually.
              </p>
              <div style={styles.qrActions}>
                <button
                  style={styles.smallBtn}
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = qrImage;
                    a.download = `checkin-${bookingRef}.png`;
                    a.click();
                  }}
                >
                  Download
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    if (qrImage) {
                      try {
                        const res = await fetch(qrImage);
                        const blob = await res.blob();
                        await navigator.clipboard.write([
                          new ClipboardItem({ "image/png": blob }),
                        ]);
                        showToast("success", "QR copied to clipboard.");
                      } catch {
                        showToast("error", "Failed to copy. Try downloading instead.");
                      }
                    }
                  }}
                >
                  Copy QR
                </button>
                <button
                  style={{
                    ...styles.smallBtn,
                    opacity: qrUrl ? 1 : 0.5,
                    cursor: qrUrl ? "pointer" : "not-allowed",
                  }}
                  disabled={!qrUrl}
                  onClick={async () => {
                    if (qrUrl) {
                      try {
                        await navigator.clipboard.writeText(qrUrl);
                        showToast("success", "Link copied to clipboard.");
                      } catch {
                        showToast("error", "Failed to copy link.");
                      }
                    }
                  }}
                >
                  Copy Link
                </button>
              </div>
            </div>
          )}

          {sessions.length > 0 && (
            <div style={styles.historySection}>
              <h3 style={styles.historyTitle}>Session History</h3>
              {sessions.map((s) => {
                const status = sessionStatus(s);
                return (
                  <div key={s.id} style={styles.sessionRow}>
                    <div style={styles.sessionInfo}>
                      <span
                        style={{
                          ...styles.statusDot,
                          background:
                            status === "active"
                              ? "#28a745"
                              : status === "expired"
                              ? "#ffc107"
                              : "#dc3545",
                        }}
                      />
                      <span style={styles.sessionMeta}>
                        {formatExpiry(s.expires_at)}
                        {s.is_walkin && " (walk-in)"}
                      </span>
                    </div>
                    {status === "active" && (
                      <button
                        style={styles.revokeBtn}
                        onClick={() => handleRevoke(s.id)}
                        disabled={pending}
                      >
                        Revoke
                      </button>
                    )}
                    {status !== "active" && (
                      <span style={styles.statusLabel}>{status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showWalkinModal && (
            <WalkinQRModal
              siteUrl={siteUrl}
              onClose={() => setShowWalkinModal(false)}
              onCreated={async (raw_token) => {
                if (!raw_token || !/^[0-9a-f]{64}$/i.test(raw_token)) {
                  showToast("error", "Server returned an invalid token. Please try again.");
                  return;
                }
                const url = `${siteUrl}/checkin#token=${raw_token}`;
                const dataUrl = await QRCode.toDataURL(url, {
                  width: 400,
                  margin: 2,
                  color: { dark: "#0b2f5c", light: "#ffffff" },
                });
                setQrImage(dataUrl);
                setQrUrl(url);
                setShowWalkinModal(false);
                await loadSessions();
              }}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WalkinQRModal({
  siteUrl,
  onClose,
  onCreated,
  showToast,
}: {
  siteUrl: string;
  onClose: () => void;
  onCreated: (token: string) => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [activities, setActivities] = useState<Array<{ id: string; label: string; sub: string }>>([]);
  const [selectedActivity, setSelectedActivity] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getActivitiesForSelect().then(setActivities).catch(() => {});
  }, []);

  function handleCreate() {
    if (!selectedActivity) {
      showToast("error", "Please select an activity.");
      return;
    }
    startTransition(async () => {
      try {
        const { createWalkinCheckinSession } = await import("@/lib/supabase/actions");
        const result = await createWalkinCheckinSession(selectedActivity);
        const { raw_token } = result;
        if (!raw_token || !/^[0-9a-f]{64}$/i.test(raw_token)) {
          showToast("error", "Server returned an invalid token. Please try again.");
          return;
        }
        onCreated(raw_token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        showToast("error", msg);
      }
    });
  }

  return (
    <div style={styles.walkinOverlay} onClick={onClose}>
      <div style={styles.walkinModal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: "var(--navy)" }}>
          Create Walk-in QR
        </h3>
        <p style={{ fontSize: "0.85rem", color: "#6b7c8d", marginBottom: "1rem" }}>
          Guest enters their own name and phone. No customer list is shown.
        </p>
        <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--ink)" }}>
          Select Activity
        </label>
        <select
          style={styles.select}
          value={selectedActivity}
          onChange={(e) => setSelectedActivity(e.target.value)}
        >
          <option value="">Choose activity...</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} {a.sub ? `(${a.sub})` : ""}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.2rem" }}>
          <button style={styles.primaryBtn} onClick={handleCreate} disabled={pending}>
            {pending ? "Creating..." : "Generate QR"}
          </button>
          <button style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
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
    zIndex: 1000,
    padding: "1rem",
  },
  modal: {
    background: "#fff",
    borderRadius: 18,
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflow: "auto",
    position: "relative" as const,
  },
  toast: {
    position: "sticky" as const,
    top: 0,
    padding: "0.7rem 1.2rem",
    borderRadius: "18px 18px 0 0",
    fontSize: "0.85rem",
    fontWeight: 600,
    zIndex: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1.2rem 1.5rem 0.8rem",
    borderBottom: "1px solid #e8eef4",
  },
  headerTitle: {
    margin: 0,
    fontSize: "1.15rem",
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
  bookingInfo: {
    display: "flex",
    gap: "0.8rem",
    alignItems: "center",
    flexWrap: "wrap" as const,
    marginBottom: "1.2rem",
    padding: "0.8rem 1rem",
    background: "#f9fbfd",
    borderRadius: 12,
    border: "1px solid #e8eef4",
  },
  bookingRef: {
    fontWeight: 800,
    fontSize: "0.9rem",
    color: "var(--navy)",
    fontFamily: "monospace",
  },
  bookingActivity: {
    fontSize: "0.85rem",
    color: "#6b7c8d",
  },
  bookingPax: {
    fontSize: "0.8rem",
    color: "#6b7c8d",
    marginLeft: "auto",
  },
  actions: {
    display: "flex",
    gap: "0.6rem",
    marginBottom: "1.2rem",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, var(--blue), var(--cyan))",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "0.6rem 1.2rem",
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  secondaryBtn: {
    background: "#f0f7ff",
    color: "var(--blue)",
    border: "1.5px solid #c8ddf0",
    borderRadius: 10,
    padding: "0.6rem 1.2rem",
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cancelBtn: {
    background: "#f0f7ff",
    color: "var(--blue)",
    border: "1.5px solid #c8ddf0",
    borderRadius: 10,
    padding: "0.6rem 1.2rem",
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  qrSection: {
    textAlign: "center" as const,
    padding: "1.2rem 0",
    borderTop: "1px solid #e8eef4",
    marginBottom: "1rem",
  },
  qrLabel: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "var(--navy)",
    marginBottom: "0.8rem",
  },
  qrImage: {
    maxWidth: 280,
    width: "100%",
    borderRadius: 12,
    border: "2px solid #e8eef4",
  },
  qrHint: {
    fontSize: "0.78rem",
    color: "#6b7c8d",
    marginTop: "0.6rem",
    lineHeight: 1.4,
  },
  qrActions: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "center",
    marginTop: "0.8rem",
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
  historySection: {
    borderTop: "1px solid #e8eef4",
    paddingTop: "1rem",
  },
  historyTitle: {
    fontSize: "0.85rem",
    fontWeight: 800,
    color: "var(--navy)",
    margin: "0 0 0.6rem",
  },
  sessionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    borderBottom: "1px solid #f0f3f7",
  },
  sessionInfo: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  sessionMeta: {
    fontSize: "0.8rem",
    color: "#6b7c8d",
  },
  revokeBtn: {
    background: "#f8d7da",
    color: "#842029",
    border: "none",
    borderRadius: 8,
    padding: "0.3rem 0.8rem",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  statusLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#9ba8b5",
    textTransform: "uppercase" as const,
  },
  walkinOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
    padding: "1rem",
  },
  walkinModal: {
    background: "#fff",
    borderRadius: 14,
    padding: "1.5rem",
    width: "100%",
    maxWidth: 380,
  },
  select: {
    width: "100%",
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    background: "#f9fbfd",
    color: "var(--ink)",
    outline: "none",
    marginTop: "0.4rem",
  },
};
