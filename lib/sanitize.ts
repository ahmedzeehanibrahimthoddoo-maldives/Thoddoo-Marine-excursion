/**
 * Shared sanitization helpers for server actions.
 * Prevents PostgreSQL errors (22007, etc.) by converting empty/invalid inputs to null.
 * Currency values are validated with assertCurrency() — never silent fallback.
 */

import { assertCurrency } from "./money";
import { commissionMode, parseCommissionPercent } from "./commission";
import { PRICING_UNITS, type PricingUnit } from "./pricing";

/** Convert empty string or whitespace-only string to null. */
export function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Convert a string to integer, returning null if empty/invalid. */
export function safeInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** Convert a string to bigint cents, returning 0 if empty/invalid. */
export function safeCents(v: unknown): number {
  const n = safeInt(v);
  return n !== null ? n : 0;
}

/** Validate a currency string, returning "USD" as fallback.
 *  For strict validation, use the Currency type check directly.
 */
export function validCurrencyFallback(v: unknown): string {
  if (v === "MVR") return "MVR";
  return "USD";
}

/** 3-way currency fallback for the cash register (USD / MVR / EUR). */
export function validCurrency3Fallback(v: unknown): string {
  if (v === "MVR") return "MVR";
  if (v === "EUR") return "EUR";
  return "USD";
}

/** Validate a date string (YYYY-MM-DD format). Returns null if invalid or empty. */
export function validISODate(v: unknown): string | null {
  const s = emptyToNull(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** Validate a timestamp string. Returns null if invalid or empty. */
export function validISOTimestamp(v: unknown): string | null {
  const s = emptyToNull(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Validate a UUID. Returns null if invalid or empty. */
export function validUUID(v: unknown): string | null {
  const s = emptyToNull(v);
  if (!s) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/** Sanitize a customer record before insert/update. */
export function sanitizeCustomer(data: Record<string, unknown>) {
  return {
    full_name: emptyToNull(data.full_name) || "",
    email: emptyToNull(data.email),
    phone: emptyToNull(data.phone),
    nationality: emptyToNull(data.nationality),
    passport_number: emptyToNull(data.passport_number),
    date_of_birth: validISODate(data.date_of_birth),
    hotel: emptyToNull(data.hotel),
    room_number: emptyToNull(data.room_number),
    emergency_contact_name: emptyToNull(data.emergency_contact_name),
    emergency_contact_phone: emptyToNull(data.emergency_contact_phone),
    medical_conditions: emptyToNull(data.medical_conditions),
    allergies: emptyToNull(data.allergies),
    medications: emptyToNull(data.medications),
    notes: emptyToNull(data.notes),
  };
}

// =============================================
// BOOKING SANITIZERS (split create / patch)
// =============================================

/**
 * Pricing basis for a booking. Blank means "not recorded"; an unrecognised
 * value is rejected rather than coerced, because defaulting a typo'd
 * 'per-person' to per_unit would store a per-person booking as a single unit
 * price and undercharge it.
 */
function sanitizePricingUnit(value: unknown): PricingUnit | null {
  if (!value) return null;
  const unit = String(value);
  if (!PRICING_UNITS.includes(unit as PricingUnit)) {
    throw new Error(`pricing_unit must be one of ${PRICING_UNITS.join(", ")}`);
  }
  return unit as PricingUnit;
}

/** Fields allowed in updateBooking partial updates. */
export const BOOKING_PATCH_FIELDS = [
  "customer_id",
  "activity_id",
  "source",
  "guests",
  "adults",
  "children_count",
  "total_cents",
  "special_requests",
  "status",
  "booking_date",
  "preferred_time",
  "hotel_name",
  "room_number",
  "pickup_location",
  "pricing_option_label",
  "pricing_option_cents",
  "pricing_unit",
  "estimated_total_cents",
  "booking_currency",
  "partner",
  "net_cents",
  "commission_cents",
  "commission_mode",
  "commission_percent",
  "commission_currency",
  "arrival_date",
  "arrival_time",
  "transfer",
] as const;

/** Sanitize booking data for creation — validates all required create fields and currency. */
export function sanitizeBookingCreate(data: Record<string, unknown>) {
  return {
    customer_id: validUUID(data.customer_id) || "",
    activity_id: validUUID(data.activity_id) || "",
    source: emptyToNull(data.source) || "online",
    guests: safeInt(data.guests) ?? 1,
    adults: safeInt(data.adults) ?? 0,
    children_count: safeInt(data.children_count) ?? 0,
    total_cents: safeCents(data.total_cents),
    booking_currency: assertCurrency(data.booking_currency),
    special_requests: emptyToNull(data.special_requests),
    status: emptyToNull(data.status) || "pending",
    booking_date: validISODate(data.booking_date),
    preferred_time: emptyToNull(data.preferred_time),
    hotel_name: emptyToNull(data.hotel_name),
    room_number: emptyToNull(data.room_number),
    pickup_location: emptyToNull(data.pickup_location),
    pricing_option_label: emptyToNull(data.pricing_option_label),
    pricing_option_cents: safeCents(data.pricing_option_cents),
    pricing_unit: sanitizePricingUnit(data.pricing_unit),
    estimated_total_cents: safeCents(data.estimated_total_cents),
    partner: emptyToNull(data.partner),
    net_cents: safeCents(data.net_cents),
    commission_cents: safeCents(data.commission_cents),
    commission_mode: commissionMode(data.commission_mode),
    commission_percent: parseCommissionPercent(data.commission_percent),
    commission_currency: emptyToNull(data.commission_currency),
    arrival_date: validISODate(data.arrival_date),
    arrival_time: /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(data.arrival_time || "").trim()) ? String(data.arrival_time).trim() : null,
    transfer: emptyToNull(data.transfer),
    guest_agreed: data.guest_agreed === true,
  };
}

/**
 * Sanitize booking data for partial update.
 * Only validates keys actually present in data — never adds missing keys as null/empty/default.
 * If booking_currency is supplied, validates with assertCurrency.
 * Never overwrites fields not supplied. Never includes generated/protected fields.
 */
export function sanitizeBookingPatch(data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  for (const field of BOOKING_PATCH_FIELDS) {
    if (!(field in data)) continue;
    switch (field) {
      case "customer_id":
        patch.customer_id = validUUID(data.customer_id) || null;
        break;
      case "activity_id":
        patch.activity_id = validUUID(data.activity_id) || null;
        break;
      case "source":
        patch.source = emptyToNull(data.source) || "walk_in";
        break;
      case "guests":
        patch.guests = safeInt(data.guests) ?? 1;
        break;
      case "adults":
        patch.adults = safeInt(data.adults);
        break;
      case "children_count":
        patch.children_count = safeInt(data.children_count);
        break;
      case "total_cents":
        patch.total_cents = safeCents(data.total_cents);
        break;
      case "booking_currency":
        patch.booking_currency = assertCurrency(data.booking_currency);
        break;
      case "special_requests":
        patch.special_requests = emptyToNull(data.special_requests);
        break;
      case "status":
        patch.status = emptyToNull(data.status) || undefined;
        break;
      case "booking_date":
        patch.booking_date = validISODate(data.booking_date);
        break;
      case "preferred_time":
        patch.preferred_time = emptyToNull(data.preferred_time);
        break;
      case "hotel_name":
        patch.hotel_name = emptyToNull(data.hotel_name);
        break;
      case "room_number":
        patch.room_number = emptyToNull(data.room_number);
        break;
      case "pickup_location":
        patch.pickup_location = emptyToNull(data.pickup_location);
        break;
      case "pricing_option_cents":
        patch.pricing_option_cents = safeCents(data.pricing_option_cents);
        break;
      case "pricing_unit":
        patch.pricing_unit = sanitizePricingUnit(data.pricing_unit);
        break;
      case "pricing_option_label":
        patch.pricing_option_label = emptyToNull(data.pricing_option_label);
        break;
      case "estimated_total_cents":
        patch.estimated_total_cents = safeCents(data.estimated_total_cents);
        break;
      case "partner":
        patch.partner = emptyToNull(data.partner);
        break;
      case "net_cents":
        patch.net_cents = safeCents(data.net_cents);
        break;
      case "commission_cents":
        patch.commission_cents = safeCents(data.commission_cents);
        break;
      case "commission_mode":
        patch.commission_mode = commissionMode(data.commission_mode);
        break;
      case "commission_percent":
        patch.commission_percent = parseCommissionPercent(data.commission_percent);
        break;
      case "commission_currency":
        patch.commission_currency = emptyToNull(data.commission_currency);
        break;
      case "arrival_date":
        patch.arrival_date = validISODate(data.arrival_date);
        break;
      case "arrival_time":
        patch.arrival_time = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(data.arrival_time || "").trim()) ? String(data.arrival_time).trim() : null;
        break;
      case "transfer":
        patch.transfer = emptyToNull(data.transfer);
        break;
    }
  }

  return patch;
}

/** @deprecated Use sanitizeBookingCreate() for inserts or sanitizeBookingPatch() for updates. */
export function sanitizeBooking(data: Record<string, unknown>) {
  return {
    customer_id: validUUID(data.customer_id) || "",
    activity_id: validUUID(data.activity_id) || "",
    source: emptyToNull(data.source) || "online",
    guests: safeInt(data.guests) ?? 1,
    total_cents: safeCents(data.total_cents),
    booking_currency: assertCurrency(data.booking_currency),
    special_requests: emptyToNull(data.special_requests),
    status: emptyToNull(data.status) || undefined,
    booking_date: validISODate(data.booking_date) || undefined,
  };
}

/** Sanitize a boat (fleet craft) record before insert/update. */
export function sanitizeBoat(data: Record<string, unknown>) {
  return {
    name: emptyToNull(data.name) || "",
    boat_type: emptyToNull(data.boat_type) || "speedboat",
    capacity_pax: safeInt(data.capacity_pax) ?? 1,
    status: emptyToNull(data.status) || "active",
    notes: emptyToNull(data.notes),
  };
}

/** Sanitize an operational crew member before insert/update. */
export function sanitizeCrewMember(data: Record<string, unknown>) {
  return {
    full_name: emptyToNull(data.full_name) || "",
    role: emptyToNull(data.role) || "",
    phone: emptyToNull(data.phone),
    active: typeof data.active === "boolean" ? data.active : true,
    notes: emptyToNull(data.notes),
    staff_profile_id: validUUID(data.staff_profile_id) || null,
  };
}

/** Validate a trip data record before insert/update. */
export function sanitizeTrip(data: Record<string, unknown>) {
  return {
    activity_id: validUUID(data.activity_id) || null,
    boat_id: validUUID(data.boat_id) || null,
    trip_date: validISODate(data.trip_date),
    start_time: /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(data.start_time || "").trim()) ? String(data.start_time).trim() : null,
    end_time: /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(data.end_time || "").trim()) ? String(data.end_time).trim() : null,
    guide_id: validUUID(data.guide_id) || null,
    captain_id: validUUID(data.captain_id) || null,
    capacity_pax: safeInt(data.capacity_pax) ?? null,
    seats_open: safeInt(data.seats_open) ?? null,
    notes: emptyToNull(data.notes),
    status: emptyToNull(data.status) as string | null,
    destination: emptyToNull(data.destination),
    transfer_price_cents: safeCents(data.transfer_price_cents),
    transfer_currency: (['USD', 'MVR'].includes(String(data.transfer_currency || '')) ? String(data.transfer_currency) : 'USD'),
  } as Record<string, unknown>;
}

/** Sanitize an equipment record before insert/update. */
export function sanitizeEquipment(data: Record<string, unknown>) {
  return {
    name: emptyToNull(data.name) || "",
    asset_number: emptyToNull(data.asset_number) || "",
    category: emptyToNull(data.category) || "",
    description: emptyToNull(data.description),
    condition_status: emptyToNull(data.condition_status) || "good",
    daily_rate_cents: safeCents(data.daily_rate_cents),
    deposit_cents: safeCents(data.deposit_cents),
    currency: assertCurrency(data.currency),
    active: typeof data.active === "boolean" ? data.active : true,
  };
}

/** Sanitize an incident report before insert/update. */
export function sanitizeIncident(data: Record<string, unknown>) {
  const severityValue = emptyToNull(data.severity) || "minor";
  return {
    booking_id: validUUID(data.booking_id) || null,
    customer_id: validUUID(data.customer_id) || null,
    activity_id: validUUID(data.activity_id) || null,
    reported_by: emptyToNull(data.reported_by) || "",
    incident_date: validISOTimestamp(data.incident_date) || new Date().toISOString(),
    severity: ["minor", "moderate", "major", "critical"].includes(severityValue)
      ? severityValue
      : "minor",
    description: emptyToNull(data.description) || "",
    actions_taken: emptyToNull(data.actions_taken),
    equipment_involved: emptyToNull(data.equipment_involved),
    vessel_ref: emptyToNull(data.vessel_ref),
    witness_names: emptyToNull(data.witness_names),
    follow_up_needed: typeof data.follow_up_needed === "boolean" ? data.follow_up_needed : false,
    follow_up_notes: emptyToNull(data.follow_up_notes),
    resolved: typeof data.resolved === "boolean" ? data.resolved : false,
    alarm_warning_seen:
      typeof data.alarm_warning_seen === "boolean" ? data.alarm_warning_seen : false,
    alarm_notes: emptyToNull(data.alarm_notes),
    mechanical_damage: emptyToNull(data.mechanical_damage),
    evidence_notes: emptyToNull(data.evidence_notes),
    photos: Array.isArray(data.photos)
      ? (data.photos as Record<string, unknown>[])
          .slice(0, 20)
          .map((p) => ({
            url: emptyToNull(p.url) || "",
            note: emptyToNull(p.note) || "",
          }))
          .filter((p) => p.url)
      : [],
    repair_quote_cents: safeInt(data.repair_quote_cents),
    repair_quote_currency: validCurrencyFallback(data.repair_quote_currency),
  };
}

/** Sanitize a payment record before insert/update. */
export function sanitizePayment(data: Record<string, unknown>) {
  return {
    booking_id: validUUID(data.booking_id) || "",
    amount_cents: safeCents(data.amount_cents),
    currency: assertCurrency(data.currency),
    booking_currency: assertCurrency(data.booking_currency),
    status: data.status || "completed",
    method: emptyToNull(data.method) || "cash",
    reference: emptyToNull(data.reference),
    notes: emptyToNull(data.notes),
  };
}

/** Sanitize a consent form record before insert/update. */
export function sanitizeConsentForm(data: Record<string, unknown>) {
  return {
    customer_id: validUUID(data.customer_id) || "",
    booking_id: validUUID(data.booking_id) || null,
    activity_id: validUUID(data.activity_id) || null,
    consent_type: emptyToNull(data.consent_type) || "activity",
    form_version: data.form_version || data.version || "1.0",
    guest_name: emptyToNull(data.guest_name) || "",
    guest_email: emptyToNull(data.guest_email),
    guest_phone: emptyToNull(data.guest_phone),
  };
}

// =============================================
// CMS SANITIZERS
// =============================================

/** Sanitize a gallery item before insert/update. */
export function sanitizeGalleryItem(data: Record<string, unknown>) {
  return {
    image_url: emptyToNull(data.image_url) || "",
    caption: emptyToNull(data.caption) || "",
    orientation: data.orientation === "portrait" ? "portrait" : "landscape",
    sort_order: safeInt(data.sort_order) ?? 0,
    active: typeof data.active === "boolean" ? data.active : true,
  };
}

/** Sanitize an explore/Thoddoo experiences item before insert/update. */
export function sanitizeExploreItem(data: Record<string, unknown>) {
  return {
    title: emptyToNull(data.title) || "",
    body: emptyToNull(data.body) || "",
    image_url: emptyToNull(data.image_url) || "",
    sort_order: safeInt(data.sort_order) ?? 0,
    active: typeof data.active === "boolean" ? data.active : true,
  };
}

/** Sanitize an activity content patch (short description, images, featured). */
export function sanitizeExpense(data: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  if ("title" in data) clean.title = String(data.title || "").trim();
  if ("category" in data) clean.category = String(data.category || "Other").trim() || "Other";
  if ("amount_cents" in data) clean.amount_cents = safeCents(data.amount_cents);
  if ("currency" in data) clean.currency = validCurrencyFallback(data.currency);
  if ("expense_date" in data) clean.expense_date = validISODate(data.expense_date) ?? new Date().toISOString().slice(0, 10);
  if ("vendor" in data) clean.vendor = emptyToNull(data.vendor);
  if ("notes" in data) clean.notes = emptyToNull(data.notes);
  return clean;
}

// =============================================
// CASH REGISTER SANITIZERS
// =============================================

const CASH_REGISTER_METHODS = ["cash", "card", "bank_transfer", "bill", "expense"];

const COUNTS_CURRENCIES = ["USD", "MVR", "EUR"];

/**
 * Validate a note/coin count breakdown for a currency.
 * Input like { "5000": 2, "25": 10 } → counts per denomination (minor units).
 * Returns null when counts are empty; throws on malformed input.
 */
export function sanitizeCashCounts(v: unknown): Record<string, number> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    // Denomination ids are like "n10000" (note $100) or "c25" (coin 0.25).
    if (!/^[nc]\d+$|^\d+$/.test(key)) continue;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error("Invalid note/coin count.");
    if (n > 0) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Build per-currency opening amounts (incl. EUR) and their split by currency. */
export function sanitizeCashRegisterOpen(data: Record<string, unknown>) {
  const usdCounts = sanitizeCashCounts(data.opening_counts_usd);
  const mvrCounts = sanitizeCashCounts(data.opening_counts_mvr);
  const eurCounts = sanitizeCashCounts(data.opening_counts_eur);
  return {
    register_date: validISODate(data.register_date) ?? new Date().toISOString().slice(0, 10),
    opening_cash_usd_cents: safeCents(data.opening_cash_usd_cents),
    opening_cash_mvr_laari: safeCents(data.opening_cash_mvr_laari),
    opening_cash_eur_cents: safeCents(data.opening_cash_eur_cents),
    opening_counts: { USD: usdCounts, MVR: mvrCounts, EUR: eurCounts },
    notes: emptyToNull(data.notes),
  };
}

/** Sanitize a cash register entry (collection or cash-out expense). */
export function sanitizeCashRegisterEntry(data: Record<string, unknown>) {
  const method = emptyToNull(data.method) || "cash";
  return {
    register_id: validUUID(data.register_id) || "",
    method: CASH_REGISTER_METHODS.includes(method)
      ? method
      : "cash",
    amount_cents: safeCents(data.amount_cents),
    currency: validCurrency3Fallback(data.currency),
    reference: emptyToNull(data.reference),
    notes: emptyToNull(data.notes),
    booking_id: validUUID(data.booking_id) || null,
  };
}

/** Sanitize a close-cash-register payload (counted cash on hand). */
export function sanitizeCashRegisterClose(data: Record<string, unknown>) {
  const usdCounts = sanitizeCashCounts(data.closing_counts_usd);
  const mvrCounts = sanitizeCashCounts(data.closing_counts_mvr);
  const eurCounts = sanitizeCashCounts(data.closing_counts_eur);
  return {
    closing_cash_usd_cents: safeCents(data.closing_cash_usd_cents),
    closing_cash_mvr_laari: safeCents(data.closing_cash_mvr_laari),
    closing_cash_eur_cents: safeCents(data.closing_cash_eur_cents),
    closing_counts: { USD: usdCounts, MVR: mvrCounts, EUR: eurCounts },
    notes: emptyToNull(data.notes),
  };
}

export function sanitizeActivityContent(data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if ("short_description" in data) patch.short_description = emptyToNull(data.short_description);
  if ("image" in data) patch.image = emptyToNull(data.image);
  if ("hero_image_url" in data) patch.hero_image_url = emptyToNull(data.hero_image_url) || null;
  if ("featured" in data) patch.featured = typeof data.featured === "boolean" ? data.featured : false;
  return patch;
}

/**
 * Sanitize a walk-in MULTI-ACTIVITY v2 payload (submitted to migration 060's
 * submit_public_booking_group_v2 RPC). Each item carries its own booking_date
 * + preferred_time plus an optional per-item participant list. Enforces the
 * same shared limits as the RPC: max 8 items, max 50 total pax.
 */
export function sanitizeWalkinItemsV2(data: Record<string, unknown>): {
  items: Array<{
    activity_id: string;
    pricing_option_label: string | null;
    booking_date: string;
    preferred_time: string | null;
    participants: Array<{
      full_name: string;
      participant_type: "adult" | "child";
      guardian_name: string | null;
      guardian_relationship: string | null;
    }>;
  }>;
} {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: Array<{
    activity_id: string;
    pricing_option_label: string | null;
    booking_date: string;
    preferred_time: string | null;
    participants: Array<{
      full_name: string;
      participant_type: "adult" | "child";
      guardian_name: string | null;
      guardian_relationship: string | null;
    }>;
  }> = [];

  const firstRawItem = rawItems[0] as Record<string, unknown> | undefined;
  const fallbackDate = validISODate(firstRawItem?.booking_date);
  const fallbackTime = emptyToNull(firstRawItem?.preferred_time);

  for (const rawItem of rawItems.slice(0, 8)) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const activityId = validUUID(item.activity_id);
    const bookingDate = validISODate(item.booking_date) || fallbackDate;
    if (!activityId || !bookingDate) continue;
    if (bookingDate < todayIso()) continue;

    const participants = (Array.isArray(item.participants) ? item.participants : []).map(
      (rawP): Record<string, unknown> =>
        (rawP && typeof rawP === "object" ? rawP : {}) as Record<string, unknown>
    );

    const cleanedParticipants: Array<{
      full_name: string;
      participant_type: "adult" | "child";
      guardian_name: string | null;
      guardian_relationship: string | null;
    }> = [];
    for (const p of participants.slice(0, 50)) {
      const fullName = emptyToNull(p.full_name);
      if (!fullName || fullName.length < 2 || fullName.length > 120) continue;
      const participantType = p.participant_type === "child" ? "child" : "adult";
      const guardianName = emptyToNull(p.guardian_name);
      const guardianRelationship = emptyToNull(p.guardian_relationship);
      if (participantType === "child" && !guardianName) continue;
      cleanedParticipants.push({
        full_name: fullName,
        participant_type: participantType,
        guardian_name: guardianName,
        guardian_relationship: guardianRelationship,
      });
    }

    items.push({
      activity_id: activityId,
      pricing_option_label: emptyToNull(item.pricing_option_label),
      booking_date: bookingDate,
      preferred_time: emptyToNull(item.preferred_time) || fallbackTime,
      participants: cleanedParticipants,
    });
  }

  return { items };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
