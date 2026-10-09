"use client";

import { useState, useTransition, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import SignaturePad from "@/app/admin/components/SignaturePad";
import {
  createConsentForm,
  voidConsentForm,
  getCustomersForSelect,
  getBookingsForCustomer,
  getActivitiesForSelect,
} from "@/lib/supabase/actions";

interface ConsentPageClientProps {
  forms: Record<string, unknown>[];
  currentStatus: string;
}

interface SelectOption {
  id: string;
  label: string;
  sub?: string;
  activity_id?: string;
}

const CONSENT_BASE_URL = typeof window !== "undefined" ? window.location.origin : "";

export default function ConsentPageClient({ forms, currentStatus }: ConsentPageClientProps) {
  const [signingForm, setSigningForm] = useState<Record<string, unknown> | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [witnessName, setWitnessName] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [customersList, setCustomersList] = useState<SelectOption[]>([]);
  const [bookingsList, setBookingsList] = useState<SelectOption[]>([]);
  const [activitiesList, setActivitiesList] = useState<SelectOption[]>([]);
  const [createForm, setCreateForm] = useState({
    customer_id: "",
    booking_id: "",
    activity_id: "",
    guest_name: "",
    consent_type: "activity",
  });
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const refresh = () => {
    startTransition(() => {
      window.location.reload();
    });
  };

  const openSignModal = (form: Record<string, unknown>) => {
    setSigningForm(form);
    setSignature(null);
    setWitnessName("");
    setToast(null);
  };

  const submitSignature = () => {
    if (!signature) {
      setToast({ type: "error", message: "Please provide a signature" });
      return;
    }
    if (!signingForm) return;

    startTransition(async () => {
      try {
        const supabase = createClient();

        // Fetch current active template version for stale protection
        const { data: tplResult } = await supabase.rpc("get_active_consent_template", {
          p_consent_type: (signingForm.consent_type as string) || "activity",
        });
        const tpl = tplResult as unknown as { version?: string } | null;
        const expectedVersion = tpl?.version || undefined;

        // Look up consent ID from signing token
        const { data: consentRow, error: lookupError } = await supabase
          .from("consent_forms")
          .select("id")
          .eq("signing_token", signingForm.signing_token as string)
          .single();
        if (lookupError || !consentRow) throw new Error("Consent form not found");

        // Call staff_sign_consent RPC directly from browser — signature never passes through Server Action logs
        const { data: result, error: rpcError } = await supabase.rpc("staff_sign_consent", {
          p_consent_id: consentRow.id,
          p_swimming_ability: null,
          p_medical_conditions: null,
          p_allergies: null,
          p_medications: null,
          p_recent_injuries: null,
          p_is_pregnant: false,
          p_safety_briefing_confirmed: true,
          p_life_jacket_confirmed: true,
          p_risk_acknowledged: true,
          p_photo_consent: false,
          p_signature_data_url: signature,
          p_witness_name: witnessName.trim() || null,
          p_witness_signature_data_url: null,
          p_parent_guardian_name: null,
          p_parent_guardian_signature_data_url: null,
          p_expected_consent_version: expectedVersion || null,
        });
        if (rpcError) throw new Error(rpcError.message);
        const res = result as unknown as { error?: string; message?: string };
        if (res && typeof res === "object" && "error" in res) {
          throw new Error((res as { message?: string }).message || "Signing failed");
        }

        setToast({ type: "success", message: "Consent form signed" });
        setSignature(null);
        setWitnessName("");
        setTimeout(() => {
          setSigningForm(null);
          refresh();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Signing failed" });
      }
    });
  };

  const openCreateModal = () => {
    setCreateOpen(true);
    setCreatedToken(null);
    setCreateForm({ customer_id: "", booking_id: "", activity_id: "", guest_name: "", consent_type: "activity" });
    setBookingsList([]);
    setToast(null);
    getCustomersForSelect().then(setCustomersList).catch(() => {});
    getActivitiesForSelect().then(setActivitiesList).catch(() => {});
  };

  const handleCustomerChange = (customerId: string) => {
    setCreateForm((p) => ({ ...p, customer_id: customerId, booking_id: "", activity_id: "" }));
    if (customerId) {
      getBookingsForCustomer(customerId).then(setBookingsList).catch(() => {});
    } else {
      setBookingsList([]);
    }
  };

  const handleBookingChange = (bookingId: string) => {
    const booking = bookingsList.find((b) => b.id === bookingId);
    setCreateForm((p) => ({
      ...p,
      booking_id: bookingId,
      activity_id: booking?.activity_id || p.activity_id,
    }));
  };

  const handleCreate = () => {
    if (!createForm.customer_id) {
      setToast({ type: "error", message: "Customer is required." });
      return;
    }
    if (!createForm.guest_name.trim()) {
      setToast({ type: "error", message: "Guest name is required." });
      return;
    }
    if (!createForm.activity_id) {
      setToast({ type: "error", message: "Activity is required." });
      return;
    }
    startTransition(async () => {
      try {
        const result = await createConsentForm({
          customer_id: createForm.customer_id,
          booking_id: createForm.booking_id || undefined,
          activity_id: createForm.activity_id,
          guest_name: createForm.guest_name,
          consent_type: createForm.consent_type,
        });
        setCreatedToken((result as Record<string, unknown>).signing_token as string);
        setToast({ type: "success", message: "Consent form created. Share the link below." });
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to create consent form." });
      }
    });
  };

  const handleVoid = () => {
    if (!voidingId) return;
    if (!voidReason.trim()) {
      setToast({ type: "error", message: "Void reason is required." });
      return;
    }
    startTransition(async () => {
      try {
        await voidConsentForm(voidingId, voidReason.trim());
        setToast({ type: "success", message: "Consent form voided." });
        setTimeout(() => {
          setVoidingId(null);
          setVoidReason("");
          refresh();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to void consent." });
      }
    });
  };

  const copyLink = useCallback((token: string) => {
    const url = `${CONSENT_BASE_URL}/consent/${token}`;
    navigator.clipboard.writeText(url).then(
      () => setToast({ type: "success", message: "Consent link copied to clipboard." }),
      () => setToast({ type: "error", message: "Failed to copy link." }),
    );
  }, []);

  const shareWhatsApp = useCallback((token: string, guestName: string) => {
    const url = `${CONSENT_BASE_URL}/consent/${token}`;
    const text = `Hi ${guestName}, please complete your Thoddoo Marine consent form here:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }, []);

  const viewPdf = useCallback((consentId: string) => {
    window.open(`/api/admin/consents/${consentId}/pdf`, "_blank");
  }, []);

  const downloadPdf = useCallback((consentId: string) => {
    window.open(`/api/admin/consents/${consentId}/pdf?download=1`, "_blank");
  }, []);

  const printPdf = useCallback((consentId: string) => {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `/api/admin/consents/${consentId}/pdf`;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
    };
  }, []);

  const isExpired = (expiryDate: unknown) => {
    if (!expiryDate) return false;
    return new Date(expiryDate as string) < new Date();
  };

  return (
    <>
      <div className="adminPageHeader" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Consent Forms</h1>
        <button className="btn btn-primary" onClick={openCreateModal}>
          + Create Consent
        </button>
      </div>

      <div className="filterBar">
        {["all", "pending", "signed", "voided"].map((s) => (
          <a
            key={s}
            href={`/admin/consents?status=${s}`}
            className={`filterBtn ${currentStatus === s ? "active" : ""}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </a>
        ))}
      </div>

      {forms.length > 0 ? (
        <div className="tableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Activity</th>
                <th>Booking Ref</th>
                <th>Hotel</th>
                <th>Status</th>
                <th>Signed</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => {
                const expired = f.status !== "voided" && isExpired(f.signing_token_expires_at);
                const canShareLink = f.status === "pending" && !expired && Boolean(f.signing_token);
                return (
                  <tr key={f.id as string}>
                    <td><strong>{f.guest_name as string}</strong></td>
                    <td>{(f.activity_name as string) || ((f.activities as Record<string, unknown>)?.name as string) || "—"}</td>
                    <td className="mono">{(f.booking_ref as string) || "—"}</td>
                    <td>{(f.hotel as string) || "—"}</td>
                    <td>
                      <span className={`badge badge-${f.status}`}>
                        {f.status as string}
                        {expired ? " (expired)" : ""}
                      </span>
                    </td>
                    <td>{fmtDate(f.signed_at as string)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="inlineActions" style={{ justifyContent: "flex-end", flexWrap: "wrap", gap: 4 }}>
                        {f.status === "signed" && (
                          <>
                            <button
                              className="actionBtn"
                              onClick={() => viewPdf(f.id as string)}
                              title="View consent PDF"
                            >
                              👁
                            </button>
                            <button
                              className="actionBtn"
                              onClick={() => downloadPdf(f.id as string)}
                              title="Download consent PDF"
                            >
                              ⬇
                            </button>
                            <button
                              className="actionBtn"
                              onClick={() => printPdf(f.id as string)}
                              title="Print consent PDF"
                            >
                              🖨
                            </button>
                          </>
                        )}
                        {canShareLink && (
                          <>
                            <button
                              className="actionBtn"
                              onClick={() => copyLink(f.signing_token as string)}
                              title="Copy consent link"
                            >
                              🔗
                            </button>
                            <button
                              className="actionBtn"
                              onClick={() => shareWhatsApp(f.signing_token as string, f.guest_name as string)}
                              title="Share via WhatsApp"
                            >
                              💬
                            </button>
                            <button
                              className="actionBtn actionBtn-confirmed"
                              onClick={() => openSignModal(f)}
                              disabled={isPending}
                              title="Sign consent form"
                            >
                              ✍
                            </button>
                          </>
                        )}
                        {f.status === "pending" && (
                          <button
                            className="actionBtn actionBtn-cancelled"
                            onClick={() => { setVoidingId(f.id as string); setVoidReason(""); setToast(null); }}
                            disabled={isPending}
                            title="Void consent form"
                          >
                            ✕
                          </button>
                        )}
                        {f.status === "voided" && (
                          <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                            {f.void_reason ? `Voided: ${String(f.void_reason).slice(0, 40)}` : "Voided"}
                          </span>
                        )}
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
          <p>No consent forms found{currentStatus !== "all" ? ` with status "${currentStatus}"` : ""}.</p>
        </div>
      )}

      {/* Signing modal */}
      <AdminModal
        open={Boolean(signingForm)}
        onClose={() => setSigningForm(null)}
        title={`Sign Consent — ${signingForm?.guest_name as string || ""}`}
        wide
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSigningForm(null)} disabled={isPending}>Cancel</button>
            <button className="btn btn-primary" onClick={submitSignature} disabled={isPending || !signature}>
              {isPending ? "Saving..." : "Confirm Signature"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "#647993", marginBottom: 16 }}>
          Guest: <strong>{signingForm?.guest_name as string}</strong>
        </p>
        <SignaturePad onSign={setSignature} label="Guest Signature" />
        <div style={{ marginTop: 16 }}>
          <FormField label="Witness Name (optional)" htmlFor="witness_name">
            <input
              id="witness_name"
              type="text"
              value={witnessName}
              onChange={(e) => setWitnessName(e.target.value)}
              placeholder="Witness name"
            />
          </FormField>
        </div>
        {toast && <Toast type={toast.type} message={toast.message} />}
      </AdminModal>

      {/* Void modal */}
      <AdminModal
        open={Boolean(voidingId)}
        onClose={() => setVoidingId(null)}
        title="Void Consent Form"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setVoidingId(null)} disabled={isPending}>Cancel</button>
            <button className="btn btn-primary" onClick={handleVoid} disabled={isPending || !voidReason.trim()}>
              {isPending ? "Voiding..." : "Void Consent"}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: "#647993", marginBottom: 16 }}>
          Only pending consent forms can be voided. Signed forms must go through a formal revocation process.
        </p>
        <FormField label="Void Reason" htmlFor="void_reason" required>
          <textarea
            id="void_reason"
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Explain why this consent form is being voided..."
          />
        </FormField>
        {toast && <Toast type={toast.type} message={toast.message} />}
      </AdminModal>

      {/* Create consent modal */}
      <AdminModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Consent Form"
        wide
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)} disabled={isPending}>Cancel</button>
            {!createdToken && (
              <button className="btn btn-primary" onClick={handleCreate} disabled={isPending}>
                {isPending ? "Creating..." : "Create Consent"}
              </button>
            )}
          </>
        }
      >
        {toast && <Toast type={toast.type} message={toast.message} />}

        {createdToken ? (
          <div style={{ padding: "12px 0" }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Consent link created</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button className="btn btn-secondary" onClick={() => copyLink(createdToken)} style={{ flex: 1 }}>
                Copy Link
              </button>
              <button className="btn btn-secondary" onClick={() => shareWhatsApp(createdToken, createForm.guest_name)} style={{ flex: 1 }}>
                Share via WhatsApp
              </button>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, fontSize: 13, wordBreak: "break-all" }}>
              {CONSENT_BASE_URL}/consent/{createdToken}
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
              Link expires in 7 days. Do not share the raw token.
            </p>
          </div>
        ) : (
          <>
            <FormRow cols={2}>
              <FormField label="Customer" htmlFor="cg_customer" required>
                <select id="cg_customer" value={createForm.customer_id} onChange={(e) => handleCustomerChange(e.target.value)}>
                  <option value="">Select customer...</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}{c.sub ? ` (${c.sub})` : ""}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Guest Name" htmlFor="cg_name" required>
                <input id="cg_name" value={createForm.guest_name} onChange={(e) => setCreateForm((p) => ({ ...p, guest_name: e.target.value }))} placeholder="Guest full name" />
              </FormField>
            </FormRow>
            <FormRow cols={2}>
              <FormField label="Booking (optional)" htmlFor="cg_booking">
                <select id="cg_booking" value={createForm.booking_id} onChange={(e) => handleBookingChange(e.target.value)}>
                  <option value="">No linked booking (walk-in)</option>
                  {bookingsList.map((b) => (
                    <option key={b.id} value={b.id}>{b.label}{b.sub ? ` — ${b.sub}` : ""}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Activity" htmlFor="cg_activity" required>
                <select id="cg_activity" value={createForm.activity_id} onChange={(e) => setCreateForm((p) => ({ ...p, activity_id: e.target.value }))}>
                  <option value="">Select activity...</option>
                  {activitiesList.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </FormField>
            </FormRow>
            <FormField label="Consent Type" htmlFor="cg_type">
              <input id="cg_type" type="text" value="Activity Consent" readOnly style={{ background: "#f0f4f8", color: "#64748b" }} />
              <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                Only activity consent forms are created here. Rental agreements are managed under Rentals.
              </p>
            </FormField>
          </>
        )}
      </AdminModal>
    </>
  );
}
