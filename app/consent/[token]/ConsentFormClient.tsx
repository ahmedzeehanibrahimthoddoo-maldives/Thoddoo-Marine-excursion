"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import SignCanvas from "@/app/rental/[token]/SignCanvas";

interface ConsentFormData {
  id: string;
  activity_name: string;
  booking_ref: string | null;
  guest_name: string;
  email: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  swimming_ability: string | null;
  medical_conditions: string | null;
  allergies: string | null;
  medications: string | null;
  recent_injuries: string | null;
  is_pregnant: boolean;
  safety_briefing_confirmed: boolean;
  life_jacket_confirmed: boolean;
  risk_acknowledged: boolean;
  photo_consent: boolean;
  signature_data_url: string | null;
  witness_name: string | null;
  witness_signature_data_url: string | null;
  parent_guardian_name: string | null;
  parent_guardian_signature_data_url: string | null;
  is_minor: boolean;
  status: string;
  signed_at: string | null;
  consent_version: string | null;
  consent_text: string | null;
}

interface ConsentFormClientProps {
  consentForm: ConsentFormData;
  token: string;
}

const swimmingOptions = [
  { value: "", label: "Select your swimming ability" },
  { value: "non-swimmer", label: "Non-swimmer" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced / Strong swimmer" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Fire-and-forget mailer trigger — never blocks or surfaces errors. */
function fireMailPost(url: string, token: string) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    fontFamily: "Arial, Helvetica, sans-serif",
    padding: "1.5rem 1rem 3rem",
  } as React.CSSProperties,
  card: {
    maxWidth: 700,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
    overflow: "hidden",
  } as React.CSSProperties,
  header: {
    background: "linear-gradient(135deg, var(--navy), var(--blue))",
    color: "#fff",
    padding: "2rem 2rem 1.5rem",
    textAlign: "center" as const,
  } as React.CSSProperties,
  headerH1: {
    fontSize: "1.4rem",
    margin: 0,
    fontWeight: 800,
  } as React.CSSProperties,
  headerP: {
    margin: "0.4rem 0 0",
    opacity: 0.85,
    fontSize: "0.85rem",
  } as React.CSSProperties,
  body: {
    padding: "1.5rem 2rem 2rem",
  } as React.CSSProperties,
  section: {
    marginBottom: "1.8rem",
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 800,
    color: "var(--navy)",
    borderBottom: "2px solid var(--cyan)",
    paddingBottom: "0.4rem",
    marginBottom: "1rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
  } as React.CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.8rem",
  } as React.CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
  } as React.CSSProperties,
  fieldFull: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
    gridColumn: "1 / -1",
  } as React.CSSProperties,
  label: {
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "var(--ink)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.02em",
  } as React.CSSProperties,
  input: {
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    background: "#f9fbfd",
    color: "var(--ink)",
    outline: "none",
    width: "100%",
  } as React.CSSProperties,
  textarea: {
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    background: "#f9fbfd",
    color: "var(--ink)",
    outline: "none",
    width: "100%",
    minHeight: 72,
    resize: "vertical" as const,
  } as React.CSSProperties,
  select: {
    border: "1.5px solid #dde6ef",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    background: "#f9fbfd",
    color: "var(--ink)",
    outline: "none",
    width: "100%",
  } as React.CSSProperties,
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.6rem",
    padding: "0.6rem 0",
  } as React.CSSProperties,
  checkboxInput: {
    marginTop: 3,
    flexShrink: 0,
    width: 18,
    height: 18,
    accentColor: "var(--blue)",
  } as React.CSSProperties,
  checkboxLabel: {
    fontSize: "0.85rem",
    lineHeight: 1.4,
    color: "var(--ink)",
    cursor: "pointer",
  } as React.CSSProperties,
  signatureBox: {
    border: "1.5px solid #dde6ef",
    borderRadius: 12,
    padding: "0.75rem",
    marginTop: "0.4rem",
    background: "#f9fbfd",
  } as React.CSSProperties,
  submitBtn: {
    width: "100%",
    background: "linear-gradient(135deg, var(--blue), var(--cyan))",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    padding: "0.9rem 1.5rem",
    fontSize: "1.05rem",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.02em",
    textTransform: "uppercase" as const,
    marginTop: "0.5rem",
  } as React.CSSProperties,
  submitBtnDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  } as React.CSSProperties,
  legalBox: {
    background: "#f0f7ff",
    border: "1px solid #c8ddf0",
    borderRadius: 12,
    padding: "1rem 1.2rem",
    fontSize: "0.78rem",
    lineHeight: 1.5,
    color: "#3a5a7c",
    marginTop: "1.2rem",
  } as React.CSSProperties,
  successOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(255,255,255,0.92)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  } as React.CSSProperties,
  successCard: {
    textAlign: "center" as const,
    background: "#fff",
    borderRadius: 18,
    padding: "3rem 2rem",
    boxShadow: "0 8px 40px rgba(7,57,111,0.12)",
    maxWidth: 420,
  } as React.CSSProperties,
  mobileOverride: `
    @media (max-width: 600px) {
      .consent-row { grid-template-columns: 1fr !important; }
      .consent-body { padding: 1.2rem 1rem 1.5rem !important; }
      .consent-header { padding: 1.5rem 1rem 1.2rem !important; }
    }
  `,
  printStyle: `
    @media print {
      body, html { background: #fff !important; }
      .consent-page { padding: 0 !important; }
      .consent-card { box-shadow: none !important; border-radius: 0 !important; }
      .consent-submit, .sign-canvas-wrap, .no-print,
      input[type="checkbox"], input[type="radio"], select, textarea,
      button { display: none !important; }
      label { pointer-events: none !important; }
    }
  `,
} as const;

export default function ConsentFormClient({ consentForm, token }: ConsentFormClientProps) {
  const supabase = createClient();

  const [swimmingAbility, setSwimmingAbility] = useState(
    consentForm.swimming_ability || ""
  );
  const [medicalConditions, setMedicalConditions] = useState(
    consentForm.medical_conditions || ""
  );
  const [allergies, setAllergies] = useState(consentForm.allergies || "");
  const [medications, setMedications] = useState(
    consentForm.medications || ""
  );
  const [recentInjuries, setRecentInjuries] = useState(
    consentForm.recent_injuries || ""
  );
  const [isPregnant, setIsPregnant] = useState(consentForm.is_pregnant);
  const [safetyBriefing, setSafetyBriefing] = useState(
    consentForm.safety_briefing_confirmed
  );
  const [lifeJacket, setLifeJacket] = useState(
    consentForm.life_jacket_confirmed
  );
  const [riskAcknowledged, setRiskAcknowledged] = useState(
    consentForm.risk_acknowledged
  );
  const [photoConsent, setPhotoConsent] = useState(consentForm.photo_consent);
  const [consentTextRead, setConsentTextRead] = useState(false);

  const [parentGuardianName, setParentGuardianName] = useState(
    consentForm.parent_guardian_name || ""
  );
  const [parentGuardianSig, setParentGuardianSig] = useState<string | null>(
    consentForm.parent_guardian_signature_data_url
  );

  const [guestSignature, setGuestSignature] = useState<string | null>(
    consentForm.signature_data_url
  );

  const [witnessName, setWitnessName] = useState(
    consentForm.witness_name || ""
  );
  const [witnessSignature, setWitnessSignature] = useState<string | null>(
    consentForm.witness_signature_data_url
  );

  const [email, setEmail] = useState(consentForm.email || "");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canSubmit =
    consentTextRead &&
    safetyBriefing &&
    lifeJacket &&
    riskAcknowledged &&
    guestSignature &&
    EMAIL_RE.test(email.trim()) &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;

    if (!EMAIL_RE.test(email.trim())) {
      setError("Please provide a valid email — your consent copy will be sent there.");
      setFieldErrors({ email: "Valid email required" });
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    // Capture the email before signing so the sign RPC sees a valid email on the row.
    const { error: emailErr } = await supabase.rpc("set_consent_email", {
      p_token: token,
      p_email: email.trim(),
    });
    if (emailErr) {
      setError("There was an error saving your email. Please try again.");
      setSubmitting(false);
      return;
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "sign_consent_form",
      {
        p_token: token,
        p_swimming_ability: swimmingAbility || null,
        p_medical_conditions: medicalConditions || null,
        p_allergies: allergies || null,
        p_medications: medications || null,
        p_recent_injuries: recentInjuries || null,
        p_is_pregnant: isPregnant,
        p_safety_briefing_confirmed: safetyBriefing,
        p_life_jacket_confirmed: lifeJacket,
        p_risk_acknowledged: riskAcknowledged,
        p_photo_consent: photoConsent,
        p_signature_data_url: guestSignature,
        p_witness_name: witnessName || null,
        p_witness_signature_data_url: witnessSignature,
        p_parent_guardian_name: parentGuardianName || null,
        p_parent_guardian_signature_data_url: parentGuardianSig,
        p_expected_consent_version: consentForm.consent_version || null,
      }
    );

    if (rpcError) {
      setError(
        "There was an error submitting your form. Please try again or contact staff."
      );
      setSubmitting(false);
      return;
    }

    const res = result as unknown as { error?: string; message?: string };
    if (res?.error) {
      setError(res.message || "Submission failed. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);

    fireMailPost("/api/mail/consent-copy", token);
  }

  if (submitted) {
    return (
      <div style={styles.successOverlay}>
        <style>{`@media print { .consent-no-print { display: none !important; } }`}</style>
        <div style={styles.successCard}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#d4edda",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.2rem",
              fontSize: "1.8rem",
            }}
          >
            &#10003;
          </div>
          <h2 style={{ color: "var(--navy)", margin: "0 0 0.5rem" }}>
            Consent Form Signed
          </h2>
          <p
            style={{
              color: "var(--ink)",
              opacity: 0.7,
              margin: 0,
              fontSize: "0.9rem",
            }}
          >
            Thank you, <strong>{consentForm.guest_name}</strong>. Your consent
            form for <strong>{consentForm.activity_name}</strong> has been
            recorded. You may now participate in the activity.
          </p>
          <p
            style={{
              color: "var(--ink)",
              opacity: 0.7,
              margin: "0.6rem 0 0",
              fontSize: "0.9rem",
            }}
          >
            A signed PDF copy of your consent has been emailed to{" "}
            <strong>{email.trim()}</strong>. A receipt will be sent to the same
            address when any rental or payment is processed.
          </p>
          <p
            style={{
              color: "var(--ink)",
              opacity: 0.6,
              margin: "0.8rem 0 1rem",
              fontSize: "0.82rem",
            }}
          >
            Your official PDF copy of the consent & liability waiver is
            available below for download and printing. Thoddoo Marine also
            keeps a signed copy for the records.
          </p>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <a
              href={`/api/consents/${encodeURIComponent(token)}/pdf?download=1`}
              className="consent-action consent-no-print"
              style={{
                display: "inline-block",
                background: "var(--navy)",
                color: "#fff",
                padding: "0.7rem 1.3rem",
                borderRadius: 10,
                fontSize: "0.85rem",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              ⬇ Download PDF
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="consent-no-print"
              style={{
                border: "1px solid var(--navy)",
                color: "var(--navy)",
                background: "transparent",
                padding: "0.7rem 1.3rem",
                borderRadius: 10,
                fontSize: "0.85rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🖨 Print
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fmtDateConsent = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "-";

  return (
    <>
      <style>{styles.printStyle}</style>
      <style>{styles.mobileOverride}</style>
      <main className="consent-page" style={styles.page}>
        <div className="consent-card" style={styles.card}>
          <div className="consent-header" style={styles.header}>
            <h1 style={styles.headerH1}>Activity Consent &amp; Liability Waiver</h1>
            <p style={styles.headerP}>
              Thoddoo Marine Excursion Centre &middot; Thoddoo, Maldives
            </p>
          </div>

          <div className="consent-body" style={styles.body}>
            {error && (
              <div
                style={{
                  background: "#f8d7da",
                  color: "#842029",
                  borderRadius: 10,
                  padding: "0.7rem 1rem",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Section 1: Guest Information */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>1. Guest Information</h2>
              <div className="consent-row" style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Full Name</span>
                  <input
                    style={styles.input}
                    value={consentForm.guest_name}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Nationality</span>
                  <input
                    style={styles.input}
                    value={consentForm.nationality || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Date of Birth</span>
                  <input
                    style={styles.input}
                    value={fmtDateConsent(consentForm.date_of_birth)}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Passport / ID Number</span>
                  <input
                    style={styles.input}
                    value={consentForm.passport_number || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Phone</span>
                  <input
                    style={styles.input}
                    value={consentForm.phone || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Hotel</span>
                  <input
                    style={styles.input}
                    value={consentForm.hotel || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Room Number</span>
                  <input
                    style={styles.input}
                    value={consentForm.room_number || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>
                    Email <span style={{ color: "#c0392b" }}>*</span>
                  </span>
                  <input
                    type="email"
                    style={styles.input}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => ({ ...prev, email: "" }));
                      }
                    }}
                    placeholder="e.g. guest@example.com"
                    required
                  />
                  {fieldErrors.email ? (
                    <span style={{ color: "#842029", fontSize: "0.8rem" }}>
                      {fieldErrors.email}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            {/* Section 2: Emergency Contact */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>2. Emergency Contact</h2>
              <div className="consent-row" style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Contact Name</span>
                  <input
                    style={styles.input}
                    value={consentForm.emergency_contact_name || ""}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Contact Phone</span>
                  <input
                    style={styles.input}
                    value={consentForm.emergency_contact_phone || ""}
                    readOnly
                  />
                </div>
              </div>
            </section>

            {/* Section 3: Activity Details */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>3. Activity Details</h2>
              <div className="consent-row" style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Activity</span>
                  <input
                    style={styles.input}
                    value={consentForm.activity_name}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Booking Reference</span>
                  <input
                    style={styles.input}
                    value={consentForm.booking_ref || "-"}
                    readOnly
                  />
                </div>
              </div>
            </section>

            {/* Section 4: Consent Terms (displayed from server template) */}
            {consentForm.consent_text && (
              <section style={styles.section}>
                <h2 style={styles.sectionTitle}>4. Consent Terms</h2>
                <p style={{ fontSize: "0.78rem", color: "#6b7c8d", marginBottom: "0.6rem" }}>
                  Version: <strong>{consentForm.consent_version || "unknown"}</strong>
                </p>
                <div style={{
                  background: "#f9fbfd",
                  border: "1px solid #dde6ef",
                  borderRadius: 12,
                  padding: "1rem 1.2rem",
                  fontSize: "0.82rem",
                  lineHeight: 1.75,
                  letterSpacing: "0.012em",
                  textAlign: "justify",
                  color: "var(--ink)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 400,
                  overflowY: "auto",
                }}>
                  {consentForm.consent_text}
                </div>
                <div style={{ ...styles.checkboxRow, marginTop: "0.8rem" }}>
                  <input
                    type="checkbox"
                    style={styles.checkboxInput}
                    checked={consentTextRead}
                    onChange={(e) => {
                      setConsentTextRead(e.target.checked);
                      if (fieldErrors.consentTextRead) setFieldErrors((p) => ({ ...p, consentTextRead: "" }));
                    }}
                    id="consentTextRead"
                  />
                  <label htmlFor="consentTextRead" style={styles.checkboxLabel}>
                    I have read and agree to the complete Activity Consent &amp; Liability Waiver above.{" "}
                    <span style={{ color: "#c0392b" }}>*</span>
                  </label>
                </div>
                {fieldErrors.consentTextRead && (
                  <span className="bookingFieldError" style={{ color: "#c0392b", fontSize: "0.8rem" }}>
                    {fieldErrors.consentTextRead}
                  </span>
                )}
              </section>
            )}

            {/* Section 5: Medical Information */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>5. Medical Information</h2>
              <div className="consent-row" style={styles.row}>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Swimming Ability</span>
                  <select
                    style={styles.select}
                    value={swimmingAbility}
                    onChange={(e) => setSwimmingAbility(e.target.value)}
                  >
                    {swimmingOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>
                    Known Medical Conditions (if any)
                  </span>
                  <textarea
                    style={styles.textarea}
                    value={medicalConditions}
                    onChange={(e) => setMedicalConditions(e.target.value)}
                    placeholder="E.g. asthma, heart condition, diabetes..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Allergies (if any)</span>
                  <textarea
                    style={styles.textarea}
                    value={allergies}
                    onChange={(e) => setAllergies(e.target.value)}
                    placeholder="List any allergies..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Current Medications (if any)</span>
                  <textarea
                    style={styles.textarea}
                    value={medications}
                    onChange={(e) => setMedications(e.target.value)}
                    placeholder="List current medications..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>
                    Recent Injuries or Surgeries (if any)
                  </span>
                  <textarea
                    style={styles.textarea}
                    value={recentInjuries}
                    onChange={(e) => setRecentInjuries(e.target.value)}
                    placeholder="Detail any recent injuries or surgeries..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <div style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      style={styles.checkboxInput}
                      checked={isPregnant}
                      onChange={(e) => setIsPregnant(e.target.checked)}
                      id="isPregnant"
                    />
                    <label
                      htmlFor="isPregnant"
                      style={styles.checkboxLabel}
                    >
                      I am currently pregnant
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 5: Safety Acknowledgements */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>6. Safety Acknowledgements</h2>
              <div>
                <div style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    style={styles.checkboxInput}
                    checked={safetyBriefing}
                    onChange={(e) => setSafetyBriefing(e.target.checked)}
                    id="safetyBriefing"
                  />
                  <label
                    htmlFor="safetyBriefing"
                    style={styles.checkboxLabel}
                  >
                    I confirm I have received and understood the safety briefing
                    for this activity. <span style={{ color: "#c0392b" }}>*</span>
                  </label>
                </div>

                <div style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    style={styles.checkboxInput}
                    checked={lifeJacket}
                    onChange={(e) => setLifeJacket(e.target.checked)}
                    id="lifeJacket"
                  />
                  <label htmlFor="lifeJacket" style={styles.checkboxLabel}>
                    I confirm I will wear the provided life jacket / safety
                    equipment at all times during the activity.{" "}
                    <span style={{ color: "#c0392b" }}>*</span>
                  </label>
                </div>

                <div style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    style={styles.checkboxInput}
                    checked={riskAcknowledged}
                    onChange={(e) => setRiskAcknowledged(e.target.checked)}
                    id="riskAck"
                  />
                  <label htmlFor="riskAck" style={styles.checkboxLabel}>
                    I acknowledge that water sports activities carry inherent
                    risks including but not limited to drowning, injury, and
                    property damage. I voluntarily assume all risks associated
                    with my participation.{" "}
                    <span style={{ color: "#c0392b" }}>*</span>
                  </label>
                </div>
              </div>
            </section>

            {/* Section 6: Photo / Video Consent */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>7. Photo / Video Consent</h2>
              <div style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  style={styles.checkboxInput}
                  checked={photoConsent}
                  onChange={(e) => setPhotoConsent(e.target.checked)}
                  id="photoConsent"
                />
                <label htmlFor="photoConsent" style={styles.checkboxLabel}>
                  I consent to the use of photographs or video recordings of me
                  during this activity for Thoddoo Marine Excursion&apos;
                  promotional and social media purposes.
                </label>
              </div>
            </section>

            {/* Section 8: Minor (if applicable) */}
            {consentForm.is_minor && (
              <section style={styles.section}>
                <h2 style={styles.sectionTitle}>
                  8. Parent / Guardian Consent
                </h2>
                <p
                  style={{
                    fontSize: "0.82rem",
                    color: "#6b7c8d",
                    marginBottom: "0.6rem",
                  }}
                >
                  As the participant is under 18, a parent or legal guardian
                  must sign below.
                </p>
                <div className="consent-row" style={styles.row}>
                  <div style={styles.fieldFull}>
                    <span style={styles.label}>
                      Parent / Guardian Full Name
                    </span>
                    <input
                      style={styles.input}
                      value={parentGuardianName}
                      onChange={(e) => setParentGuardianName(e.target.value)}
                      placeholder="Enter parent or guardian name"
                    />
                  </div>
                </div>
                <div style={styles.signatureBox}>
                  <span style={styles.label}>Parent / Guardian Signature</span>
                  <SignCanvas
                    onSign={(d) => setParentGuardianSig(d)}
                    label="Parent/Guardian"
                  />
                </div>
              </section>
            )}

            {/* Section 9: Guest Signature */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>
                {consentForm.is_minor
                  ? "9. Participant Signature"
                  : "8. Participant Signature"}
              </h2>
              <p
                style={{
                  fontSize: "0.82rem",
                  color: "#6b7c8d",
                  marginBottom: "0.6rem",
                }}
              >
                Please sign below to confirm your agreement to all sections
                above.
              </p>
              <div style={styles.signatureBox}>
                <SignCanvas
                  onSign={(d) => setGuestSignature(d)}
                  label="Guest"
                />
              </div>
            </section>

            {/* Section 10: Witness */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>
                {consentForm.is_minor
                  ? "10. Staff / Witness"
                  : "9. Staff / Witness"}
              </h2>
              <div className="consent-row" style={styles.row}>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Witness Name</span>
                  <input
                    style={styles.input}
                    value={witnessName}
                    onChange={(e) => setWitnessName(e.target.value)}
                    placeholder="Staff member name"
                  />
                </div>
              </div>
              <div style={styles.signatureBox}>
                <span style={styles.label}>Witness Signature</span>
                <SignCanvas
                  onSign={(d) => setWitnessSignature(d)}
                  label="Witness"
                />
              </div>
            </section>

            {/* Legal Disclaimer */}
            <div style={styles.legalBox}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700 }}>
                Legal Notice — Governing Law: Republic of Maldives
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                This consent form is governed by the <strong>Maldives Tourism Act (Law No. 2/99)</strong>, the <strong>Regulation on Safety &amp; Security Standards at Tourist Establishments (Regulation No. 2020/R-27)</strong>, and the <strong>Consumer Protection Act (2020)</strong>. It constitutes a binding release of liability and indemnification to the extent permitted by Maldivian law.
              </p>
              <p style={{ margin: "0 0 0.4rem" }}>
                This waiver does not exclude or limit liability for gross negligence, wilful misconduct, or any liability that cannot be excluded under mandatory provisions of Maldivian law. Disputes are subject to the exclusive jurisdiction of the courts of the Republic of Maldives after attempted mediation.
              </p>
              <p style={{ margin: 0, fontStyle: "italic" }}>
                Participants are encouraged to seek independent legal advice before signing.
              </p>
            </div>

            {/* Submit */}
            <button
              className="consent-submit no-print"
              style={{
                ...styles.submitBtn,
                ...(canSubmit ? {} : styles.submitBtnDisabled),
              }}
              disabled={!canSubmit}
              onClick={handleSubmit}
              type="button"
            >
              {submitting ? "Submitting..." : "Sign Consent Form"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
