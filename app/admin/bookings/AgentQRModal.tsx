"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  createAgentBookingLink,
  getActivitiesWithPricingForAgentQr,
  getAgentsForBookingQr,
  getAgentBookingLinks,
  revokeAgentBookingLink,
} from "@/lib/supabase/actions";
import { buildStaffWhatsAppLink } from "@/lib/whatsapp";
import { formatUsdOnly } from "@/lib/money";

interface AgentQRModalProps {
  siteUrl: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

interface PricingOption {
  label: string;
  priceCents: number;
  pricingUnit: string;
}

interface AgentActivity {
  id: string;
  label: string;
  sub: string;
  currency: string;
  basePriceCents: number;
  options: PricingOption[];
}

interface AgentOption {
  id: string;
  name: string;
  role: string;
}

interface IssuedLink {
  id: string;
  token: string;
  agent_name: string;
  activity_ids: string[] | null;
  expires_at: string;
  uses_count: number | null;
  active: boolean | null;
  created_at: string;
}

const MAX_TRIPS = 8;
const EXPIRY_CHOICES = [1, 3, 7, 14, 30];

export default function AgentQRModal({ siteUrl, onClose, showToast }: AgentQRModalProps) {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [links, setLinks] = useState<IssuedLink[]>([]);

  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [quotedOptions, setQuotedOptions] = useState<Record<string, string>>({});
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    try {
      const rows = await getAgentBookingLinks(10);
      setLinks(rows as unknown as IssuedLink[]);
    } catch {
      // The list is a convenience; a failure here must not block issuing.
    }
  }, []);

  useEffect(() => {
    Promise.all([getAgentsForBookingQr(), getActivitiesWithPricingForAgentQr()])
      .then(([staff, acts]) => {
        setAgents(staff);
        setActivities(acts);
      })
      .catch(() => showToast("error", "Failed to load staff and activities."));
    loadLinks();
  }, [showToast, loadLinks]);

  // Picking a staff member fills the name, but it stays editable — reception often
  // sells under the name on the badge.
  function chooseAgent(id: string) {
    setAgentId(id);
    const found = agents.find((a) => a.id === id);
    if (found) setAgentName(found.name);
  }

  function toggleTrip(id: string) {
    setQrImage(null);
    setQrUrl(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TRIPS) {
        showToast("error", `You can include up to ${MAX_TRIPS} trips in one link.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  async function handleGenerate() {
    if (busy) return;
    if (agentName.trim().length < 2) {
      showToast("error", "Choose the agent or type their name.");
      return;
    }
    setBusy(true);
    try {
      // Only trips with a deliberate option are sent — an unticked option means
      // "use the activity's base price" server-side.
      const options: Record<string, string> = {};
      for (const [activityId, label] of Object.entries(quotedOptions)) {
        if (label) options[activityId] = label;
      }
      const { token } = await createAgentBookingLink({
        agentId: agentId || null,
        agentName: agentName.trim(),
        activityIds: selected,
        quotedOptions: options,
        expiresInDays,
      });
      const url = `${siteUrl}/agent/${token}`;
      const img = await QRCode.toDataURL(url, {
        width: 520,
        margin: 2,
        color: { dark: "#0b2f5c", light: "#ffffff" },
      });
      setQrUrl(url);
      setQrImage(img);
      showToast("success", "Agent booking QR created.");
      await loadLinks();
      router.refresh();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to create the QR code.");
    } finally {
      setBusy(false);
    }
  }

  function handleSendWhatsApp() {
    if (!qrUrl) return;
    const trips = selected
      .map((id) => activities.find((a) => a.id === id)?.label)
      .filter(Boolean)
      .join(", ");
    const msg = [
      "Thoddoo Marine — your trip is reserved",
      "",
      `${agentName} has reserved ${trips || "your trip"} for you.`,
      "Scan the QR code (or open this link) to add the date, your guests and sign the waiver:",
      qrUrl,
    ].join("\n");
    // No number on this modal — staff send it from their own chat, so this falls
    // back to telling them to use Copy link.
    const link = buildStaffWhatsAppLink("", msg);
    if (link) window.open(link, "_blank");
    else showToast("error", "Use Copy link to share this booking link.");
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Agent Booking QR</h3>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <p style={styles.intro}>
            Hand the guest this QR to confirm a trip you have already quoted. They pick
            the date, add every participant and sign the waiver — and the rate is never
            shown to them, only recorded on the booking for your ledger.
          </p>

          <label style={styles.fieldLabel}>
            Sold by
          </label>
          <select
            value={agentId}
            onChange={(e) => chooseAgent(e.target.value)}
            style={styles.select}
          >
            <option value="">— Choose a staff member —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.role.replace(/_/g, " ")})
              </option>
            ))}
          </select>
          <label style={styles.fieldLabel}>
            Agent name on the booking <em>editable</em>
          </label>
          <input
            type="text"
            value={agentName}
            placeholder="e.g. Aminath Rasheed"
            onChange={(e) => setAgentName(e.target.value)}
            style={styles.input}
          />

          <label style={styles.fieldLabel}>
            Trips quoted — tick one or more (optional, max {MAX_TRIPS})
          </label>
          <div style={styles.list}>
            {activities.map((a) => {
              const checked = selected.includes(a.id);
              return (
                <label key={a.id} style={styles.row}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTrip(a.id)}
                    style={styles.check}
                  />
                  <span style={styles.rowLabel}>
                    {a.label} {a.sub ? <span style={styles.sub}>({a.sub})</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
          {selected.length === 0 && (
            <p style={styles.hint}>
              No trip ticked = the guest can book any active trip. Tick the trips you
              quoted so the link is scoped to just those.
            </p>
          )}

          {selected.length > 0 && (
            <>
              <label style={styles.fieldLabel}>
                Quoted option per trip <em>staff only</em>
              </label>
              {selected.map((id) => {
                const act = activities.find((a) => a.id === id);
                if (!act) return null;
                return (
                  <div key={id} style={styles.optionRow}>
                    <span style={styles.optionLabel}>{act.label}</span>
                    <select
                      value={quotedOptions[id] || ""}
                      onChange={(e) =>
                        setQuotedOptions((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      style={styles.select}
                    >
                      <option value="">
                        Base price — {formatUsdOnly(act.basePriceCents, act.currency)}
                      </option>
                      {act.options.map((o) => (
                        <option key={o.label} value={o.label}>
                          {o.label} — {formatUsdOnly(o.priceCents, act.currency)}
                          {o.pricingUnit === "per_person" ? " per person" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <p style={styles.hint}>
                <strong>Tip:</strong> the option you pick here is stored on the link and
                priced server-side when the guest books, so the ledger total matches what
                you quoted. Leave it on base price if that is what you quoted.
              </p>
            </>
          )}

          <label style={styles.fieldLabel}>Link valid for</label>
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(parseInt(e.target.value, 10))}
            style={styles.select}
          >
            {EXPIRY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} day{d !== 1 ? "s" : ""}
              </option>
            ))}
          </select>

          <button
            style={styles.generateBtn}
            onClick={handleGenerate}
            disabled={busy || agentName.trim().length < 2}
          >
            {busy ? "Creating…" : "Create agent QR"}
          </button>

          {qrImage && qrUrl && (
            <div style={styles.qrSection}>
              <p style={styles.qrLabel}>Send this to {agentName}&apos;s guest</p>
              <img src={qrImage} alt="Agent booking QR code" style={styles.qrImage} />
              <code style={styles.url}>{qrUrl}</code>
              <div style={styles.qrActions}>
                <button style={styles.smallBtn} onClick={handleSendWhatsApp}>
                  Send via WhatsApp
                </button>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(qrUrl);
                      showToast("success", "Booking link copied to clipboard.");
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
                    a.download = `agent-${agentName.trim().replace(/\s+/g, "-").toLowerCase()}.png`;
                    a.click();
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          )}

          <div style={styles.recent}>
            <span style={styles.recentTitle}>Recently issued</span>
            {links.length === 0 ? (
              <p style={styles.hint}>No agent links issued yet.</p>
            ) : (
              links.map((l) => {
                const expired = new Date(l.expires_at).getTime() <= Date.now();
                const live = !!l.active && !expired;
                return (
                  <div key={l.id} style={styles.recentRow}>
                    <span style={styles.recentName}>
                      {l.agent_name}
                      <em>
                        {l.uses_count || 0} booking{l.uses_count === 1 ? "" : "s"} ·{" "}
                        {live ? "active" : expired ? "expired" : "closed"}
                      </em>
                    </span>
                    {l.active && (
                      <button
                        style={styles.revokeBtn}
                        onClick={async () => {
                          try {
                            await revokeAgentBookingLink(l.id);
                            showToast("success", "Agent booking link closed.");
                            await loadLinks();
                            router.refresh();
                          } catch (e) {
                            showToast(
                              "error",
                              e instanceof Error ? e.message : "Failed to close the link."
                            );
                          }
                        }}
                      >
                        Close
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
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
    maxWidth: 520,
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
  intro: {
    fontSize: "0.84rem",
    color: "#5c6f80",
    lineHeight: 1.55,
    margin: "0 0 1rem",
  },
  fieldLabel: {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 700,
    color: "var(--ink)",
    margin: "0.9rem 0 0.4rem",
  },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.7rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    color: "var(--ink)",
  },
  select: {
    width: "100%",
    boxSizing: "border-box" as const,
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.7rem",
    fontSize: "0.88rem",
    fontFamily: "inherit",
    color: "var(--ink)",
    background: "#fff",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.2rem",
    maxHeight: 220,
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
  optionRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginBottom: "0.4rem",
  },
  optionLabel: {
    flex: "0 0 40%",
    fontSize: "0.82rem",
    color: "var(--ink)",
  },
  hint: {
    fontSize: "0.82rem",
    color: "#6b7c8d",
    lineHeight: 1.5,
    margin: "0.5rem 0 0",
  },
  generateBtn: {
    marginTop: "1.2rem",
    width: "100%",
    background: "linear-gradient(135deg, #0a7fb0, #0a5fb0)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "0.7rem 1rem",
    fontSize: "0.9rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
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
  recent: {
    marginTop: "1.4rem",
    paddingTop: "0.9rem",
    borderTop: "1px solid #e8eef4",
  },
  recentTitle: {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 800,
    color: "var(--navy)",
    marginBottom: "0.5rem",
  },
  recentRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    padding: "0.4rem 0.2rem",
    borderBottom: "1px solid #f1f5f9",
  },
  recentName: {
    fontSize: "0.85rem",
    color: "var(--ink)",
    display: "flex",
    flexDirection: "column" as const,
  },
  revokeBtn: {
    background: "#fff",
    color: "#c0392b",
    border: "1.5px solid #f0c4c0",
    borderRadius: 7,
    padding: "0.25rem 0.7rem",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};