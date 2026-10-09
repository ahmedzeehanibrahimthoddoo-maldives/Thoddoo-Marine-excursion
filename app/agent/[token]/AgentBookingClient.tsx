"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { sanitizeWalkinItemsV2 } from "@/lib/sanitize";
import SignCanvas from "@/app/rental/[token]/SignCanvas";
import { EMAIL_REQUIRED_MESSAGE, isValidEmail } from "@/lib/email";

interface AgentActivity {
  id: string;
  name: string;
  category: string;
  location: string;
  durationMinutes: number;
  image: string;
}

interface AgentBookingClientProps {
  token: string;
  agentName: string;
  activities: AgentActivity[];
}

interface AgentItemDraft {
  key: string;
  activityId: string;
  activityName: string;
  category: string;
  bookingDate: string;
  preferredTime: string;
}

interface AgentParticipantDraft {
  key: string;
  fullName: string;
  participantType: "adult" | "child";
  guardianName: string;
  guardianRelationship: string;
}

// One server-side participant row returned by get_walkin_group_participants.
// choice_token is the per-participant auth key for consent signing.
interface AgentGroupParticipant {
  participant_id: string;
  full_name: string;
  participant_type: "adult" | "child";
  choice_token: string;
  consent_status: string;
  guardian_name?: string | null;
}

interface ParticipantConsentDraft {
  nationality: string;
  dateOfBirth: string;
  passportNumber: string;
  emergencyName: string;
  emergencyPhone: string;
  swimmingAbility: string;
  medicalConditions: string;
  allergies: string;
  medications: string;
  recentInjuries: string;
  isPregnant: boolean;
  safetyBriefing: boolean;
  lifeJacket: boolean;
  riskAcknowledged: boolean;
  photoConsent: boolean;
  consentTextRead: boolean;
  signature: string | null;
  witnessName: string;
  witnessSignature: string | null;
  guardianName: string;
  guardianRelationship: string;
  guardianSignature: string | null;
}

interface AgentItemResult {
  booking_ref: string;
  activity_name: string;
  booking_date: string;
  preferred_time?: string | null;
  guest_count: number;
}

interface AgentGroupResult {
  group_ref: string;
  guest_name: string;
  agent_name: string;
  needs_per_participant_details: boolean;
  items: AgentItemResult[];
}

// Shared party cap from the walk-in wizard: max 50 pax per request (076 enforces
// the same number server-side).
const MAX_PARTY = 50;
// The link stores at most 8 trips (createAgentBookingLink slices to 8).
const MAX_GROUP_ITEMS = 8;

export default function AgentBookingClient({
  token,
  agentName,
  activities,
}: AgentBookingClientProps) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [groupResult, setGroupResult] = useState<AgentGroupResult | null>(null);
  const signAllGuard = useRef(false);

  const [groupConsentDone, setGroupConsentDone] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<AgentGroupParticipant[] | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentText, setConsentText] = useState<string | null>(null);
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [consentByToken, setConsentByToken] = useState<Record<string, ParticipantConsentDraft>>({});
  const [signedTokens, setSignedTokens] = useState<Record<string, boolean>>({});
  const [signingAll, setSigningAll] = useState(false);
  const [consentFieldErrors, setConsentFieldErrors] = useState<Record<string, string>>({});

  // Every trip the agent quoted is pre-selected; the guest drops the ones they
  // don't want and sets a date for each one they keep.
  const [items, setItems] = useState<AgentItemDraft[]>(() =>
    activities.slice(0, MAX_GROUP_ITEMS).map((a, i) => ({
      key: `${i}-${a.id}`,
      activityId: a.id,
      activityName: a.name,
      category: a.category,
      bookingDate: "",
      preferredTime: "",
    }))
  );

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("+960");
  const [guestEmail, setGuestEmail] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [extraParticipants, setExtraParticipants] = useState<AgentParticipantDraft[]>(() =>
    Array.from({ length: Math.max(0, 2 - 1) }, () => blankParticipant())
  );
  const [hotelName, setHotelName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const isGroup = items.length > 1;
  // Lead is always an adult; children come from the extra participant rows.
  const childrenCount = extraParticipants.filter((p) => p.participantType === "child").length;
  const adultsCount = partySize - childrenCount;

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function blankParticipant(): AgentParticipantDraft {
    return {
      key: crypto.randomUUID(),
      fullName: "",
      participantType: "adult",
      guardianName: "",
      guardianRelationship: "",
    };
  }

  function setParty(n: number) {
    const clamped = Math.min(MAX_PARTY, Math.max(1, Number.isFinite(n) ? n : 1));
    setPartySize(clamped);
    setExtraParticipants((prev) => {
      const target = Math.max(0, clamped - 1);
      const next = prev.slice(0, target);
      while (next.length < target) next.push(blankParticipant());
      return next;
    });
  }

  function patchParticipant(key: string, patch: Partial<AgentParticipantDraft>) {
    setExtraParticipants((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...patch } : p))
    );
  }

  // One participant row per person, ALWAYS including the lead — a solo guest
  // still needs a participant row so they get a choice_token and personally sign
  // the waiver, matching the walk-in flow (064).
  function partyRows(): Array<{
    full_name: string;
    participant_type: "adult" | "child";
    guardian_name: string | null;
    guardian_relationship: string | null;
  }> {
    const rows: Array<{
      full_name: string;
      participant_type: "adult" | "child";
      guardian_name: string | null;
      guardian_relationship: string | null;
    }> = [
      {
        full_name: guestName.trim(),
        participant_type: "adult",
        guardian_name: null,
        guardian_relationship: null,
      },
    ];
    if (partySize > 1) {
      rows.push(
        ...extraParticipants.map((p) => ({
          full_name: p.fullName.trim(),
          participant_type: p.participantType,
          guardian_name: p.guardianName.trim() || null,
          guardian_relationship: p.guardianRelationship.trim() || null,
        }))
      );
    }
    return rows;
  }

  // ---------- per-participant consent ----------

  function blankConsent(): ParticipantConsentDraft {
    return {
      nationality: "",
      dateOfBirth: "",
      passportNumber: "",
      emergencyName: "",
      emergencyPhone: "",
      swimmingAbility: "",
      medicalConditions: "",
      allergies: "",
      medications: "",
      recentInjuries: "",
      isPregnant: false,
      safetyBriefing: false,
      lifeJacket: false,
      riskAcknowledged: false,
      photoConsent: false,
      consentTextRead: false,
      signature: null,
      witnessName: "",
      witnessSignature: null,
      guardianName: "",
      guardianRelationship: "",
      guardianSignature: null,
    };
  }

  function consentFor(p: AgentGroupParticipant): ParticipantConsentDraft {
    return consentByToken[p.choice_token] ?? blankConsent();
  }

  function patchConsent(token: string, patch: Partial<ParticipantConsentDraft>) {
    setConsentByToken((prev) => ({
      ...prev,
      [token]: { ...(prev[token] ?? blankConsent()), ...patch },
    }));
  }

  // Load the participant roster + active consent text right after the booking is
  // placed, then sign each participant's waiver one at a time.
  useEffect(() => {
    if (!groupResult || groupConsentDone) return;
    let mounted = true;
    const supabase = createClient();
    setConsentLoading(true);
    setConsentError(null);
    (async () => {
      const [rosterRes, templateRes] = await Promise.all([
        supabase.rpc("get_walkin_group_participants", {
          p_group_ref: groupResult.group_ref,
        }),
        supabase.rpc("get_active_consent_template", { p_consent_type: "activity" }),
      ]);
      if (!mounted) return;

      if (templateRes.data) {
        const t = templateRes.data as
          | { version?: string; consent_text?: string }
          | null;
        if (t?.consent_text) {
          setConsentText(t.consent_text);
          setConsentVersion(t.version || null);
        }
      }

      let roster: AgentGroupParticipant[] = [];
      if (rosterRes.error || !rosterRes.data) {
        setConsentError("We couldn't load the participant list. Please refresh.");
      } else {
        const r = rosterRes.data as {
          bookings?: Array<{
            participants?: AgentGroupParticipant[];
          }>;
        };
        // Consent is per PERSON, not per booking. The submit RPC writes the same
        // party into every activity's booking, so dedupe the flattened roster by
        // participant identity before the signing pass.
        const seen = new Set<string>();
        roster = (r.bookings ?? [])
          .flatMap((b) => b.participants ?? [])
          .filter((p) => !!p.choice_token)
          .filter((p) => {
            const key = `${p.full_name}\u0000${p.participant_type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      }

      if (roster.length === 0) {
        // Never bypass the consent/liability gate — surface the error instead.
        setConsentError("We couldn't load the participant list. Please refresh or ask staff.");
        setGroupParticipants(null);
      } else {
        setGroupParticipants(roster);
      }
      setConsentLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [groupResult?.group_ref, groupConsentDone]);

  function validateParticipantConsent(
    p: AgentGroupParticipant,
    d: ParticipantConsentDraft
  ): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!d.consentTextRead) errors.consentTextRead = "You must read and agree to the waiver.";
    if (!d.nationality.trim()) errors.nationality = "Nationality is required.";
    if (!d.dateOfBirth) errors.dateOfBirth = "Date of birth is required.";
    if (!d.emergencyName.trim()) errors.emergencyName = "Emergency contact name is required.";
    if (d.emergencyPhone.replace(/[^0-9]/g, "").length < 7)
      errors.emergencyPhone = "Enter a valid emergency phone number.";
    if (!d.safetyBriefing || !d.lifeJacket || !d.riskAcknowledged)
      errors.safety = "All safety acknowledgements are required.";
    if (!d.signature) errors.signature = "Signature is required.";
    if (p.participant_type === "child") {
      if (!d.guardianName.trim()) errors.guardianName = "Guardian name is required.";
      if (!d.guardianRelationship.trim())
        errors.guardianRelationship = "Guardian relationship is required.";
      if (!d.guardianSignature) errors.guardianSignature = "Guardian signature is required.";
    }
    return errors;
  }

  async function signParticipant(p: AgentGroupParticipant): Promise<boolean> {
    const d = consentFor(p);
    const errors = validateParticipantConsent(p, d);
    if (Object.keys(errors).length > 0) {
      setConsentFieldErrors((prev) => ({ ...prev, ...errors }));
      return false;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("submit_walkin_participant_consent", {
      p_choice_token: p.choice_token,
      p_phone: guestPhone.trim(),
      p_nationality: d.nationality.trim() || null,
      p_date_of_birth: d.dateOfBirth || null,
      p_passport_number: d.passportNumber.trim() || null,
      p_emergency_contact_name: d.emergencyName.trim() || null,
      p_emergency_contact_phone: d.emergencyPhone.trim() || null,
      p_swimming_ability: d.swimmingAbility || null,
      p_medical_conditions: d.medicalConditions || null,
      p_allergies: d.allergies || null,
      p_medications: d.medications || null,
      p_recent_injuries: d.recentInjuries || null,
      p_is_pregnant: d.isPregnant,
      p_safety_briefing_confirmed: d.safetyBriefing,
      p_life_jacket_confirmed: d.lifeJacket,
      p_risk_acknowledged: d.riskAcknowledged,
      p_photo_consent: d.photoConsent,
      p_signature_data_url: d.signature,
      p_witness_name: d.witnessName.trim() || null,
      p_witness_signature_data_url: d.witnessSignature,
      p_parent_guardian_name:
        p.participant_type === "child" ? d.guardianName.trim() || null : null,
      p_parent_guardian_relationship:
        p.participant_type === "child" ? d.guardianRelationship.trim() || null : null,
      p_parent_guardian_signature_data_url:
        p.participant_type === "child" ? d.guardianSignature : null,
      p_expected_consent_version: consentVersion,
    });

    if (error) {
      setConsentError("There was an error saving consent. Please try again.");
      return false;
    }
    const res = data as unknown as {
      error?: string;
      message?: string;
      already_signed?: boolean;
      success?: boolean;
    };
    if (res && typeof res === "object" && "error" in res) {
      if (res.error === "terms_updated_refresh_required") {
        window.location.reload();
        return false;
      }
      setConsentError(res.message || "Consent could not be saved. Please try again.");
      return false;
    }
    setSignedTokens((prev) => ({ ...prev, [p.choice_token]: true }));
    setConsentFieldErrors({});
    return true;
  }

  // One signing call per choice_token — iterate the whole roster.
  async function signAllParticipants() {
    if (!groupParticipants || signAllGuard.current || signingAll) return;
    signAllGuard.current = true;
    setSigningAll(true);
    setConsentError(null);
    let failed = false;
    for (const p of groupParticipants) {
      if (signedTokens[p.choice_token]) continue;
      const ok = await signParticipant(p);
      if (!ok) {
        failed = true;
        break;
      }
    }
    if (!failed) setGroupConsentDone(true);
    setSigningAll(false);
    signAllGuard.current = false;
  }

  function patchItem(key: string, patch: Partial<AgentItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)));
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (items.length === 0) {
      errors.items = "Please keep at least one activity.";
    }
    if (!guestName.trim() || guestName.trim().length < 2) {
      errors.guestName = "Please enter your full name.";
    }
    const phoneClean = guestPhone.replace(/[^0-9+]/g, "");
    if (phoneClean.length < 7) {
      errors.guestPhone = "Please enter a valid WhatsApp number with country code.";
    }
    if (!isValidEmail(guestEmail)) {
      errors.guestEmail = EMAIL_REQUIRED_MESSAGE;
    }
    const today = todayStr();
    items.forEach((it, i) => {
      if (!it.bookingDate) {
        errors[`date_${i}`] = "Please select a date.";
      } else if (it.bookingDate < today) {
        errors[`date_${i}`] = "Date cannot be in the past.";
      }
    });
    setParty(partySize);
    if (partySize > 1) {
      extraParticipants.forEach((p, idx) => {
        if (!p.fullName.trim() || p.fullName.trim().length < 2) {
          errors[`participant_${idx}_fullName`] = "Please enter every participant's full name.";
        }
        if (p.participantType === "child" && !p.guardianName.trim()) {
          errors[`participant_${idx}_guardianName`] =
            "A guardian name is required for each child participant.";
        }
        if (p.participantType === "child" && !p.guardianRelationship.trim()) {
          errors[`participant_${idx}_guardianRelationship`] =
            "A guardian relationship is required for each child participant.";
        }
      });
    }
    if (!agreed) errors.agreed = "You must agree to the terms to proceed.";

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    startTransition(async () => {
      try {
        const supabase = createClient();

        // sanitizeWalkinItemsV2 is reused purely as the validator — it is the
        // shared item/participant shape cap. The pricing_option_label it emits is
        // deliberately DROPPED below: the agent quoted the rate, the guest never
        // sees or sends one, and submit_agent_booking reads the price from the
        // link server-side (076).
        const draftItems = items.slice(0, MAX_GROUP_ITEMS).map((it) => ({
          activity_id: it.activityId,
          booking_date: it.bookingDate,
          preferred_time: it.preferredTime || null,
          participants: partyRows(),
        }));
        const sanitized = sanitizeWalkinItemsV2({ items: draftItems });
        if (sanitized.items.length === 0) {
          setFormError("Please check the selected activities and try again.");
          return;
        }
        const { data, error } = await supabase.rpc("submit_agent_booking", {
          p_token: token,
          p_items: sanitized.items.map((it) => ({
            activity_id: it.activity_id,
            booking_date: it.booking_date,
            preferred_time: it.preferred_time || null,
            participants: it.participants,
          })),
          p_guest_name: guestName.trim(),
          p_guest_phone: guestPhone.trim(),
          p_guest_email: guestEmail.trim(),
          p_adults: adultsCount,
          p_children: childrenCount,
          p_hotel_name: hotelName || null,
          p_room_number: roomNumber || null,
          p_pickup_location: pickupLocation || null,
          p_special_requests: specialRequests || null,
          p_guest_agreed: agreed,
        });

        if (error) {
          setFormError(error.message || "Submission failed. Please try again.");
          return;
        }
        if (data && typeof data === "object" && "error" in data) {
          const er = data as { error: string; message?: string };
          setFormError(er.message || er.error);
          return;
        }

        const r = data as Record<string, unknown>;
        setGroupResult({
          group_ref: (r.group_ref as string) || "",
          guest_name: (r.guest_name as string) || guestName.trim(),
          agent_name: (r.agent_name as string) || agentName,
          needs_per_participant_details: !!r.needs_per_participant_details,
          items: ((r.items as unknown[]) || []).map((raw) => {
            const it = raw as Record<string, unknown>;
            return {
              booking_ref: (it.booking_ref as string) || "",
              activity_name: (it.activity_name as string) || "",
              booking_date: (it.booking_date as string) || "",
              preferred_time: (it.preferred_time as string | null) || null,
              guest_count: (it.guest_count as number) || partySize,
            };
          }),
        });
      } catch {
        setFormError("Something went wrong. Please try again.");
      }
    });
  }

  if (activities.length === 0) {
    return (
      <div className="walkinCard">
        <p className="walkinMock">
          This booking link has no trips attached to it. Please ask your agent for a
          new QR code.
        </p>
        <div className="walkinMockButtons">
          <a
            href="https://wa.me/9609472110?text=Hi!%20My%20agent%20booking%20link%20has%20no%20trips%20attached."
            target="_blank"
            rel="noreferrer"
            className="walkinSubmit"
          >
            Message us on WhatsApp
          </a>
        </div>
      </div>
    );
  }

  if (groupResult && groupConsentDone) {
    return (
      <div className="walkinCard">
        <div className="walkinSuccess">
          <div className="walkinSuccessIcon">✓</div>
          <h2>You&apos;re booked!</h2>
          <p className="walkinRef">
            Group reference: <strong>{groupResult.group_ref}</strong>
          </p>
          <p className="walkinSuccessMsg">
            Your booking for {groupResult.items.length} activit
            {groupResult.items.length !== 1 ? "ies" : "y"} has been received and every
            participant&apos;s consent has been signed.
          </p>
          <p className="walkinPayAtCounter" role="status">
            Pay {groupResult.agent_name} on arrival
          </p>
          <div className="walkinDetails">
            <div>
              <span>Lead guest</span>
              <strong>{groupResult.guest_name}</strong>
            </div>
            {groupResult.items.map((it) => (
              <div key={it.booking_ref}>
                <span>{it.activity_name}</span>
                <strong>
                  {it.booking_date}
                  {it.preferred_time ? ` · ${it.preferred_time}` : ""} · {it.booking_ref}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Per-participant consent step. Every participant signs individually — one RPC
  // call per choice_token — so no one can be signed off by the lead guest.
  if (groupResult && !groupConsentDone) {
    const fe = (tok: string, key: string): string | undefined =>
      consentFieldErrors[`${tok}.${key}`];
    return (
      <div className="walkinCard">
        <div className="walkinCardHead">
          <h2>Consent &amp; Liability Waiver</h2>
          <p>
            Every participant must read and sign the waiver for each activity —
            children sign via a parent or guardian.
          </p>
        </div>

        {consentError && <div className="walkinError">{consentError}</div>}

        {consentLoading ? (
          <p className="walkinMock">Loading participants…</p>
        ) : groupParticipants && groupParticipants.length > 0 ? (
          <div className="walkinConsentList">
            <div className="walkinTotal" style={{ marginTop: 0 }}>
              <span>Group {groupResult.group_ref}</span>
              <strong>
                {groupParticipants.filter((p) => signedTokens[p.choice_token]).length}/
                {groupParticipants.length} signed
              </strong>
            </div>

            {groupParticipants.map((p) => {
              const d = consentFor(p);
              const signed = !!signedTokens[p.choice_token];
              return (
                <div key={p.choice_token} className="walkinConsentCardItem">
                  <div className="walkinItemHead">
                    <span className="walkinItemTitle">
                      {p.full_name}{" "}
                      <em>{p.participant_type === "child" ? "child" : "adult"}</em>
                    </span>
                    {signed && <span className="walkinLeadTag">signed</span>}
                  </div>

                  <div className="walkinRow">
                    <label className="walkinField">
                      <span>Nationality</span>
                      <input
                        type="text"
                        value={d.nationality}
                        placeholder="e.g. Italian"
                        disabled={signed}
                        onChange={(e) => {
                          patchConsent(p.choice_token, { nationality: e.target.value });
                          setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.nationality`]: "" }));
                        }}
                      />
                      {fe(p.choice_token, "nationality") && (
                        <small className="walkinFieldError">{fe(p.choice_token, "nationality")}</small>
                      )}
                    </label>
                    <label className="walkinField">
                      <span>Date of Birth</span>
                      <input
                        type="date"
                        value={d.dateOfBirth}
                        disabled={signed}
                        max={todayStr()}
                        onChange={(e) => {
                          patchConsent(p.choice_token, { dateOfBirth: e.target.value });
                          setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.dateOfBirth`]: "" }));
                        }}
                      />
                      {fe(p.choice_token, "dateOfBirth") && (
                        <small className="walkinFieldError">{fe(p.choice_token, "dateOfBirth")}</small>
                      )}
                    </label>
                  </div>

                  <div className="walkinRow">
                    <label className="walkinField">
                      <span>Passport / ID (optional)</span>
                      <input
                        type="text"
                        value={d.passportNumber}
                        disabled={signed}
                        onChange={(e) =>
                          patchConsent(p.choice_token, { passportNumber: e.target.value })
                        }
                      />
                    </label>
                    <label className="walkinField">
                      <span>Swimming Ability</span>
                      <select
                        value={d.swimmingAbility}
                        disabled={signed}
                        onChange={(e) =>
                          patchConsent(p.choice_token, { swimmingAbility: e.target.value })
                        }
                      >
                        <option value="">Select</option>
                        <option value="non-swimmer">Non-swimmer</option>
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </label>
                  </div>

                  <div className="walkinRow">
                    <label className="walkinField">
                      <span>Emergency Contact</span>
                      <input
                        type="text"
                        value={d.emergencyName}
                        placeholder="Emergency contact name"
                        disabled={signed}
                        onChange={(e) => {
                          patchConsent(p.choice_token, { emergencyName: e.target.value });
                          setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.emergencyName`]: "" }));
                        }}
                      />
                      {fe(p.choice_token, "emergencyName") && (
                        <small className="walkinFieldError">{fe(p.choice_token, "emergencyName")}</small>
                      )}
                    </label>
                    <label className="walkinField">
                      <span>Emergency Phone</span>
                      <input
                        type="tel"
                        value={d.emergencyPhone}
                        placeholder="e.g. +960 123 4567"
                        disabled={signed}
                        onChange={(e) => {
                          patchConsent(p.choice_token, { emergencyPhone: e.target.value });
                          setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.emergencyPhone`]: "" }));
                        }}
                      />
                      {fe(p.choice_token, "emergencyPhone") && (
                        <small className="walkinFieldError">{fe(p.choice_token, "emergencyPhone")}</small>
                      )}
                    </label>
                  </div>

                  <div className="walkinRow">
                    <label className="walkinField walkinConsentWide">
                      <span>Medical Conditions (if any)</span>
                      <input
                        type="text"
                        value={d.medicalConditions}
                        placeholder="E.g. asthma, heart condition…"
                        disabled={signed}
                        onChange={(e) =>
                          patchConsent(p.choice_token, { medicalConditions: e.target.value })
                        }
                      />
                    </label>
                  </div>

                  <div className="walkinConsentChecks">
                    <label>
                      <input
                        type="checkbox"
                        disabled={signed}
                        checked={d.consentTextRead}
                        onChange={(e) => {
                          patchConsent(p.choice_token, { consentTextRead: e.target.checked });
                          setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.consentTextRead`]: "" }));
                        }}
                      />
                      <span>I have read and agree to the full waiver below for {p.full_name}.</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        disabled={signed}
                        checked={d.safetyBriefing}
                        onChange={(e) => patchConsent(p.choice_token, { safetyBriefing: e.target.checked })}
                      />
                      <span>Safety briefing received and understood.</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        disabled={signed}
                        checked={d.lifeJacket}
                        onChange={(e) => patchConsent(p.choice_token, { lifeJacket: e.target.checked })}
                      />
                      <span>I will wear the provided life jacket / safety equipment.</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        disabled={signed}
                        checked={d.riskAcknowledged}
                        onChange={(e) => patchConsent(p.choice_token, { riskAcknowledged: e.target.checked })}
                      />
                      <span>I understand the inherent risks and accept them voluntarily.</span>
                    </label>
                    {fe(p.choice_token, "safety") && (
                      <small className="walkinFieldError">{fe(p.choice_token, "safety")}</small>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        disabled={signed}
                        checked={d.photoConsent}
                        onChange={(e) => patchConsent(p.choice_token, { photoConsent: e.target.checked })}
                      />
                      <span>Photo / video consent for promotional use (optional).</span>
                    </label>
                  </div>

                  {p.participant_type === "child" && (
                    <div className="walkinRow">
                      <label className="walkinField">
                        <span>Parent / Guardian Name</span>
                        <input
                          type="text"
                          value={d.guardianName}
                          disabled={signed}
                          onChange={(e) => {
                            patchConsent(p.choice_token, { guardianName: e.target.value });
                            setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.guardianName`]: "" }));
                          }}
                        />
                        {fe(p.choice_token, "guardianName") && (
                          <small className="walkinFieldError">{fe(p.choice_token, "guardianName")}</small>
                        )}
                      </label>
                      <label className="walkinField">
                        <span>Relationship</span>
                        <input
                          type="text"
                          value={d.guardianRelationship}
                          disabled={signed}
                          placeholder="e.g. Father"
                          onChange={(e) => {
                            patchConsent(p.choice_token, { guardianRelationship: e.target.value });
                            setConsentFieldErrors((prev) => ({ ...prev, [`${p.choice_token}.guardianRelationship`]: "" }));
                          }}
                        />
                        {fe(p.choice_token, "guardianRelationship") && (
                          <small className="walkinFieldError">
                            {fe(p.choice_token, "guardianRelationship")}
                          </small>
                        )}
                      </label>
                    </div>
                  )}

                  <div className="walkinRow">
                    <div className="walkinField">
                      <span>
                        {p.participant_type === "child"
                          ? "Parent / Guardian Signature"
                          : "Participant Signature"}
                      </span>
                      <div className="walkinSigBox">
                        {signed ? (
                          <p className="walkinConsentOk">Signed ✓</p>
                        ) : d.signature || (p.participant_type === "child" && d.guardianSignature) ? (
                          <span className="walkinLeadTag">signature added</span>
                        ) : p.participant_type === "child" ? (
                          <SignCanvas onSign={(dat) => patchConsent(p.choice_token, { guardianSignature: dat })} label="Guardian" />
                        ) : (
                          <SignCanvas onSign={(dat) => patchConsent(p.choice_token, { signature: dat })} label="Guest" />
                        )}
                      </div>
                      {fe(
                        p.choice_token,
                        p.participant_type === "child" ? "guardianSignature" : "signature"
                      ) && (
                        <small className="walkinFieldError">
                          {fe(
                            p.choice_token,
                            p.participant_type === "child" ? "guardianSignature" : "signature"
                          )}
                        </small>
                      )}
                    </div>
                    {!signed && (
                      <div className="walkinField">
                        <span>Witness Name (optional)</span>
                        <input
                          type="text"
                          value={d.witnessName}
                          placeholder="Staff member name"
                          onChange={(e) => patchConsent(p.choice_token, { witnessName: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="walkinMock">No participants found.</p>
        )}

        {consentText && (
          <div className="walkinConsentDoc">
            <div>
              Version: <strong>{consentVersion || "unknown"}</strong>
            </div>
            <pre className="walkinConsentText">{consentText}</pre>
          </div>
        )}

        <button
          type="button"
          className="walkinSubmit"
          disabled={signingAll}
          onClick={signAllParticipants}
        >
          {signingAll
            ? "Signing…"
            : `Sign consent for all ${groupParticipants?.length ?? 0} participant${groupParticipants?.length === 1 ? "" : "s"}`}
        </button>
      </div>
    );
  }

  return (
    <div className="walkinCard">
      <div className="walkinCardHead">
        <h2>Confirm Your Booking</h2>
        <p>
          {agentName} has reserved {items.length} trip{items.length !== 1 ? "s" : ""} for
          you. Set the date for each one, tell us who is coming and sign the waiver —
          the quoted rate is held for you and is confirmed by {agentName}.
        </p>
      </div>

      {formError && <div className="walkinError">{formError}</div>}

      <form className="walkinForm" onSubmit={handleSubmit} noValidate>
        {items.map((it, i) => (
          <div key={it.key} className="walkinItemBlock">
            <div className="walkinItemHead">
              <span className="walkinItemTitle">
                {i + 1}. {it.activityName} {isGroup && <em>{it.category}</em>}
              </span>
              {items.length > 1 && (
                <button type="button" className="walkinItemRemove" onClick={() => removeItem(it.key)}>
                  Remove
                </button>
              )}
            </div>

            <div className="walkinRow">
              <label className="walkinField">
                <span>Date</span>
                <input
                  type="date"
                  value={it.bookingDate}
                  min={todayStr()}
                  onChange={(e) => patchItem(it.key, { bookingDate: e.target.value })}
                />
                {fieldErrors[`date_${i}`] && (
                  <small className="walkinFieldError">{fieldErrors[`date_${i}`]}</small>
                )}
              </label>
              <label className="walkinField">
                <span>Preferred Time</span>
                <input
                  type="time"
                  value={it.preferredTime}
                  onChange={(e) => patchItem(it.key, { preferredTime: e.target.value })}
                />
              </label>
            </div>

            {/* Rate line. Deliberately no number: the agent quoted it off-page. */}
            <div className="walkinTotal" style={{ marginTop: "0.2rem" }}>
              <span>Rate</span>
              <strong>As quoted by {agentName}</strong>
            </div>
          </div>
        ))}

        {fieldErrors.items && <div className="walkinError">{fieldErrors.items}</div>}

        {isGroup && (
          <p className="walkinAddGroup">
            You can remove a trip above — the rest stay reserved. Each trip needs its
            own date and time.
          </p>
        )}

        <label className="walkinField">
          <span>Full Name</span>
          <input
            type="text"
            value={guestName}
            placeholder="e.g. Ahmed Hassan"
            onChange={(e) => setGuestName(e.target.value)}
          />
          {fieldErrors.guestName && (
            <small className="walkinFieldError">{fieldErrors.guestName}</small>
          )}
        </label>

        <label className="walkinField">
          <span>WhatsApp Number</span>
          <input
            type="tel"
            value={guestPhone}
            inputMode="tel"
            onChange={(e) => setGuestPhone(e.target.value)}
          />
          {fieldErrors.guestPhone && (
            <small className="walkinFieldError">{fieldErrors.guestPhone}</small>
          )}
        </label>

        <label className="walkinField">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={guestEmail}
            placeholder="For your invoice and waiver"
            onChange={(e) => setGuestEmail(e.target.value)}
          />
          {fieldErrors.guestEmail && (
            <small className="walkinFieldError">{fieldErrors.guestEmail}</small>
          )}
        </label>

        <label className="walkinField">
          <span>Number of Guests <em>1 – {MAX_PARTY}</em></span>
          <input
            type="number"
            min={1}
            max={MAX_PARTY}
            value={partySize}
            onChange={(e) => setParty(parseInt(e.target.value, 10))}
          />
        </label>

        {partySize === 1 ? (
          <p className="walkinAddGroup">
            Only the lead guest is booked, so they are the sole participant on every activity.
          </p>
        ) : (
          <div className="walkinParty">
            <div className="walkinPartyHead">
              <span className="walkinPartyTitle">
                Who is coming? <em>every guest needs a row (max {MAX_PARTY})</em>
              </span>
            </div>

            <div className="walkinParticipant walkinLeadParticipant">
              <div className="walkinParticipantHead">
                <span className="walkinParticipantTitle">1. Lead guest</span>
                <span className="walkinLeadTag">contact</span>
              </div>
              <div className="walkinRow">
                <div className="walkinLeadField">
                  <span>Full Name</span>
                  <strong>{guestName || "—"}</strong>
                </div>
                <div className="walkinLeadField">
                  <span>Type</span>
                  <strong>Adult</strong>
                </div>
              </div>
            </div>

            {extraParticipants.map((p, idx) => (
              <div key={p.key} className="walkinParticipant">
                <div className="walkinParticipantHead">
                  <span className="walkinParticipantTitle">{idx + 2}. Guest</span>
                </div>
                <div className="walkinRow">
                  <label className="walkinField">
                    <span>Full Name</span>
                    <input
                      type="text"
                      value={p.fullName}
                      placeholder="Participant's full name"
                      onChange={(e) => patchParticipant(p.key, { fullName: e.target.value })}
                    />
                    {fieldErrors[`participant_${idx}_fullName`] && (
                      <small className="walkinFieldError">
                        {fieldErrors[`participant_${idx}_fullName`]}
                      </small>
                    )}
                  </label>
                  <label className="walkinField">
                    <span>Type</span>
                    <select
                      value={p.participantType}
                      onChange={(e) =>
                        patchParticipant(p.key, {
                          participantType: e.target.value === "child" ? "child" : "adult",
                        })
                      }
                    >
                      <option value="adult">Adult</option>
                      <option value="child">Child</option>
                    </select>
                  </label>
                </div>
                {p.participantType === "child" && (
                  <div className="walkinRow">
                    <label className="walkinField">
                      <span>Guardian Name</span>
                      <input
                        type="text"
                        value={p.guardianName}
                        placeholder="Parent / guardian full name"
                        onChange={(e) => patchParticipant(p.key, { guardianName: e.target.value })}
                      />
                      {fieldErrors[`participant_${idx}_guardianName`] && (
                        <small className="walkinFieldError">
                          {fieldErrors[`participant_${idx}_guardianName`]}
                        </small>
                      )}
                    </label>
                    <label className="walkinField">
                      <span>Relationship</span>
                      <input
                        type="text"
                        value={p.guardianRelationship}
                        placeholder="e.g. Father"
                        onChange={(e) =>
                          patchParticipant(p.key, { guardianRelationship: e.target.value })
                        }
                      />
                      {fieldErrors[`participant_${idx}_guardianRelationship`] && (
                        <small className="walkinFieldError">
                          {fieldErrors[`participant_${idx}_guardianRelationship`]}
                        </small>
                      )}
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="walkinRow">
          <label className="walkinField">
            <span>Hotel / Guesthouse</span>
            <input
              type="text"
              value={hotelName}
              placeholder="Optional"
              onChange={(e) => setHotelName(e.target.value)}
            />
          </label>
          <label className="walkinField">
            <span>Room #</span>
            <input
              type="text"
              value={roomNumber}
              placeholder="Optional"
              onChange={(e) => setRoomNumber(e.target.value)}
            />
          </label>
        </div>

        <label className="walkinField">
          <span>Pickup Location</span>
          <input
            type="text"
            value={pickupLocation}
            placeholder="Optional"
            onChange={(e) => setPickupLocation(e.target.value)}
          />
        </label>

        <label className="walkinField">
          <span>Special Requests</span>
          <textarea
            value={specialRequests}
            rows={2}
            placeholder="Optional"
            onChange={(e) => setSpecialRequests(e.target.value)}
          />
        </label>

        <div className="walkinAgree">
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I agree to the{" "}
              <button type="button" className="walkinLink" onClick={() => setTermsOpen((v) => !v)}>
                booking terms
              </button>
              .
            </span>
          </label>
          {termsOpen && (
            <div className="walkinTerms">
              <p>• Your rate is the one {agentName} quoted you — it is not shown on this page.</p>
              <p>• Activity dates and times are subject to weather and availability. Our team confirms by WhatsApp.</p>
              <p>• Payment is made on-site with {agentName} (cash or card as arranged).</p>
              <p>• Free cancellation or reschedule with at least 24 hours&apos; notice.</p>
              <p>• All participants must complete a consent &amp; liability form before check-in.</p>
            </div>
          )}
          {fieldErrors.agreed && (
            <small className="walkinFieldError">{fieldErrors.agreed}</small>
          )}
        </div>

        <button type="submit" className="walkinSubmit" disabled={pending}>
          {pending
            ? "Submitting…"
            : isGroup
              ? `Confirm ${items.length} Activities`
              : "Confirm Booking"}
        </button>
      </form>
    </div>
  );
}