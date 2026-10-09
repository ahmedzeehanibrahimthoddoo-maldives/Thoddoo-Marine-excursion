"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { formatUsdOnly, convertUsdCentsToMvrCents, currencyForDisplay } from "@/lib/money";
import { sanitizeWalkinItemsV2 } from "@/lib/sanitize";
import { EMAIL_REQUIRED_MESSAGE, isValidEmail } from "@/lib/email";
import { partyAdjustedCents } from "@/lib/pricing";
import SignCanvas from "@/app/rental/[token]/SignCanvas";

interface PricingOption {
  label: string;
  price: string;
  priceCents: number;
  pricingUnit?: "per_person" | "per_unit" | "per_hour";
  note?: string;
  currency?: string;
}

export interface AddonActivity {
  id: string;
  name: string;
  basePriceCents: number;
  priceNote?: string;
  currency?: string;
  pricingOptions?: PricingOption[];
}

interface GroupItemResult {
  booking_ref: string;
  activity_name: string;
  booking_date: string;
  preferred_time?: string | null;
  guest_count: number;
}

interface GroupResult {
  group_ref: string;
  guest_name: string;
  needs_per_participant_details: boolean;
  items: GroupItemResult[];
}

interface BookingFormProps {
  activityId: string;
  activityName: string;
  category: string;
  basePriceCents: number;
  priceNote?: string;
  pricingOptions?: PricingOption[];
  currency?: string;
  open: boolean;
  onClose: () => void;
  /** Other experiences that can be added to the same enquiry/booking. */
  addonActivities?: AddonActivity[];
}

interface ParticipantDraft {
  key: string;
  fullName: string;
  participantType: "adult" | "child";
  guardianName: string;
  guardianRelationship: string;
}

interface GroupParticipant {
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

const MAX_PARTY = 50;
const MAX_GROUP_ITEMS = 8;

export default function BookingForm({
  activityId,
  activityName,
  category,
  basePriceCents,
  priceNote,
  pricingOptions,
  currency,
  open,
  onClose,
  addonActivities,
}: BookingFormProps) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // INCR-3: per-participant consent state (keyed by each choice_token).
  const [groupResult, setGroupResult] = useState<GroupResult | null>(null);
  const [groupConsentDone, setGroupConsentDone] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[] | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentText, setConsentText] = useState<string | null>(null);
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [consentByToken, setConsentByToken] = useState<Record<string, ParticipantConsentDraft>>({});
  const [signedTokens, setSignedTokens] = useState<Record<string, boolean>>({});
  const [signingAll, setSigningAll] = useState(false);
  const [consentFieldErrors, setConsentFieldErrors] = useState<Record<string, string>>({});
  const signAllGuard = useRef(false);

  const [selectedOption, setSelectedOption] = useState(
    (pricingOptions && pricingOptions[0]?.label) || ""
  );
  const [selectedPriceCents, setSelectedPriceCents] = useState(
    (pricingOptions && pricingOptions[0]?.priceCents) || basePriceCents
  );
  const [bookingDate, setBookingDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("+960");
  // 072: a valid customer email gates every booking INSERT, so it is collected
  // here rather than surfacing as a database error after the guest submits.
  const [guestEmail, setGuestEmail] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [hotelName, setHotelName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [extraParticipants, setExtraParticipants] = useState<ParticipantDraft[]>(() =>
    Array.from({ length: Math.max(0, 2 - 1) }, () => blankParticipant())
  );

  // Validate activityId is a UUID from Supabase (not a static fallback slug)
  const isValidUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId);

  const firstOption = pricingOptions?.[0];
  const totalGuests = (parseInt(adults) || 0) + (parseInt(children) || 0);
  const childrenCount = extraParticipants.filter((p) => p.participantType === "child").length;
  const adultsCount = totalGuests - childrenCount;

  const [addonSelections, setAddonSelections] = useState<Record<string, string>>({});

  const selectedAddonActivities = (addonActivities || []).filter(
    (a) => addonSelections[a.id] !== undefined
  );
  const mainOptionLabel = selectedOption || firstOption?.label || "Standard";
  const isGroup = selectedAddonActivities.length > 0;

  const selectedAddonActivitiesRef = useRef(selectedAddonActivities);

  // Load the participant roster + active consent text right after a booking
  // is placed; every participant signs their waiver one at a time.
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
        const t = templateRes.data as { version?: string; consent_text?: string } | null;
        if (t?.consent_text) {
          setConsentText(t.consent_text);
          setConsentVersion(t.version || null);
        }
      }

      let roster: GroupParticipant[] = [];
      if (rosterRes.error || !rosterRes.data) {
        setConsentError("We couldn't load the participant list. Please refresh.");
      } else {
        const r = rosterRes.data as {
          bookings?: Array<{ participants?: Array<GroupParticipant> }>;
        };
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

  // The modal is a client-only interaction. Rendering fixed full-screen
  // overlays in the static HTML would bury the landing page under dark boxes.
  if (!open) return null;

  // Client estimate: only multiply by guests for per_person pricing.
  // The actual total is calculated server-side.
  const estimatedTotal = partyAdjustedCents(
    selectedPriceCents,
    pricingOptions,
    selectedOption,
    priceNote,
    totalGuests
  );

  function addonOptionLabel(a: AddonActivity): string {
    return addonSelections[a.id] || a.pricingOptions?.[0]?.label || "Standard";
  }
  function addonUnitPrice(a: AddonActivity, label: string): number {
    return a.pricingOptions?.find((o) => o.label === label)?.priceCents ?? a.basePriceCents;
  }
  // 079: same rule as the walk-in form - an add-on with no priced options is
  // priced by its price note, so a "/ person" trip bills per guest.
  const addonTotal = selectedAddonActivities.reduce((sum, a) => {
    const label = addonOptionLabel(a);
    return sum + partyAdjustedCents(addonUnitPrice(a, label), a.pricingOptions, label, a.priceNote, totalGuests);
  }, 0);
  const combinedEstimate = estimatedTotal + addonTotal;

  function toggleAddon(a: AddonActivity) {
    setAddonSelections((prev) => {
      const next = { ...prev };
      if (next[a.id] !== undefined) {
        delete next[a.id];
      } else {
        next[a.id] = a.pricingOptions?.[0]?.label || "Standard";
      }
      return next;
    });
  }

  function pricingUnitLabel(unit?: string): string {
    if (unit === "per_hour") return "/hr";
    if (unit === "per_unit") return "/session";
    return "";
  }

  function handleOptionChange(label: string) {
    setSelectedOption(label);
    const opt = pricingOptions?.find((o) => o.label === label);
    if (opt) setSelectedPriceCents(opt.priceCents);
    else setSelectedPriceCents(basePriceCents);
  }

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function blankParticipant(): ParticipantDraft {
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
    setAdults(String(clamped));
    setExtraParticipants((prev) => {
      const target = Math.max(0, clamped - 1);
      const next = prev.slice(0, target);
      while (next.length < target) next.push(blankParticipant());
      return next;
    });
  }

  function patchParticipant(key: string, patch: Partial<ParticipantDraft>) {
    setExtraParticipants((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...patch } : p))
    );
  }

  // One participant row per person. The lead (row 1 = the guest who books)
  // is always present as an adult — same as the walk-in wizard — so a solo
  // guest still has a participant row and is asked to sign the waiver.
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
    if (extraParticipants.length > 0) {
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

  function consentFor(p: GroupParticipant): ParticipantConsentDraft {
    return consentByToken[p.choice_token] ?? blankConsent();
  }

  function patchConsent(token: string, patch: Partial<ParticipantConsentDraft>) {
    setConsentByToken((prev) => ({
      ...prev,
      [token]: { ...(prev[token] ?? blankConsent()), ...patch },
    }));
  }

  function validateParticipantConsent(
    p: GroupParticipant,
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

  async function signParticipant(p: GroupParticipant): Promise<boolean> {
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

  function validate(): boolean {
    const errors: Record<string, string> = {};

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
    if (!bookingDate) {
      errors.bookingDate = "Please select a date.";
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(bookingDate) < today) {
        errors.bookingDate = "Date cannot be in the past.";
      }
    }
    if (pricingOptions && pricingOptions.length > 0 && !selectedOption) {
      errors.selectedOption = "Please select a pricing option.";
    }
    const a = parseInt(adults) || 0;
    const c = parseInt(children) || 0;
    if (a < 1) {
      errors.adults = "At least 1 adult is required.";
    }
    if (a + c > 50) {
      errors.adults = "Maximum 50 guests total.";
    }
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

        // Migration 066: the ONLINE form uses the same strict path as the
        // walk-in wizard — always submit_public_booking_group_v2 with a full
        // per-participant roster on every item. The legacy submit_public_booking
        // / submit_public_booking_group RPCs were dropped.
        const mainItem = {
          activity_id: activityId,
          pricing_option_label: mainOptionLabel !== activityName ? mainOptionLabel : null,
          booking_date: bookingDate,
          preferred_time: preferredTime || null,
          participants: partyRows(),
        };
        const draftItems = [
          mainItem,
          ...selectedAddonActivities.map((a) => ({
            activity_id: a.id,
            pricing_option_label:
              addonOptionLabel(a) !== a.name ? addonOptionLabel(a) : null,
            booking_date: bookingDate,
            preferred_time: preferredTime || null,
            participants: partyRows(),
          })),
        ].slice(0, MAX_GROUP_ITEMS);

        const sanitized = sanitizeWalkinItemsV2({ items: draftItems });
        if (sanitized.items.length === 0) {
          setFormError("Please check the selected activities and try again.");
          return;
        }
        const { data, error } = await supabase.rpc("submit_public_booking_group_v2", {
          p_items: sanitized.items.map((it) => ({
            activity_id: it.activity_id,
            pricing_option_label: it.pricing_option_label,
            booking_date: it.booking_date,
            preferred_time: it.preferred_time || "anytime",
            participants: it.participants,
          })),
          p_guest_name: guestName.trim(),
          p_guest_phone: guestPhone.trim(),
          p_guest_email: guestEmail.trim(),
          p_booking_date: bookingDate,
          p_preferred_time: preferredTime || "anytime",
          p_adults: adultsCount,
          p_children: childrenCount,
          p_hotel_name: hotelName || null,
          p_room_number: roomNumber || null,
          p_pickup_location: pickupLocation || null,
          p_special_requests: specialRequests || null,
          p_guest_agreed: agreed,
          p_source: "online",
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
          needs_per_participant_details: !!r.needs_per_participant_details,
          items: ((r.items as unknown[]) || []).map((raw) => {
            const it = raw as Record<string, unknown>;
            return {
              booking_ref: (it.booking_ref as string) || "",
              activity_name: (it.activity_name as string) || "",
              booking_date: (it.booking_date as string) || "",
              preferred_time: (it.preferred_time as string) || null,
              guest_count: (it.guest_count as number) || totalGuests,
            };
          }),
        });
      } catch {
        setFormError("Something went wrong. Please try again.");
      }
    });
  }

  function openWhatsApp() {
    if (!groupResult) return;
    const d = {
      booking_ref: groupResult.group_ref,
      guest_name: groupResult.guest_name,
      date: groupResult.items[0]?.booking_date || bookingDate,
      time: groupResult.items[0]?.preferred_time || preferredTime || "Flexible",
      activity_name: groupResult.items.map((i) => i.activity_name).join(", ") || activityName,
    };
    const msg = [
      "Thoddoo Marine Booking Enquiry",
      `Reference: ${d.booking_ref}`,
      `Guest: ${d.guest_name}`,
      `Activity: ${d.activity_name}`,
      `Date: ${d.date}`,
      `Time: ${d.time}`,
      `Adults: ${adultsCount}`,
      `Children: ${childrenCount}`,
      `Hotel/Room: ${[hotelName, roomNumber].filter(Boolean).join(" / ") || "—"}`,
      `Pickup: ${pickupLocation || "—"}`,
      `Estimated total: ${formatUsdOnly(combinedEstimate, currency)}`,
      specialRequests ? `Special request: ${specialRequests}` : "",
      "",
      "Please confirm availability for this booking.",
    ]
      .filter(Boolean)
      .join("\n");
    const url = `https://wa.me/9609472110?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  function copyDetails() {
    if (!groupResult) return;
    const txt = [
      "Thoddoo Marine Booking Enquiry",
      `Reference: ${groupResult.group_ref}`,
      `Guest: ${groupResult.guest_name}`,
      `Activities: ${groupResult.items.map((i) => i.activity_name).join(", ") || activityName}`,
      `Date: ${groupResult.items[0]?.booking_date || bookingDate}`,
      `Time: ${groupResult.items[0]?.preferred_time || preferredTime || "Flexible"}`,
      `Estimated total: ${formatUsdOnly(combinedEstimate, currency)}`,
    ].join("\n");
    navigator.clipboard.writeText(txt).catch(() => {});
  }

  // Show success after every participant has signed.
  if (groupResult && groupConsentDone) {
    return createPortal(
      <div className="bookingOverlay" onClick={onClose}>
        <div className="bookingModal" onClick={(e) => e.stopPropagation()}>
          <button className="bookingClose" onClick={onClose} aria-label="Close">
            &times;
          </button>
          <div className="bookingSuccess">
            <div className="bookingSuccessIcon">&#10003;</div>
            <h2>Booking Submitted</h2>
            <p className="bookingRef">
              Reference: <strong>{groupResult.group_ref}</strong>
            </p>
            <p className="bookingSuccessMsg">
              Your booking enquiry has been received and every participant&apos;s
              consent &amp; liability waiver has been signed. Our team will confirm
              availability shortly via WhatsApp.
            </p>
            <div className="bookingSuccessDetails">
              <div>
                <span>Lead guest</span>
                <strong>{groupResult.guest_name}</strong>
              </div>
              {groupResult.items.map((i) => (
                <div key={i.booking_ref}>
                  <span>{i.activity_name}</span>
                  <strong>
                    {i.booking_date}
                    {i.preferred_time ? ` · ${i.preferred_time}` : ""} · {i.booking_ref}
                  </strong>
                </div>
              ))}
            </div>
            <div className="bookingSuccessActions">
              <button className="bookingBtnPrimary" onClick={copyDetails}>
                Copy Details
              </button>
              <button className="bookingBtnPrimary" onClick={openWhatsApp}>
                Confirm via WhatsApp
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // INCR-3: per-participant consent & liability step — same as the walk-in
  // wizard. Every participant must read the full waiver and sign.
  if (groupResult && !groupConsentDone) {
    const fe = (token: string, key: string): string | undefined =>
      consentFieldErrors[`${token}.${key}`];
    return createPortal(
      <div className="bookingOverlay" onClick={onClose}>
        <div className="bookingModal bookingModalWide" onClick={(e) => e.stopPropagation()}>
          <button className="bookingClose" onClick={onClose} aria-label="Close">
            &times;
          </button>
          <div className="walkinCard" style={{ boxShadow: "none", maxWidth: "none" }}>
            <div className="walkinCardHead">
              <h2>Consent &amp; Liability Waiver</h2>
              <p>
                Every participant must read and sign the waiver for each activity —
                children sign via a parent or guardian. Group reference{" "}
                <strong>{groupResult.group_ref}</strong>.
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
                              <small className="walkinFieldError">{fe(p.choice_token, "guardianRelationship")}</small>
                            )}
                          </label>
                        </div>
                      )}

                      <div className="walkinRow">
                        <div className="walkinField">
                          <span>{p.participant_type === "child" ? "Parent / Guardian Signature" : "Participant Signature"}</span>
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
                          {fe(p.choice_token, p.participant_type === "child" ? "guardianSignature" : "signature") && (
                            <small className="walkinFieldError">
                              {fe(p.choice_token, p.participant_type === "child" ? "guardianSignature" : "signature")}
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
        </div>
      </div>,
      document.body
    );
  }

  // Min date: today in local time
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return createPortal(
    <div className="bookingOverlay" onClick={onClose}>
      <div className="bookingModal" onClick={(e) => e.stopPropagation()}>
        <button className="bookingClose" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <div className="bookingModalHeader">
          <h2>Book {activityName}</h2>
          <p className="bookingModalSub">
            Fill in the details below and we&apos;ll confirm availability via WhatsApp.
          </p>
        </div>

        {!isValidUUID && (
          <div className="bookingFormError" role="alert">
            Online booking is currently unavailable. Please use WhatsApp to make
            a reservation.
          </div>
        )}

        <form className="bookingForm" onSubmit={handleSubmit}>
          {formError && (
            <div className="bookingFormError" role="alert">
              {formError}
            </div>
          )}

          {/* Pricing Option */}
          {pricingOptions && pricingOptions.length > 0 && (
            <div className="bookingField">
              <label htmlFor="bf-option">
                Pricing Option <span className="required">*</span>
              </label>
              <select
                id="bf-option"
                value={selectedOption}
                onChange={(e) => handleOptionChange(e.target.value)}
              >
                {pricingOptions.map((opt) => (
                  <option key={opt.label} value={opt.label}>
                    {opt.label} — {formatUsdOnly(opt.priceCents, opt.currency)}
                    {opt.note ? ` ${opt.note}` : pricingUnitLabel(opt.pricingUnit)}
                  </option>
                ))}
              </select>
              {fieldErrors.selectedOption && (
                <span className="bookingFieldError">{fieldErrors.selectedOption}</span>
              )}
            </div>
          )}
          {(!pricingOptions || pricingOptions.length === 0) && (
            <div className="bookingField">
              <label>Price</label>
              <div className="bookingPriceDisplay">
                {formatUsdOnly(basePriceCents, currency)}
              </div>
            </div>
          )}

          {/* Date & Time */}
          <div className="bookingRow">
            <div className="bookingField">
              <label htmlFor="bf-date">
                Activity Date <span className="required">*</span>
              </label>
              <input
                id="bf-date"
                type="date"
                min={minDate}
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
              />
              {fieldErrors.bookingDate && (
                <span className="bookingFieldError">{fieldErrors.bookingDate}</span>
              )}
            </div>
            <div className="bookingField">
              <label htmlFor="bf-time">Preferred Time</label>
              <input
                id="bf-time"
                type="time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
              />
            </div>
          </div>

          {/* Guest Name & Phone */}
          <div className="bookingRow">
            <div className="bookingField">
              <label htmlFor="bf-name">
                Full Name <span className="required">*</span>
              </label>
              <input
                id="bf-name"
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
              />
              {fieldErrors.guestName && (
                <span className="bookingFieldError">{fieldErrors.guestName}</span>
              )}
            </div>
            <div className="bookingField">
              <label htmlFor="bf-phone">
                WhatsApp Number <span className="required">*</span>
              </label>
              <input
                id="bf-phone"
                type="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+960 947 2110"
                autoComplete="tel"
              />
              {fieldErrors.guestPhone && (
                <span className="bookingFieldError">{fieldErrors.guestPhone}</span>
              )}
            </div>
            <div className="bookingField">
              <label htmlFor="bf-email">
                Email <span className="required">*</span>
              </label>
              <input
                id="bf-email"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
              {fieldErrors.guestEmail && (
                <span className="bookingFieldError">{fieldErrors.guestEmail}</span>
              )}
              <small className="bookingFieldHint">
                We send your invoice and safety waiver here.
              </small>
            </div>
          </div>

          {/* Adults & Children */}
          <div className="bookingRow">
            <div className="bookingField">
              <label htmlFor="bf-adults">
                Adults <span className="required">*</span>
              </label>
              <input
                id="bf-adults"
                type="number"
                min="1"
                max="50"
                value={adults}
                onChange={(e) => {
                  setAdults(e.target.value);
                  setParty(parseInt(e.target.value, 10) || 1);
                }}
              />
              {fieldErrors.adults && (
                <span className="bookingFieldError">{fieldErrors.adults}</span>
              )}
            </div>
            <div className="bookingField">
              <label htmlFor="bf-children">Children</label>
              <input
                id="bf-children"
                type="number"
                min="0"
                max="30"
                value={children}
                onChange={(e) => setChildren(e.target.value)}
              />
            </div>
          </div>

          {/* Who is coming — every guest needs a name row (lead + each other) */}
          <div className="bookingField">
            <label>
              Who is coming?{" "}
              <small className="textMuted">
                {extraParticipants.length > 0
                  ? "every guest needs a row"
                  : "only the lead guest is booked"}
              </small>
            </label>
            {extraParticipants.map((p, idx) => (
              <div key={p.key} className="bookingParticipantRow" style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  value={p.fullName}
                  placeholder={`Guest ${idx + 2} full name`}
                  autoComplete="off"
                  onChange={(e) => patchParticipant(p.key, { fullName: e.target.value })}
                />
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
                {p.participantType === "child" && (
                  <>
                    <input
                      type="text"
                      value={p.guardianName}
                      placeholder="Parent / guardian name"
                      onChange={(e) => patchParticipant(p.key, { guardianName: e.target.value })}
                    />
                    <input
                      type="text"
                      value={p.guardianRelationship}
                      placeholder="Relationship (e.g. Father)"
                      onChange={(e) =>
                        patchParticipant(p.key, { guardianRelationship: e.target.value })
                      }
                    />
                  </>
                )}
                {fieldErrors[`participant_${idx}_fullName`] && (
                  <span className="bookingFieldError">
                    {fieldErrors[`participant_${idx}_fullName`]}
                  </span>
                )}
                {fieldErrors[`participant_${idx}_guardianName`] && (
                  <span className="bookingFieldError">
                    {fieldErrors[`participant_${idx}_guardianName`]}
                  </span>
                )}
                {fieldErrors[`participant_${idx}_guardianRelationship`] && (
                  <span className="bookingFieldError">
                    {fieldErrors[`participant_${idx}_guardianRelationship`]}
                  </span>
                )}
              </div>
            ))}
            {extraParticipants.length === 0 && (
              <p className="textMuted" style={{ margin: 0 }}>
                Only the lead guest is booked, so they are the sole participant and will
                sign the consent &amp; liability waiver.
              </p>
            )}
          </div>

          {/* Combine with other experiences */}
          {addonActivities && addonActivities.length > 0 && (
            <div className="bookingField">
              <label>
                Add more experiences{" "}
                <small className="textMuted">(same date &amp; guests)</small>
              </label>
              <div className="bookingAddons">
                {addonActivities.map((a) => {
                  const selected = addonSelections[a.id] !== undefined;
                  return (
                    <div key={a.id} className={`bookingAddon ${selected ? "selected" : ""}`}>
                      <label className="bookingAddonMain">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleAddon(a)}
                        />
                        <span>{a.name}</span>
                      </label>
                      {selected && a.pricingOptions && a.pricingOptions.length > 0 ? (
                        <select
                          value={addonOptionLabel(a)}
                          onChange={(e) =>
                            setAddonSelections((prev) => ({ ...prev, [a.id]: e.target.value }))
                          }
                        >
                          {a.pricingOptions.map((opt) => (
                            <option key={opt.label} value={opt.label}>
                              {opt.label} — {formatUsdOnly(opt.priceCents, opt.currency || a.currency)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <small className="textMuted">
                          {formatUsdOnly(addonUnitPrice(a, addonOptionLabel(a)), a.currency)}
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hotel & Room */}
          <div className="bookingRow">
            <div className="bookingField">
              <label htmlFor="bf-hotel">Hotel / Guesthouse</label>
              <input
                id="bf-hotel"
                type="text"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="Where you are staying"
              />
            </div>
            <div className="bookingField">
              <label htmlFor="bf-room">Room Number</label>
              <input
                id="bf-room"
                type="text"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="Room number"
              />
            </div>
          </div>

          {/* Pickup */}
          <div className="bookingField">
            <label htmlFor="bf-pickup">Pickup Location</label>
            <input
              id="bf-pickup"
              type="text"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              placeholder="Where should we pick you up?"
            />
          </div>

          {/* Special Requests */}
          <div className="bookingField">
            <label htmlFor="bf-notes">Special Requests</label>
            <textarea
              id="bf-notes"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              rows={3}
              placeholder="Dietary requirements, accessibility needs, celebrations, etc."
            />
          </div>

          {/* Estimated Total */}
          {combinedEstimate > 0 && (
            <div className="bookingEstimate">
              <span>{isGroup ? "Combined Estimate" : "Estimated Total"}</span>
              <strong>{formatUsdOnly(combinedEstimate, currency)}</strong>
            </div>
          )}

          {/* Booking Enquiry Terms */}
          <div className="bookingTermsSection">
            <button
              type="button"
              className="bookingTermsToggle"
              onClick={() => setTermsOpen(!termsOpen)}
            >
              {termsOpen ? "Hide" : "Read"} Booking Enquiry Terms
              <span className={`bookingTermsArrow ${termsOpen ? "open" : ""}`}>&#9662;</span>
            </button>
            {termsOpen && (
              <div className="bookingTermsContent">
                <ol>
                  <li>
                    <strong>This is a booking enquiry, not a confirmed reservation.</strong>{" "}
                    Submitting this form does not guarantee availability. Your booking
                    is only confirmed after our team contacts you via WhatsApp.
                  </li>
                  <li>
                    <strong>Thoddoo Marine will confirm availability through WhatsApp.</strong>{" "}
                    Our team will review your enquiry and respond to confirm
                    availability, pricing, and next steps.
                  </li>
                  <li>
                    <strong>Displayed totals are estimates and may change</strong> if
                    booking details are adjusted (number of guests, pricing option,
                    date, or other factors). Final pricing will be confirmed by our
                    team.
                  </li>
                  <li>
                    <strong>You must provide accurate contact and booking
                    information.</strong> Inaccurate details may result in delays or
                    inability to process your enquiry.
                  </li>
                  <li>
                    <strong>Activity participation remains subject to weather,
                    operational, and safety conditions.</strong> Activities may be
                    modified or cancelled due to conditions beyond our control.
                  </li>
                  <li>
                    <strong>Every participant must complete and sign a separate
                    activity consent &amp; liability form</strong> before participation.
                    You will be asked to sign for each guest in the next step.
                  </li>
                  <li>
                    <strong>Booking details will be stored and used to process the
                    enquiry and contact the guest.</strong> Your data will not be
                    shared with third parties. For questions, contact{" "}
                    <a href="mailto:ahmedthoddoo@gmail.com">
                      ahmedthoddoo@gmail.com
                    </a>.
                  </li>
                  <li>
                    <strong>Opening WhatsApp does not itself confirm the
                    booking.</strong> WhatsApp is used for communication only. Only
                    confirmation from our team constitutes a confirmed reservation.
                  </li>
                </ol>
              </div>
            )}
          </div>

          {/* Agreement checkbox */}
          <div className="bookingField bookingCheckbox">
            <label>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  if (fieldErrors.agreed) setFieldErrors((p) => ({ ...p, agreed: "" }));
                }}
              />
              <span>
                I have read and agree to the Booking Enquiry Terms.
              </span>
            </label>
            {fieldErrors.agreed && (
              <span className="bookingFieldError">{fieldErrors.agreed}</span>
            )}
          </div>

          {/* Privacy Notice */}
          <p className="bookingPrivacy">
            Your information is used only to process this booking enquiry. We do
            not share your data with third parties. For questions, contact{" "}
            <a href="mailto:ahmedthoddoo@gmail.com">ahmedthoddoo@gmail.com</a>.
          </p>

          <button type="submit" className="bookingSubmit" disabled={pending || !isValidUUID}>
            {pending ? "Submitting..." : "Submit Booking Enquiry"}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}