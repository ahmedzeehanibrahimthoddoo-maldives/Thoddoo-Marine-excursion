"use client";

import { fmtDateTime } from "@/lib/format";
import type { RentalRequestRow } from "@/lib/supabase/actions";

interface RentalRequestsPanelProps {
  requests: RentalRequestRow[];
  siteUrl: string;
  onIssue: (request: RentalRequestRow) => void;
  onCancel: (request: RentalRequestRow) => void;
  showToast: (type: "success" | "error", message: string) => void;
  busy?: boolean;
}

const consentOf = (r: RentalRequestRow) => {
  const raw = r.consent_forms;
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) || null;
};

/**
 * Guest-built baskets waiting at the counter: signed by the guest on their own
 * phone, issued (units assigned + payment taken) by staff from here.
 */
export default function RentalRequestsPanel({
  requests,
  siteUrl,
  onIssue,
  onCancel,
  showToast,
  busy,
}: RentalRequestsPanelProps) {
  if (requests.length === 0) return null;

  const copySignLink = (token: string) => {
    const url = `${siteUrl}/consent/${token}`;
    navigator.clipboard.writeText(url).then(
      () => showToast("success", "Waiver link copied — send it to the guest."),
      () => showToast("error", "Failed to copy link.")
    );
  };

  return (
    <div style={styles.panel}>
      <div style={styles.head}>
        <h2 style={styles.title}>Walk-in requests</h2>
        <span style={styles.sub}>
          {requests.length} waiting · guests picked these themselves by scanning the walk-in QR
        </span>
      </div>

      {requests.map((r) => {
        const consent = consentOf(r);
        const signed = consent?.status === "signed";
        const token = consent?.signing_token;
        const expired =
          consent?.signing_token_expires_at && new Date(consent.signing_token_expires_at) < new Date();
        const items = (r.items || [])
          .map((it) => `${Math.round(Number(it.qty) || 0)} × ${it.name}`)
          .join(", ");

        return (
          <div key={r.id} style={styles.row}>
            <div style={styles.info}>
              <div style={styles.line1}>
                <strong>{r.guest_name}</strong>
                <span style={styles.meta}>
                  {fmtDateTime(r.created_at)}
                  {r.phone ? ` · ${r.phone}` : ""}
                  {r.email ? ` · ${r.email}` : ""}
                  {r.hotel ? ` · ${r.hotel}${r.room_number ? ` ${r.room_number}` : ""}` : ""}
                </span>
              </div>
              <div style={styles.items}>{items || "No items"}</div>
              {r.notes ? <div style={styles.notes}>“{r.notes}”</div> : null}
            </div>

            <div style={styles.right}>
              <span
                className={`badge ${signed ? "badge-signed" : "badge-pending"}`}
                title={
                  signed && consent?.signed_at
                    ? `Signed ${fmtDateTime(consent.signed_at)}`
                    : "The guest has not signed the waiver yet"
                }
              >
                {signed ? "Waiver signed" : "Awaiting signature"}
                {consent?.is_minor ? " · 18−" : ""}
              </span>
              {!signed && token && !expired && (
                <button className="actionBtn" title="Copy waiver link" onClick={() => copySignLink(token)}>
                  🔗
                </button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onIssue(r)}
                disabled={busy}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                Issue
              </button>
              <button
                className="actionBtn"
                title="Cancel this request"
                onClick={() => onCancel(r)}
                disabled={busy}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  panel: {
    background: "#fff",
    border: "1.5px solid #e2e9f0",
    borderRadius: 14,
    padding: "14px 16px",
    marginBottom: 16,
  },
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap" as const,
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 800,
    color: "var(--navy)",
  },
  sub: {
    fontSize: "0.78rem",
    color: "#647993",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 0",
    borderTop: "1px solid #eef3f8",
    flexWrap: "wrap" as const,
  },
  info: {
    flex: "1 1 320px",
    minWidth: 240,
  },
  line1: {
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    flexWrap: "wrap" as const,
    fontSize: 14,
    color: "var(--ink)",
  },
  meta: {
    fontSize: "0.76rem",
    color: "#647993",
  },
  items: {
    fontSize: "0.82rem",
    color: "#475569",
    marginTop: 3,
    fontWeight: 600,
  },
  notes: {
    fontSize: "0.78rem",
    color: "#647993",
    marginTop: 3,
    fontStyle: "italic" as const,
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  },
};
