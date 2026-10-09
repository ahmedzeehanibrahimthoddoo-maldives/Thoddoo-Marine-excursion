"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import SignCanvas from "@/app/rental/[token]/SignCanvas";

interface Participant {
  choice_token: string;
  display_name: string;
  participant_type: string;
  consent_status: string;
}

interface PrefilledDetails {
  guest_name: string;
  nationality: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  activity_name: string;
  is_minor: boolean;
  guardian_name: string | null;
  consent_version: string | null;
  consent_text: string | null;
}

type Step =
  | "select"
  | "verify"
  | "details"
  | "consent"
  | "success"
  | "error"
  | "expired"
  | "revoked";

const swimmingOptions = [
  { value: "", label: "Select your swimming ability" },
  { value: "non-swimmer", label: "Non-swimmer" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced / Strong swimmer" },
] as const;

/**
 * Development-only safe diagnostic logger.
 * Logs only the operation name and the Postgres error code.
 * Never logs: tokens, room numbers, phone digits, guest data,
 * raw database error messages, or signature data.
 */
function checkinDiag(op: string, err?: { code?: string } | null): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (err && err.code) {
    console.warn('[checkin]', op, { code: err.code });
  } else {
    console.warn('[checkin]', op);
  }
}

export default function CheckinClient({ token }: { token: string }) {
  const supabase = createClient();

  const [step, setStep] = useState<Step>("select");
  const [activityName, setActivityName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [details, setDetails] = useState<PrefilledDetails | null>(null);

  // Consent form state
  const [swimmingAbility, setSwimmingAbility] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medications, setMedications] = useState("");
  const [recentInjuries, setRecentInjuries] = useState("");
  const [isPregnant, setIsPregnant] = useState(false);
  const [safetyBriefing, setSafetyBriefing] = useState(false);
  const [lifeJacket, setLifeJacket] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [consentTextRead, setConsentTextRead] = useState(false);
  const [guestSignature, setGuestSignature] = useState<string | null>(null);
  const [witnessName, setWitnessName] = useState("");
  const [witnessSignature, setWitnessSignature] = useState<string | null>(null);
  const [parentGuardianName, setParentGuardianName] = useState("");
  const [parentGuardianRelationship, setParentGuardianRelationship] = useState("");
  const [parentGuardianSig, setParentGuardianSig] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Walk-in state
  const [isWalkin, setIsWalkin] = useState(false);
  const [walkinName, setWalkinName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");

  const canSubmit =
    consentTextRead &&
    safetyBriefing &&
    lifeJacket &&
    riskAcknowledged &&
    guestSignature &&
    (!details?.is_minor ||
      (parentGuardianName.trim().length > 0 &&
       parentGuardianRelationship.trim().length > 0 &&
       !!parentGuardianSig)) &&
    !submitting;

  // Step 1: Load participants
  useEffect(() => {
    async function load() {
      const { data, error: rpcError } = await supabase.rpc("get_checkin_participants", {
        p_token: token,
      });
      if (rpcError) {
        checkinDiag('get_checkin_participants', rpcError);
        setStep("error");
        setError("Unable to load check-in details. Please try again.");
        return;
      }
      if (!data) {
        checkinDiag('get_checkin_participants:null_response');
        setStep("error");
        setError("Unable to load check-in details. Please try again.");
        return;
      }
      const res = data as unknown as {
        error?: string;
        message?: string;
        activity_name?: string;
        is_walkin?: boolean;
        participants?: Participant[];
        expires_at?: string;
      };

      if (res.error) {
        if (res.error === "expired") {
          setStep("expired");
          setError("This check-in link is invalid or has expired. Please ask staff for a new QR code.");
        } else if (res.error === "revoked") {
          setStep("revoked");
          setError("This check-in link is invalid or has expired. Please ask staff for a new QR code.");
        } else if (res.error === "rate_limited") {
          setStep("error");
          setError("This check-in link is invalid or has expired. Please ask staff for a new QR code.");
        } else {
          setStep("error");
          setError("This check-in link is invalid or has expired. Please ask staff for a new QR code.");
        }
        return;
      }

      setActivityName(res.activity_name || "");
      if (res.is_walkin) {
        setIsWalkin(true);
        setStep("verify");
      } else {
        setParticipants(res.participants || []);
        if (!res.participants || res.participants.length === 0) {
          setStep("error");
          setError("No participants are ready for check-in. Please ask staff for assistance.");
          return;
        }
        setStep("select");
      }
    }
    load();
  }, [token, supabase]);

  // Step 2: Verify participant
  async function handleVerify() {
    setVerificationError("");
    if (isWalkin) {
      if (!walkinName.trim() || walkinPhone.length < 4) {
        setVerificationError("Please enter your full name and at least 4 digits of your phone number.");
        return;
      }
      const { data, error: rpcError } = await supabase.rpc("verify_walkin_participant", {
        p_token: token,
        p_full_name: walkinName.trim(),
        p_phone_last4: walkinPhone,
      });
      if (rpcError) {
        checkinDiag('verify_walkin_participant', rpcError);
        setVerificationError("A temporary error occurred. Please try again.");
        return;
      }
      if (!data) {
        setVerificationError("Verification failed. Please try again.");
        return;
      }
      const res = data as unknown as {
        error?: string;
        message?: string;
        verification_token?: string;
        participant_name?: string;
        is_minor?: boolean;
      };
      if (res.error) {
        setVerificationError(res.message || "Verification failed.");
        return;
      }
      setVerificationToken(res.verification_token || "");
      await loadPrefilledDetails(res.verification_token || "");
    } else {
      if (!verificationCode.trim()) {
        setVerificationError("Please enter your room number or last 4 digits of your phone.");
        return;
      }
      if (!selectedParticipant) return;
      const { data, error: rpcError } = await supabase.rpc("verify_checkin_participant", {
        p_token: token,
        p_choice_token: selectedParticipant.choice_token,
        p_verification_code: verificationCode.trim(),
      });
      if (rpcError) {
        checkinDiag('verify_checkin_participant', rpcError);
        setVerificationError("A temporary error occurred. Please try again.");
        return;
      }
      if (!data) {
        setVerificationError("Verification failed. Please check your details and try again.");
        return;
      }
      const res = data as unknown as {
        error?: string;
        message?: string;
        verification_token?: string;
        participant_name?: string;
        is_minor?: boolean;
      };
      if (res.error) {
        setVerificationError(res.message || "Verification failed.");
        return;
      }
      setVerificationToken(res.verification_token || "");
      await loadPrefilledDetails(res.verification_token || "");
    }
  }

  async function loadPrefilledDetails(vToken: string) {
    const { data, error: rpcError } = await supabase.rpc("get_checkin_prefilled_details", {
      p_verification_token: vToken,
    });
    if (rpcError) {
      checkinDiag('get_checkin_prefilled_details', rpcError);
      setStep("error");
      setError("A temporary error occurred loading your details. Please try again or ask staff for assistance.");
      return;
    }
    if (!data) {
      setStep("error");
      setError("Failed to load your details. Please try again.");
      return;
    }
    const res = data as unknown as {
      error?: string;
      message?: string;
    } & PrefilledDetails;
    if (res.error) {
      setStep("error");
      setError(res.message || "Failed to load details.");
      return;
    }
    setDetails(res);
    setStep("consent");
  }

  // Step 3: Submit consent
  async function handleSubmit() {
    if (!canSubmit || !verificationToken) return;
    setSubmitting(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("submit_checkin_consent", {
      p_verification_token: verificationToken,
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
      p_parent_guardian_name: details?.is_minor ? parentGuardianName || null : null,
      p_parent_guardian_relationship: details?.is_minor ? parentGuardianRelationship || null : null,
      p_parent_guardian_signature_data_url: details?.is_minor ? parentGuardianSig : null,
    });

    if (rpcError) {
      checkinDiag('submit_checkin_consent', rpcError);
      setError("There was an error submitting your form. Please try again or contact staff.");
      setSubmitting(false);
      return;
    }

    const res = data as unknown as { error?: string; message?: string; consent_id?: string };
    if (res?.error) {
      const errCode = res.error;
      if (errCode === "expired") {
        setError("Your session has expired. Please scan the QR code again.");
      } else if (errCode === "already_used" || errCode === "duplicate") {
        setError("Consent has already been submitted for this activity.");
      } else if (errCode === "template_missing") {
        setError("The consent form is not available right now. Please ask a staff member for help.");
      } else if (errCode === "validation") {
        setError(res.message || "Please check your entries and try again.");
      } else {
        setError("Submission failed. Please try again or contact staff.");
      }
      setSubmitting(false);
      return;
    }

    setStep("success");
    setSubmitting(false);
  }

  // -- Render steps --

  if (step === "error" || step === "expired" || step === "revoked") {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerH1}>
              Check-in
            </h1>
          </div>
          <div style={{ ...styles.body, textAlign: "center" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--ink)", marginBottom: "1rem" }}>
              {error || "This check-in link is invalid or has expired. Please ask staff for a new QR code."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (step === "success" && details) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerH1}>Consent Signed</h1>
          </div>
          <div style={{ ...styles.body, textAlign: "center" }}>
            <div style={styles.successIcon}>&#10003;</div>
            <p style={{ fontSize: "0.95rem", color: "var(--ink)", margin: "0 0 0.5rem" }}>
              Thank you, <strong>{details.guest_name}</strong>. Your consent
              form for <strong>{details.activity_name}</strong> has been
              recorded.
            </p>
            <p style={{ fontSize: "0.85rem", color: "#6b7c8d", margin: 0 }}>
              You may now participate in the activity. Please ask Thoddoo Marine
              staff for your official PDF copy.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (step === "select") {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerH1}>Activity Check-in</h1>
            <p style={styles.headerP}>Thoddoo Marine Excursion Centre</p>
          </div>
          <div style={styles.body}>
            <p style={{ fontSize: "0.9rem", color: "var(--ink)", marginBottom: "1rem" }}>
              <strong>{activityName}</strong>
            </p>
            <p style={{ fontSize: "0.85rem", color: "#6b7c8d", marginBottom: "1rem" }}>
              Select your name below. Your identity is partially hidden for
              privacy.
            </p>
            <div style={styles.participantList}>
              {participants.map((p) => (
                <button
                  key={p.choice_token}
                  style={{
                    ...styles.participantBtn,
                    ...(selectedParticipant?.choice_token === p.choice_token ? styles.participantBtnActive : {}),
                  }}
                  onClick={() => {
                    setSelectedParticipant(p);
                    setStep("verify");
                  }}
                >
                  <span style={styles.participantName}>{p.display_name}</span>
                  <span style={styles.participantType}>{p.participant_type}</span>
                  {p.consent_status === "signed" && (
                    <span style={styles.signedBadge}>Signed</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (step === "verify") {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerH1}>Verify Your Identity</h1>
            <p style={styles.headerP}>Thoddoo Marine Excursion Centre</p>
          </div>
          <div style={styles.body}>
            <p style={{ fontSize: "0.9rem", color: "var(--ink)", marginBottom: "1rem" }}>
              <strong>{activityName}</strong>
            </p>

            {!isWalkin && selectedParticipant && (
              <p style={{ fontSize: "0.88rem", color: "var(--navy)", marginBottom: "0.8rem", fontWeight: 700 }}>
                Guest: {selectedParticipant.display_name}
              </p>
            )}

            {isWalkin ? (
              <>
                <p style={{ fontSize: "0.85rem", color: "#6b7c8d", marginBottom: "0.8rem" }}>
                  Enter your full name and at least 4 digits of your phone number to verify.
                </p>
                <div style={styles.field}>
                  <span style={styles.label}>Full Name</span>
                  <input
                    style={styles.input}
                    value={walkinName}
                    onChange={(e) => setWalkinName(e.target.value)}
                    placeholder="Your full name"
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Phone (last 4+ digits)</span>
                  <input
                    style={styles.input}
                    value={walkinPhone}
                    onChange={(e) => setWalkinPhone(e.target.value)}
                    placeholder="At least 4 digits"
                    maxLength={20}
                  />
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: "0.85rem", color: "#6b7c8d", marginBottom: "0.8rem" }}>
                  Enter your <strong>room number</strong> or the <strong>last 4 digits of your phone number</strong> to verify.
                </p>
                <div style={styles.field}>
                  <span style={styles.label}>Room Number or Phone (last 4 digits)</span>
                  <input
                    style={styles.input}
                    value={verificationCode}
                    onChange={(e) => {
                      setVerificationCode(e.target.value);
                      setVerificationError("");
                    }}
                    placeholder="e.g. 101 or 2699"
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  />
                </div>
              </>
            )}

            {verificationError && (
              <p style={{ color: "#c0392b", fontSize: "0.85rem", marginTop: "0.6rem" }}>
                {verificationError}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.2rem" }}>
              <button style={styles.primaryBtn} onClick={handleVerify}>
                Verify
              </button>
              <button
                style={styles.backBtn}
                onClick={() => {
                  setStep(isWalkin ? "select" : "select");
                  setVerificationCode("");
                  setVerificationError("");
                  setWalkinName("");
                  setWalkinPhone("");
                }}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (step === "consent" && details) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerH1}>Activity Participation Consent</h1>
            <p style={styles.headerP}>Thoddoo Marine Excursion Centre</p>
          </div>
          <div style={styles.body}>
            {error && (
              <div style={styles.errorBox}>{error}</div>
            )}

            {/* Section 1: Guest Information */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>1. Guest Information</h2>
              <div style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Full Name</span>
                  <input style={styles.input} value={details.guest_name} readOnly />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Nationality</span>
                  <input style={styles.input} value={details.nationality || ""} readOnly />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Date of Birth</span>
                  <input
                    style={styles.input}
                    value={
                      details.date_of_birth
                        ? new Date(details.date_of_birth).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : ""
                    }
                    readOnly
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Passport / ID</span>
                  <input style={styles.input} value={details.passport_number || ""} readOnly />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Phone</span>
                  <input style={styles.input} value={details.phone || ""} readOnly />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Hotel / Room</span>
                  <input
                    style={styles.input}
                    value={[details.hotel, details.room_number].filter(Boolean).join(" / ") || ""}
                    readOnly
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Emergency Contact */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>2. Emergency Contact</h2>
              <div style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Contact Name</span>
                  <input style={styles.input} value={details.emergency_contact_name || ""} readOnly />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Contact Phone</span>
                  <input style={styles.input} value={details.emergency_contact_phone || ""} readOnly />
                </div>
              </div>
            </section>

            {/* Section 3: Activity */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>3. Activity Details</h2>
              <div style={styles.row}>
                <div style={styles.field}>
                  <span style={styles.label}>Activity</span>
                  <input style={styles.input} value={details.activity_name} readOnly />
                </div>
              </div>
            </section>

            {/* Section 4: Consent Terms */}
            {details.consent_text && (
              <section style={styles.section}>
                <h2 style={styles.sectionTitle}>4. Consent Terms</h2>
                <p style={{ fontSize: "0.78rem", color: "#6b7c8d", marginBottom: "0.6rem" }}>
                  Version: <strong>{details.consent_version || "unknown"}</strong>
                </p>
                <div style={styles.consentTextBox}>
                  {details.consent_text}
                </div>
                <div style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    style={styles.checkboxInput}
                    checked={consentTextRead}
                    onChange={(e) => setConsentTextRead(e.target.checked)}
                    id="consentTextRead"
                  />
                  <label htmlFor="consentTextRead" style={styles.checkboxLabel}>
                    I have read and agree to the complete Activity Consent &amp; Liability Waiver above.{" "}
                    <span style={{ color: "#c0392b" }}>*</span>
                  </label>
                </div>
              </section>
            )}

            {/* Section 5: Medical Information */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>5. Medical Information</h2>
              <div style={styles.row}>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Swimming Ability</span>
                  <select
                    style={styles.select}
                    value={swimmingAbility}
                    onChange={(e) => setSwimmingAbility(e.target.value)}
                  >
                    {swimmingOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Known Medical Conditions</span>
                  <textarea
                    style={styles.textarea}
                    value={medicalConditions}
                    onChange={(e) => setMedicalConditions(e.target.value)}
                    placeholder="E.g. asthma, heart condition, diabetes..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Allergies</span>
                  <textarea
                    style={styles.textarea}
                    value={allergies}
                    onChange={(e) => setAllergies(e.target.value)}
                    placeholder="List any allergies..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Current Medications</span>
                  <textarea
                    style={styles.textarea}
                    value={medications}
                    onChange={(e) => setMedications(e.target.value)}
                    placeholder="List current medications..."
                  />
                </div>
                <div style={styles.fieldFull}>
                  <span style={styles.label}>Recent Injuries or Surgeries</span>
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
                    <label htmlFor="isPregnant" style={styles.checkboxLabel}>
                      I am currently pregnant
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 6: Safety Acknowledgements */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>6. Safety Acknowledgements</h2>
              <div style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  style={styles.checkboxInput}
                  checked={safetyBriefing}
                  onChange={(e) => setSafetyBriefing(e.target.checked)}
                  id="safetyBriefing"
                />
                <label htmlFor="safetyBriefing" style={styles.checkboxLabel}>
                  I confirm I have received and understood the safety briefing.{" "}
                  <span style={{ color: "#c0392b" }}>*</span>
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
                  I confirm I will wear the provided life jacket / safety equipment.{" "}
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
                  I acknowledge that water sports carry inherent risks including drowning, injury, and
                  property damage. I voluntarily assume all risks.{" "}
                  <span style={{ color: "#c0392b" }}>*</span>
                </label>
              </div>
            </section>

            {/* Section 7: Photo Consent */}
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
                  I consent to photographs or video recordings of me during this activity for
                  Thoddoo Marine Excursion&apos; promotional purposes.
                </label>
              </div>
            </section>

            {/* Section 8: Minor (if applicable) */}
            {details.is_minor && (
              <section style={styles.section}>
                <h2 style={styles.sectionTitle}>8. Parent / Guardian Consent</h2>
                <p style={{ fontSize: "0.82rem", color: "#6b7c8d", marginBottom: "0.6rem" }}>
                  As the participant is under 18, a parent or legal guardian must sign below.
                </p>
                <div style={styles.field}>
                  <span style={styles.label}>Parent / Guardian Full Name</span>
                  <input
                    style={styles.input}
                    value={parentGuardianName}
                    onChange={(e) => setParentGuardianName(e.target.value)}
                    placeholder="Enter parent or guardian name"
                  />
                </div>
                <div style={styles.field}>
                  <span style={styles.label}>Relationship to Minor</span>
                  <input
                    style={styles.input}
                    value={parentGuardianRelationship}
                    onChange={(e) => setParentGuardianRelationship(e.target.value)}
                    placeholder="e.g. Parent, Legal Guardian"
                  />
                </div>
                <div style={styles.signatureBox}>
                  <span style={styles.label}>Parent / Guardian Signature</span>
                  <SignCanvas onSign={(d) => setParentGuardianSig(d)} label="Parent/Guardian" />
                </div>
              </section>
            )}

            {/* Section 9: Guest Signature */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>
                {details.is_minor ? "9. Participant Signature" : "8. Participant Signature"}
              </h2>
              <p style={{ fontSize: "0.82rem", color: "#6b7c8d", marginBottom: "0.6rem" }}>
                Please sign below to confirm your agreement.
              </p>
              <div style={styles.signatureBox}>
                <SignCanvas onSign={(d) => setGuestSignature(d)} label="Guest" />
              </div>
            </section>

            {/* Section 10: Witness */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>
                {details.is_minor ? "10. Staff / Witness" : "9. Staff / Witness"}
              </h2>
              <div style={styles.field}>
                <span style={styles.label}>Witness Name</span>
                <input
                  style={styles.input}
                  value={witnessName}
                  onChange={(e) => setWitnessName(e.target.value)}
                  placeholder="Staff member name"
                />
              </div>
              <div style={styles.signatureBox}>
                <span style={styles.label}>Witness Signature</span>
                <SignCanvas onSign={(d) => setWitnessSignature(d)} label="Witness" />
              </div>
            </section>

            {/* Legal Disclaimer */}
            <div style={styles.legalBox}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700 }}>Legal Disclaimer</p>
              <p style={{ margin: "0 0 0.4rem" }}>
                This form records your participation agreement. It does not constitute a blanket
                waiver of liability. Final liability wording should be reviewed under applicable
                Maldivian law.
              </p>
              <p style={{ margin: 0, fontStyle: "italic" }}>
                NOTICE: This form should be reviewed under applicable Maldivian law.
              </p>
            </div>

            {/* Submit */}
            <button
              style={{
                ...styles.submitBtn,
                opacity: canSubmit ? 1 : 0.55,
                cursor: canSubmit ? "pointer" : "not-allowed",
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
    );
  }

  // Loading
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={{ ...styles.body, textAlign: "center", padding: "3rem 2rem" }}>
          <p style={{ fontSize: "0.95rem", color: "#6b7c8d" }}>Loading...</p>
        </div>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    fontFamily: "Arial, Helvetica, sans-serif",
    padding: "1.5rem 1rem 3rem",
  },
  card: {
    maxWidth: 700,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
    overflow: "hidden",
  },
  header: {
    background: "linear-gradient(135deg, var(--navy), var(--blue))",
    color: "#fff",
    padding: "2rem 2rem 1.5rem",
    textAlign: "center" as const,
  },
  headerH1: {
    fontSize: "1.4rem",
    margin: 0,
    fontWeight: 800,
  },
  headerP: {
    margin: "0.4rem 0 0",
    opacity: 0.85,
    fontSize: "0.85rem",
  },
  body: {
    padding: "1.5rem 2rem 2rem",
  },
  section: {
    marginBottom: "1.8rem",
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 800,
    color: "var(--navy)",
    borderBottom: "2px solid var(--cyan)",
    paddingBottom: "0.4rem",
    marginBottom: "1rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.8rem",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
    marginBottom: "0.6rem",
  },
  fieldFull: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
    gridColumn: "1 / -1",
  },
  label: {
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "var(--ink)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.02em",
  },
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
  },
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
  },
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
  },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.6rem",
    padding: "0.6rem 0",
  },
  checkboxInput: {
    marginTop: 3,
    flexShrink: 0,
    width: 18,
    height: 18,
    accentColor: "var(--blue)",
  },
  checkboxLabel: {
    fontSize: "0.85rem",
    lineHeight: 1.4,
    color: "var(--ink)",
    cursor: "pointer",
  },
  signatureBox: {
    border: "1.5px solid #dde6ef",
    borderRadius: 12,
    padding: "0.75rem",
    marginTop: "0.4rem",
    background: "#f9fbfd",
  },
  submitBtn: {
    width: "100%",
    background: "linear-gradient(135deg, var(--blue), var(--cyan))",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    padding: "0.9rem 1.5rem",
    fontSize: "1.05rem",
    fontWeight: 800,
    fontFamily: "inherit",
    letterSpacing: "0.02em",
    textTransform: "uppercase" as const,
    marginTop: "0.5rem",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, var(--blue), var(--cyan))",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "0.6rem 1.5rem",
    fontSize: "0.9rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  backBtn: {
    background: "#f0f7ff",
    color: "var(--blue)",
    border: "1.5px solid #c8ddf0",
    borderRadius: 10,
    padding: "0.6rem 1.5rem",
    fontSize: "0.9rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  errorBox: {
    background: "#f8d7da",
    color: "#842029",
    borderRadius: 10,
    padding: "0.7rem 1rem",
    marginBottom: "1rem",
    fontSize: "0.85rem",
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "#d4edda",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 1.2rem",
    fontSize: "1.8rem",
    color: "#155724",
  },
  legalBox: {
    background: "#f0f7ff",
    border: "1px solid #c8ddf0",
    borderRadius: 12,
    padding: "1rem 1.2rem",
    fontSize: "0.78rem",
    lineHeight: 1.5,
    color: "#3a5a7c",
    marginTop: "1.2rem",
  },
  consentTextBox: {
    background: "#f9fbfd",
    border: "1px solid #dde6ef",
    borderRadius: 12,
    padding: "1rem 1.2rem",
    fontSize: "0.82rem",
    lineHeight: 1.6,
    color: "var(--ink)",
    whiteSpace: "pre-wrap" as const,
    maxHeight: 400,
    overflowY: "auto" as const,
    marginBottom: "0.6rem",
  },
  participantList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
  },
  participantBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.8rem",
    padding: "0.9rem 1rem",
    background: "#f9fbfd",
    border: "1.5px solid #dde6ef",
    borderRadius: 12,
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "inherit",
    fontSize: "0.95rem",
    transition: "border-color 0.15s, background 0.15s",
  },
  participantBtnActive: {
    borderColor: "var(--blue)",
    background: "#f0f7ff",
  },
  participantName: {
    fontWeight: 700,
    color: "var(--navy)",
    flex: 1,
  },
  participantType: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#6b7c8d",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  signedBadge: {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#155724",
    background: "#d4edda",
    padding: "0.15rem 0.5rem",
    borderRadius: 6,
  },
};
