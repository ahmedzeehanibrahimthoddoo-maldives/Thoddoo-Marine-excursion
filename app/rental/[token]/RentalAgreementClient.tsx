"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { formatUsdOnly } from "@/lib/money";
import SignCanvas from "./SignCanvas";
import type { EquipmentCondition } from "@/lib/supabase/types";

interface RentalEquipment {
  name: string;
  asset_number: string;
  category: string;
  description: string | null;
}

interface RentalData {
  id: string;
  equipment: RentalEquipment;
  checkout_condition: string;
  checked_out_at: string;
  expected_return_at: string;
  rental_charge_cents: number;
  deposit_cents: number;
  currency: string;
  status: string;
}

interface RentalAgreementClientProps {
  rental: RentalData;
  isStaff: boolean;
  rentalId: string;
  token: string;
  consent: {
    id: string;
    activity_name: string;
    guest_name: string;
    email: string | null;
    is_minor: boolean;
    date_of_birth: string | null;
    status: string;
    signed_at: string | null;
    consent_version: string | null;
    consent_text: string | null;
  } | null;
  consentError: string | null;
}

const conditionOptions: { value: EquipmentCondition; label: string }[] = [
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "damaged", label: "Damaged" },
];

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
  staffBox: {
    background: "#f7fbff",
    border: "2px dashed var(--cyan)",
    borderRadius: 14,
    padding: "1.2rem",
    marginTop: "1rem",
  } as React.CSSProperties,
  staffTitle: {
    fontSize: "0.9rem",
    fontWeight: 800,
    color: "var(--blue)",
    marginBottom: "0.8rem",
    textTransform: "uppercase" as const,
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
      .rental-row { grid-template-columns: 1fr !important; }
      .rental-body { padding: 1.2rem 1rem 1.5rem !important; }
      .rental-header { padding: 1.5rem 1rem 1.2rem !important; }
    }
  `,
  printStyle: `
    @media print {
      body, html { background: #fff !important; }
      .rental-page { padding: 0 !important; }
      .rental-card { box-shadow: none !important; border-radius: 0 !important; }
      .rental-submit, .sign-canvas-wrap, .no-print { display: none !important; }
    }
  `,
} as const;

export default function RentalAgreementClient({
  rental,
  isStaff,
  rentalId,
  token,
  consent,
  consentError,
}: RentalAgreementClientProps) {
  const supabase = createClient();

  const [ackReceipt, setAckReceipt] = useState(false);
  const [ackLiability, setAckLiability] = useState(false);
  const [ackSafety, setAckSafety] = useState(false);
  const [ackSafetyEquipment, setAckSafetyEquipment] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);

  // Compulsory guest details (mirrors the walk-in consent flow)
  const [guestName, setGuestName] = useState(consent?.guest_name || "");
  const [nationality, setNationality] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [hotel, setHotel] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [email, setEmail] = useState(consent?.email || "");
  const [swimmingAbility, setSwimmingAbility] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medications, setMedications] = useState("");
  const [recentInjuries, setRecentInjuries] = useState("");
  const [isPregnant, setIsPregnant] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [guardianName, setGuardianName] = useState("");
  const [guardianSignature, setGuardianSignature] = useState<string | null>(null);
  const [guestSignature, setGuestSignature] = useState<string | null>(null);

  const [returnCondition, setReturnCondition] = useState<EquipmentCondition>("good");
  const [damageNotes, setDamageNotes] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<number>(0);
  const [returnPhotoUrl, setReturnPhotoUrl] = useState("");
  const [staffSignature, setStaffSignature] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [returned, setReturned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ageFromDate(dob: string): number | null {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
    return age;
  }

  const guestAge = ageFromDate(dateOfBirth);
  const minorRenter = guestAge !== null && guestAge < 18;

  const consentReady = Boolean(consent?.consent_text);
  const emailValid = EMAIL_RE.test(email.trim());
  const detailsReady =
    guestName.trim() !== "" &&
    nationality.trim() !== "" &&
    dateOfBirth.trim() !== "" &&
    phone.trim() !== "" &&
    hotel.trim() !== "" &&
    emergencyName.trim() !== "" &&
    emergencyPhone.trim() !== "" &&
    swimmingAbility !== "" &&
    emailValid;
  const guardianReady =
    !minorRenter || (guardianName.trim() !== "" && Boolean(guardianSignature));
  const canSign =
    consentReady &&
    detailsReady &&
    guardianReady &&
    ackReceipt &&
    ackLiability &&
    ackSafety &&
    ackSafetyEquipment &&
    ackRisk &&
    guestSignature &&
    !submitting;

  function fmtDateTimeLocal(iso: string) {
    return fmtDateTime(iso);
  }

  async function handleSign() {
    if (!canSign || !consent) return;

    if (!EMAIL_RE.test(email.trim())) {
      setError("Please provide a valid email — your consent copy and receipt will be sent there.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // 1. Record the renter's compulsory details (minor status derived from DOB)
    const { data: infoRes, error: infoErr } = await supabase.rpc(
      "update_rental_consent_details",
      {
        p_token: token,
        p_guest_name: guestName.trim(),
        p_nationality: nationality.trim(),
        p_date_of_birth: dateOfBirth.trim(),
        p_passport_number: passportNumber.trim() || null,
        p_phone: phone.trim(),
        p_hotel: hotel.trim(),
        p_room_number: roomNumber.trim() || null,
        p_emergency_contact_name: emergencyName.trim(),
        p_emergency_contact_phone: emergencyPhone.trim(),
        p_email: email.trim(),
      }
    );
    if (infoErr) {
      setError("Unable to save renter details. Please try again.");
      setSubmitting(false);
      return;
    }
    const info = infoRes as unknown as { error?: string; message?: string };
    if (info?.error) {
      setError(info.message || "Unable to save renter details. Please try again.");
      setSubmitting(false);
      return;
    }

    // 2. Sign the consent & liability form (immutable token-keyed record)
    const { data: consentRes, error: consentReqErr } = await supabase.rpc(
      "sign_consent_form",
      {
        p_token: token,
        p_swimming_ability: swimmingAbility,
        p_medical_conditions: medicalConditions.trim() || null,
        p_allergies: allergies.trim() || null,
        p_medications: medications.trim() || null,
        p_recent_injuries: recentInjuries.trim() || null,
        p_is_pregnant: isPregnant,
        p_safety_briefing_confirmed: ackSafety,
        p_life_jacket_confirmed: ackSafetyEquipment,
        p_risk_acknowledged: ackRisk,
        p_photo_consent: photoConsent,
        p_signature_data_url: guestSignature,
        p_parent_guardian_name: minorRenter ? guardianName.trim() : null,
        p_parent_guardian_signature_data_url: minorRenter ? guardianSignature : null,
        p_expected_consent_version: consent.consent_version,
      }
    );
    if (consentReqErr) {
      setError("Error submitting your consent. Please try again.");
      setSubmitting(false);
      return;
    }
    const consentResData = consentRes as unknown as { error?: string; message?: string };
    if (consentResData?.error) {
      setError(consentResData.message || "Consent submission failed. Please try again.");
      setSubmitting(false);
      return;
    }

    // 3. Record the guest signature on the rental agreement itself
    const { data: result, error: rpcError } = await supabase.rpc(
      "sign_rental_agreement",
      {
        p_token: token,
        p_guest_signature_data_url: guestSignature,
      }
    );

    if (rpcError) {
      setError("Error submitting your signature. Please try again.");
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

  async function handleReturn() {
    if (!staffSignature) return;
    setSubmitting(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc(
      "complete_rental_return",
      {
        p_rental_id: rentalId,
        p_return_condition: returnCondition,
        p_damage_notes: damageNotes || null,
        p_additional_charges_cents: Math.round(additionalCharges * 100),
        p_return_photo_url: returnPhotoUrl || null,
        p_staff_signature_data_url: staffSignature,
      }
    );

    if (rpcError) {
      setError("Error completing return. Please try again.");
      setSubmitting(false);
      return;
    }

    const res = result as unknown as { error?: string; message?: string };
    if (res?.error) {
      setError(res.message || "Return failed. Please try again.");
      setSubmitting(false);
      return;
    }

    setReturned(true);
    setSubmitting(false);

    fireMailPost("/api/mail/rental-receipt", token);
  }

  if (submitted && !returned) {
    return (
      <>
        <style>{styles.printStyle}</style>
        <style>{styles.mobileOverride}</style>
        <main className="rental-page" style={styles.page}>
          <div className="rental-card" style={styles.card}>
            <div className="rental-header" style={styles.header}>
              <h1 style={styles.headerH1}>Equipment Rental Agreement</h1>
              <p style={styles.headerP}>
                Thoddoo Marine Excursion Centre
              </p>
            </div>
            <div className="rental-body" style={styles.body}>
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem 0",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "#d4edda",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1.2rem",
                    fontSize: "1.6rem",
                  }}
                >
                  &#10003;
                </div>
                <h2 style={{ color: "var(--navy)", margin: "0 0 0.5rem" }}>
                  Consent & Agreement Signed
                </h2>
                <p
                  style={{
                    color: "var(--ink)",
                    opacity: 0.7,
                    margin: 0,
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                  }}
                >
                  Your consent & liability form and rental terms for{" "}
                  <strong>{rental.equipment.name}</strong> are signed. Please
                  return the equipment by{" "}
                  <strong>{fmtDateTimeLocal(rental.expected_return_at)}</strong>
                  .
                </p>
                <p
                  style={{
                    color: "var(--blue)",
                    margin: "0.9rem 0 0",
                    fontSize: "0.85rem",
                  }}
                >
                  <a
                    href={`/api/consents/${token}/pdf?download=1`}
                    style={{ color: "var(--blue)", fontWeight: 700 }}
                  >
                    Download a copy of your consent form (PDF)
                  </a>
                </p>
              </div>

              <div style={styles.legalBox}>
                <p style={{ margin: 0 }}>
                  This agreement records the checkout and return of equipment.
                  Liability for damage or loss is subject to applicable
                  Maldivian law and Thoddoo Marine policies.
                </p>
                <p style={{ margin: "0.4rem 0 0", fontStyle: "italic" }}>
                  NOTICE: This form should be reviewed under applicable
                  Maldivian law.
                </p>
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <style>{styles.printStyle}</style>
      <style>{styles.mobileOverride}</style>
      <main className="rental-page" style={styles.page}>
        <div className="rental-card" style={styles.card}>
          <div className="rental-header" style={styles.header}>
            <h1 style={styles.headerH1}>Equipment Rental Agreement</h1>
            <p style={styles.headerP}>
              Thoddoo Marine Excursion Centre &middot; Thoddoo, Maldives
            </p>
          </div>

          <div className="rental-body" style={styles.body}>
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

            {/* Section 1: Rental Details */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>1. Rental Details</h2>
              <div className="rental-row" style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Equipment</span>
                  <input
                    style={styles.input}
                    value={rental.equipment.name}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Asset Number</span>
                  <input
                    style={styles.input}
                    value={rental.equipment.asset_number}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Checked Out</span>
                  <input
                    style={styles.input}
                    value={fmtDateTimeLocal(rental.checked_out_at)}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Expected Return</span>
                  <input
                    style={styles.input}
                    value={fmtDateTimeLocal(rental.expected_return_at)}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Rental Charge</span>
                  <input
                    style={styles.input}
                    value={formatUsdOnly(rental.rental_charge_cents, rental.currency)}
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Deposit</span>
                  <input
                    style={styles.input}
                    value={formatUsdOnly(rental.deposit_cents, rental.currency)}
                    readOnly
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Equipment Condition */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>2. Equipment Condition</h2>
              <div className="rental-row" style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Condition at Checkout</span>
                  <input
                    style={styles.input}
                    value={
                      rental.checkout_condition.charAt(0).toUpperCase() +
                      rental.checkout_condition.slice(1)
                    }
                    readOnly
                  />
                </div>
              </div>
            </section>

            {/* Section 3: Safe Use Acknowledgement */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>
                3. Safe Use Acknowledgement
              </h2>
              <div style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  style={styles.checkboxInput}
                  checked={ackReceipt}
                  onChange={(e) => setAckReceipt(e.target.checked)}
                  id="ackReceipt"
                />
                <label htmlFor="ackReceipt" style={styles.checkboxLabel}>
                  I acknowledge receipt of the above equipment in the stated
                  condition and agree to return it in the same condition by the
                  expected return time.{" "}
                  <span style={{ color: "#c0392b" }}>*</span>
                </label>
              </div>
              <div style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  style={styles.checkboxInput}
                  checked={ackLiability}
                  onChange={(e) => setAckLiability(e.target.checked)}
                  id="ackLiability"
                />
                <label htmlFor="ackLiability" style={styles.checkboxLabel}>
                  I understand I may be liable for damage or loss of the
                  equipment. <span style={{ color: "#c0392b" }}>*</span>
                </label>
              </div>
            </section>

            {/* Section 4: Liability Consent & Waiver */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>4. Liability Consent &amp; Waiver</h2>

              {consentError && !consentReady ? (
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#842029",
                    background: "#f8d7da",
                    borderRadius: 10,
                    padding: "0.7rem 1rem",
                  }}
                >
                  The consent form is unavailable. Please contact Thoddoo Marine
                  staff before returning the equipment.
                </p>
              ) : (
                <>
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: "auto",
                      background: "#f0f7ff",
                      border: "1px solid #c8ddf0",
                      borderRadius: 12,
                      padding: "0.9rem 1.1rem",
                      fontSize: "0.78rem",
                      lineHeight: 1.55,
                      color: "#3a5a7c",
                      whiteSpace: "pre-wrap",
                      marginBottom: "0.6rem",
                    }}
                  >
                    {consent?.consent_text || "Loading waiver terms..."}
                  </div>

                  <div style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      style={styles.checkboxInput}
                      checked={ackSafety}
                      onChange={(e) => setAckSafety(e.target.checked)}
                      id="ackSafety"
                    />
                    <label htmlFor="ackSafety" style={styles.checkboxLabel}>
                      I confirm I have received and understood the safety
                      instructions and briefing for this equipment.{" "}
                      <span style={{ color: "#c0392b" }}>*</span>
                    </label>
                  </div>
                  <div style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      style={styles.checkboxInput}
                      checked={ackSafetyEquipment}
                      onChange={(e) => setAckSafetyEquipment(e.target.checked)}
                      id="ackSafetyEquipment"
                    />
                    <label htmlFor="ackSafetyEquipment" style={styles.checkboxLabel}>
                      I confirm I will use the provided safety equipment
                      (including any life jacket / buoyancy aid) as instructed.{" "}
                      <span style={{ color: "#c0392b" }}>*</span>
                    </label>
                  </div>
                  <div style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      style={styles.checkboxInput}
                      checked={ackRisk}
                      onChange={(e) => setAckRisk(e.target.checked)}
                      id="ackRisk"
                    />
                    <label htmlFor="ackRisk" style={styles.checkboxLabel}>
                      I acknowledge the inherent risks of using this equipment
                      and voluntarily assume them.{" "}
                      <span style={{ color: "#c0392b" }}>*</span>
                    </label>
                  </div>

                  <div style={{ marginTop: "0.8rem", paddingTop: "0.8rem", borderTop: "1px solid #dde6ef" }}>
                    <h3
                      style={{
                        fontSize: "0.86rem",
                        fontWeight: 800,
                        color: "var(--navy)",
                        margin: "0 0 0.5rem",
                      }}
                    >
                      Guest Details <span style={{ color: "#c0392b" }}>*</span>
                    </h3>
                    <div className="rental-row" style={styles.row}>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Full Name <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="text"
                          style={styles.input}
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Nationality <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="text"
                          style={styles.input}
                          value={nationality}
                          onChange={(e) => setNationality(e.target.value)}
                          placeholder="e.g. Maldives"
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Date of Birth <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="date"
                          style={styles.input}
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Passport / ID Number</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={passportNumber}
                          onChange={(e) => setPassportNumber(e.target.value)}
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Phone <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="tel"
                          style={styles.input}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="e.g. +960 99xxxxxx"
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Hotel <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="text"
                          style={styles.input}
                          value={hotel}
                          onChange={(e) => setHotel(e.target.value)}
                          placeholder="Accommodation / guesthouse"
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>Room Number</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={roomNumber}
                          onChange={(e) => setRoomNumber(e.target.value)}
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Email{" "}
                          <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="email"
                          style={styles.input}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="e.g. guest@example.com"
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Swimming Ability{" "}
                          <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <select
                          style={styles.select}
                          value={swimmingAbility}
                          onChange={(e) => setSwimmingAbility(e.target.value)}
                          required
                        >
                          <option value="">Select your swimming ability</option>
                          <option value="Non-swimmer">Non-swimmer</option>
                          <option value="Weak (needs assistance)">
                            Weak (needs assistance)
                          </option>
                          <option value="Average">Average</option>
                          <option value="Strong">Strong</option>
                        </select>
                      </div>
                    </div>

                    <h3
                      style={{
                        fontSize: "0.86rem",
                        fontWeight: 800,
                        color: "var(--navy)",
                        margin: "0.8rem 0 0.5rem",
                      }}
                    >
                      Emergency Contact{" "}
                      <span style={{ color: "#c0392b" }}>*</span>
                    </h3>
                    <div className="rental-row" style={styles.row}>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Contact Name{" "}
                          <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="text"
                          style={styles.input}
                          value={emergencyName}
                          onChange={(e) => setEmergencyName(e.target.value)}
                          required
                        />
                      </div>
                      <div style={styles.field}>
                        <span style={styles.label}>
                          Contact Phone{" "}
                          <span style={{ color: "#c0392b" }}>*</span>
                        </span>
                        <input
                          type="tel"
                          style={styles.input}
                          value={emergencyPhone}
                          onChange={(e) => setEmergencyPhone(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <h3
                      style={{
                        fontSize: "0.86rem",
                        fontWeight: 800,
                        color: "var(--navy)",
                        margin: "0.8rem 0 0.5rem",
                      }}
                    >
                      Health Information
                    </h3>
                    <div className="rental-row" style={styles.row}>
                      <div style={styles.fieldFull}>
                        <span style={styles.label}>Medical Conditions</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={medicalConditions}
                          onChange={(e) => setMedicalConditions(e.target.value)}
                          placeholder="e.g. asthma, heart condition, injuries"
                        />
                      </div>
                      <div style={styles.fieldFull}>
                        <span style={styles.label}>Allergies</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={allergies}
                          onChange={(e) => setAllergies(e.target.value)}
                        />
                      </div>
                      <div style={styles.fieldFull}>
                        <span style={styles.label}>Medications</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={medications}
                          onChange={(e) => setMedications(e.target.value)}
                        />
                      </div>
                      <div style={styles.fieldFull}>
                        <span style={styles.label}>Recent Injuries</span>
                        <input
                          type="text"
                          style={styles.input}
                          value={recentInjuries}
                          onChange={(e) => setRecentInjuries(e.target.value)}
                        />
                      </div>
                      <div style={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          style={styles.checkboxInput}
                          checked={isPregnant}
                          onChange={(e) => setIsPregnant(e.target.checked)}
                          id="isPregnant"
                        />
                        <label htmlFor="isPregnant" style={styles.checkboxLabel}>
                          I am pregnant.
                        </label>
                      </div>
                      <div style={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          style={styles.checkboxInput}
                          checked={photoConsent}
                          onChange={(e) => setPhotoConsent(e.target.checked)}
                          id="photoConsent"
                        />
                        <label htmlFor="photoConsent" style={styles.checkboxLabel}>
                          I consent to photographs/video being taken of me
                          during this rental for Thoddoo Marine&apos;s records.
                        </label>
                      </div>
                    </div>

                    <p
                      style={{
                        fontSize: "0.82rem",
                        color: "#6b7c8d",
                        margin: "0 0 0.5rem",
                      }}
                    >
                      If the renter is under 18, a parent or legal guardian must
                      sign below.
                    </p>
                    {minorRenter && (
                      <div className="rental-row" style={styles.row}>
                        <div style={styles.fieldFull}>
                          <span style={styles.label}>
                            Parent / Guardian Name
                          </span>
                          <input
                            type="text"
                            style={styles.input}
                            value={guardianName}
                            onChange={(e) => setGuardianName(e.target.value)}
                            placeholder="Full name of parent or guardian"
                          />
                        </div>
                        <div style={styles.fieldFull}>
                          <span style={styles.label}>
                            Parent / Guardian Signature
                          </span>
                          <div style={styles.signatureBox}>
                            <SignCanvas
                              onSign={(d) => setGuardianSignature(d)}
                              label="Parent / Guardian"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Section 5: Guest Signature */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>5. Guest Signature</h2>
              <p
                style={{
                  fontSize: "0.82rem",
                  color: "#6b7c8d",
                  marginBottom: "0.6rem",
                }}
              >
                Please sign below to confirm you have read and agree to the
                terms above.
              </p>
              <div style={styles.signatureBox}>
                <SignCanvas
                  onSign={(d) => setGuestSignature(d)}
                  label="Guest"
                />
              </div>
            </section>

            {/* Section 5: Return (staff only) */}
            {isStaff && (
              <div style={styles.staffBox}>
                <p style={styles.staffTitle}>Staff Return Section</p>

                <section style={styles.section}>
                  <h2 style={styles.sectionTitle}>
                    6. Return Processing
                  </h2>
                  <div className="rental-row" style={styles.row}>
                    <div style={styles.fieldFull}>
                      <span style={styles.label}>Return Condition</span>
                      <select
                        style={styles.select}
                        value={returnCondition}
                        onChange={(e) =>
                          setReturnCondition(
                            e.target.value as EquipmentCondition
                          )
                        }
                      >
                        {conditionOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={styles.fieldFull}>
                      <span style={styles.label}>Damage Notes</span>
                      <textarea
                        style={styles.textarea}
                        value={damageNotes}
                        onChange={(e) => setDamageNotes(e.target.value)}
                        placeholder="Note any damage observed..."
                      />
                    </div>
                    <div style={styles.fieldFull}>
                      <span style={styles.label}>
                        Additional Charges (USD)
                      </span>
                      <input
                        type="number"
                        style={styles.input}
                        value={additionalCharges}
                        onChange={(e) =>
                          setAdditionalCharges(parseFloat(e.target.value) || 0)
                        }
                        min={0}
                        step={0.01}
                      />
                    </div>
                    <div style={styles.fieldFull}>
                      <span style={styles.label}>After Photo URL</span>
                      <input
                        type="text"
                        style={styles.input}
                        value={returnPhotoUrl}
                        onChange={(e) => setReturnPhotoUrl(e.target.value)}
                        placeholder="URL of return condition photo"
                      />
                    </div>
                  </div>
                  <div style={styles.signatureBox}>
                    <span style={styles.label}>Staff Return Signature</span>
                    <SignCanvas
                      onSign={(d) => setStaffSignature(d)}
                      label="Staff"
                    />
                  </div>
                  <button
                    className="rental-submit no-print"
                    style={{
                      ...styles.submitBtn,
                      ...(staffSignature
                        ? {}
                        : styles.submitBtnDisabled),
                    }}
                    disabled={!staffSignature || submitting}
                    onClick={handleReturn}
                    type="button"
                  >
                    {submitting ? "Processing..." : "Complete Return"}
                  </button>
                </section>
              </div>
            )}

            {/* Guest Sign Button */}
            {!isStaff && (
              <button
                className="rental-submit no-print"
                style={{
                  ...styles.submitBtn,
                  ...(canSign ? {} : styles.submitBtnDisabled),
                }}
                disabled={!canSign}
                onClick={handleSign}
                type="button"
              >
                {submitting ? "Submitting..." : "Sign Rental Agreement"}
              </button>
            )}

            {/* Legal text */}
            <div style={styles.legalBox}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700 }}>
                Legal Disclaimer
              </p>
              <p style={{ margin: 0 }}>
                This agreement records the checkout and return of equipment.
                Liability for damage or loss is subject to applicable Maldivian
                law and Thoddoo Marine policies.
              </p>
              <p style={{ margin: "0.4rem 0 0", fontStyle: "italic" }}>
                NOTICE: This form should be reviewed under applicable Maldivian
                law.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
