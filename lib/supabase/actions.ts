"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sanitizeCustomer, sanitizeBookingCreate, sanitizeBookingPatch, sanitizeEquipment, sanitizeIncident, sanitizeConsentForm, sanitizeBoat, sanitizeCrewMember, sanitizeTrip, sanitizeGalleryItem, sanitizeExploreItem, sanitizeActivityContent, sanitizeExpense, sanitizeCashRegisterOpen, sanitizeCashRegisterEntry, sanitizeCashRegisterClose, emptyToNull } from "@/lib/sanitize";
import { assertCurrency } from "@/lib/money";
import { commissionMode, parseCommissionPercent } from "@/lib/commission";
import { isValidEmail } from "@/lib/email";
import { addDays, maldivesToday, type TripRow } from "@/lib/operations";
import { sendWhatsAppText } from "@/lib/whatsappSend";
import { sendEmail } from "@/lib/mail";
import { buildBookingConfirmationMessage, buildTripAssignmentMessage } from "@/lib/whatsapp";
import { friendlyDate } from "@/lib/operations";
import { syncFinanceSheets, isConfigured as isFinanceConfigured, PUSH_TAB, type SyncFinanceResult } from "@/lib/finance-sync";
import { getFinanceWorkbookId, readSheetRange, ensureWorksheet, setCells } from "@/lib/sheets";
import {
  reconcileCashAgainstPayments,
  salesPerCurrency,
  cashPerCurrency,
  type CashReconciliation,
  type TillDayFlow,
} from "@/lib/cashreg";
import {
  normalizeExpenseCategory,
  nextMonthStart,
  buildZohoMonthlyGrid,
  type ExpenseDraft,
  type ExpenseImportRow,
} from "@/lib/expenses";

export type { CashReconciliation } from "@/lib/cashreg";

import {
  isCompletedPayment,
  paymentAmountInBookingCurrency,
  invoiceBalanceCents,
  type PaymentLike,
} from "@/lib/reports";

/** Shared email validation (mirrors public.is_valid_email in migration 072). */
const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function getSupabase() {
  return await createClient();
}

async function requireAuth() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return { supabase, user };
}

export async function getCurrentUser() {
  const { user } = await requireAuth();
  return user;
}

// =============================================
// STAFF
// =============================================
export async function getStaffProfiles() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, user_id, full_name, role, phone, active, created_at")
    .order("full_name");
  if (error) throw error;
  return data;
}

export async function getCurrentStaffProfile() {
  const { supabase, user } = await requireAuth();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, user_id, full_name, role, phone, active, created_at")
    .eq("user_id", user.id)
    .single();
  if (error) return null;
  return data;
}

export async function createStaffProfile(formData: {
  user_id: string;
  full_name: string;
  role: string;
  phone?: string;
}) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("staff_profiles").insert({
    user_id: formData.user_id,
    full_name: formData.full_name,
    role: formData.role,
    phone: formData.phone || null,
  });
  if (error) throw error;
  revalidatePath("/admin/staff");
}

export async function updateStaffProfile(id: string, formData: {
  full_name?: string;
  role?: string;
  phone?: string;
  active?: boolean;
}) {
  const { supabase, user } = await requireAuth();

  if (formData.active === false) {
    const { data: target } = await supabase
      .from("staff_profiles")
      .select("user_id, role, active")
      .eq("id", id)
      .single();
    if (target) {
      if (target.user_id === user.id) {
        throw new Error("You cannot deactivate your own account.");
      }
      if (target.role === "owner") {
        const { count } = await supabase
          .from("staff_profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "owner")
          .eq("active", true)
          .not("id", "eq", id);
        if (!count || count === 0) {
          throw new Error("At least one active owner account is required.");
        }
      }
    }
  }

  const { error } = await supabase
    .from("staff_profiles")
    .update(formData)
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/staff");
}

export async function createStaffLogin(formData: {
  email: string;
  password: string;
  full_name: string;
  role: string;
  phone?: string;
}) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("create_staff_login", {
    p_email: formData.email,
    p_password: formData.password,
    p_full_name: formData.full_name,
    p_role: formData.role,
    p_phone: formData.phone || null,
  });
  if (error) throw new Error(error.message);
  const res = data as unknown as { error?: string; message?: string; success?: boolean; staff_id?: string };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to create staff login");
  }
  revalidatePath("/admin/staff");
  revalidatePath("/admin/crew");
  return res;
}

// =============================================
// ACTIVITIES
// =============================================
export async function getActivities() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("activities")
    .select("*, activity_pricing(*)")
    .order("name");
  if (error) throw error;
  return data;
}

export async function getActivity(id: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("activities")
    .select("*, activity_pricing(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateActivity(id: string, formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const patch: Record<string, unknown> = {};
  if (formData.name !== undefined) patch.name = formData.name;
  if (formData.slug !== undefined) {
    const raw = String(formData.slug || "").trim().toLowerCase();
    if (raw) patch.slug = raw;
    else if (formData.name !== undefined) patch.slug = slugifyActivityName(String(formData.name));
  }
  if (formData.description !== undefined) patch.description = formData.description;
  if (formData.short_description !== undefined) patch.short_description = formData.short_description;
  if (formData.location !== undefined) patch.location = formData.location;
  if (formData.category !== undefined) patch.category = formData.category;
  if (formData.duration_minutes !== undefined) patch.duration_minutes = formData.duration_minutes;
  if (formData.max_guests !== undefined) patch.max_guests = formData.max_guests;
  if (formData.base_price_cents !== undefined) patch.base_price_cents = formData.base_price_cents;
  if (formData.price_note !== undefined) patch.price_note = formData.price_note;
  if (formData.image !== undefined) patch.image = formData.image;
  if (formData.gallery !== undefined) patch.gallery = formData.gallery;
  if (formData.includes !== undefined) patch.includes = formData.includes;
  if (formData.gopro !== undefined) patch.gopro = formData.gopro;
  if (formData.active !== undefined) patch.active = formData.active;
  if (formData.currency !== undefined) patch.currency = assertCurrency(formData.currency);
  if (formData.partner !== undefined) patch.partner = emptyToNull(formData.partner);
  if (formData.commission_cents !== undefined)
    patch.commission_cents = Math.max(Math.round(Number(formData.commission_cents) || 0), 0);
  if (formData.commission_mode !== undefined) patch.commission_mode = commissionMode(formData.commission_mode);
  if (formData.commission_percent !== undefined)
    patch.commission_percent = parseCommissionPercent(formData.commission_percent);
  if (formData.net_cents !== undefined)
    patch.net_cents = Math.max(Math.round(Number(formData.net_cents) || 0), 0);
  const { error } = await supabase
    .from("activities")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/activities");
}

function slugifyActivityName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createActivity(formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();

  const name = String(formData.name || "").trim();
  if (!name) throw new Error("Activity name is required");

  const category = String(formData.category || "").trim();
  if (!category) throw new Error("Category is required");

  const slug = String(formData.slug || "").trim().toLowerCase() || slugifyActivityName(name);
  if (!slug) throw new Error("A valid slug is required");

  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) throw new Error(`An activity with the slug "${slug}" already exists`);

  const { data: inserted, error } = await supabase
    .from("activities")
    .insert({
      name,
      slug,
      category,
      location: emptyToNull(formData.location),
      description: emptyToNull(formData.description),
      short_description: emptyToNull(formData.short_description),
      duration_minutes: formData.duration_minutes ?? null,
      max_guests: formData.max_guests ?? null,
      base_price_cents: Math.max(Math.round(Number(formData.base_price_cents) || 0), 0),
      currency: assertCurrency(formData.currency),
      price_note: emptyToNull(formData.price_note),
      image: emptyToNull(formData.image),
      gopro: Boolean(formData.gopro),
      active: formData.active !== false,
      partner: emptyToNull(formData.partner),
      commission_cents: Math.max(Math.round(Number(formData.commission_cents) || 0), 0),
      commission_mode: commissionMode(formData.commission_mode),
      commission_percent: parseCommissionPercent(formData.commission_percent),
      net_cents: Math.max(Math.round(Number(formData.net_cents) || 0), 0),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const pricing = Array.isArray(formData.pricing) ? (formData.pricing as Array<Record<string, unknown>>) : [];
  const rows = pricing
    .map((p, i) => ({
      activity_id: inserted.id,
      label: String(p.label || "").trim(),
      price_cents: Math.max(Math.round(Number(p.price_cents) || 0), 0),
      pricing_unit: String(p.pricing_unit || "per_person") as "per_person" | "per_unit" | "per_hour",
      note: emptyToNull(p.note),
      sort_order: Number(p.sort_order) || i,
      currency: assertCurrency(p.currency),
    }))
    .filter((r) => r.label);
  if (rows.length > 0) {
    const { error: pErr } = await supabase.from("activity_pricing").insert(rows);
    if (pErr) throw new Error(pErr.message);
  }

  revalidatePath("/admin/activities");
  return inserted;
}

export async function deleteActivity(id: string) {
  const { supabase } = await requireAuth();

  const guards: Array<[string, string]> = [
    ["bookings", "Bookings"],
    ["trips", "Trips"],
    ["consent_forms", "Consent forms"],
    ["consent_checkin_sessions", "Check-in"],
    ["incident_reports", "Incidents"],
  ];
  const refs: string[] = [];
  for (const [table, label] of guards) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("activity_id", id);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) refs.push(`${label} (${count})`);
  }
  if (refs.length > 0) {
    throw new Error(`Cannot delete: ${refs.join(", ")} reference this activity. Mark it inactive instead.`);
  }

  const { error } = await supabase.from("activities").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

// =============================================
// ACTIVITY SCHEDULES
// =============================================
export async function getSchedules(date?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("activity_schedules")
    .select("*, activities(name, slug)")
    .order("scheduled_date", { ascending: true });
  if (date) query = query.eq("scheduled_date", date);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createSchedule(formData: {
  activity_id: string;
  scheduled_date: string;
  start_time?: string;
  end_time?: string;
  available_spots: number;
  notes?: string;
}) {
  const { supabase, user } = await requireAuth();
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();
  const { error } = await supabase.from("activity_schedules").insert({
    ...formData,
    created_by: staff?.id || null,
  });
  if (error) throw error;
  revalidatePath("/admin/activities");
}

// =============================================
// CUSTOMERS
// =============================================
export async function getCustomers(search?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("customers")
    .select("id, full_name, email, phone, nationality, hotel, room_number, emergency_contact_name, emergency_contact_phone, created_at, updated_at")
    .order("full_name");
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,hotel.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCustomer(id: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, email, phone, nationality, passport_number, date_of_birth, hotel, room_number, emergency_contact_name, emergency_contact_phone, medical_conditions, allergies, medications, notes, created_at, updated_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createCustomer(data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeCustomer(data);
  if (!clean.full_name) throw new Error("Full name is required");
  if (!clean.email || !VALID_EMAIL_RE.test(clean.email.trim())) {
    throw new Error("A valid email is required");
  }
  const { data: result, error } = await supabase
    .from("customers")
    .insert(clean)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function updateCustomer(id: string, data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeCustomer(data);
  if (clean.email && !VALID_EMAIL_RE.test(clean.email.trim())) {
    throw new Error("A valid email is required");
  }
  const { data: result, error } = await supabase
    .from("customers")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

// =============================================
// BOOKINGS
// =============================================
export async function getBookings(status?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("bookings")
    .select(
      // customers.email is here because staff need to see who a booking belongs
      // to without opening it: it is the address the invoice and waiver go to.
      "*, activities(name, slug), customers(full_name, phone, hotel, email), trips(trip_ref, start_time, status), consent_forms(id, status, consent_type, activity_name, guest_name, signing_token), payments(amount_cents, converted_amount_cents, status)",
    )
    .order("created_at", { ascending: false });
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Latest active (pending/signed) activity consent form for a booking, incl. its signing token. */
export async function getConsentForBooking(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("consent_forms")
    .select("id, status, consent_type, activity_name, guest_name, booking_ref, signing_token, signing_token_expires_at, phone, signed_at")
    .eq("booking_id", bookingId)
    .eq("consent_type", "activity")
    .in("status", ["pending", "signed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBooking(id: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("bookings")
    .select("*, activities(*, activity_pricing(*)), customers(id, full_name, email, phone, nationality, hotel, room_number, emergency_contact_name, emergency_contact_phone), trips(trip_ref, start_time, status)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Keep the guest's email on the customer record.
 *
 * 072 gates every booking INSERT on a valid customer email, and 71 of the 75
 * customer rows predate that column, so staff editing a booking would otherwise
 * have to leave the booking to go and fix the customer first. Called from both
 * booking actions with whatever the form shows, which is the customer's current
 * address unless someone corrected it.
 *
 * Never blanks an address that is already valid: an empty field means "I did not
 * touch this", not "delete the guest's email".
 */
async function saveCustomerEmail(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  customerId: string,
  email: unknown
): Promise<void> {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!isValidEmail(clean) || !customerId) return;
  const { error } = await supabase
    .from("customers")
    .update({ email: clean, updated_at: new Date().toISOString() })
    .eq("id", customerId);
  // A failed email write must not sink the booking save, but the booking itself
  // will hit the database gate if the customer still has none, so let that speak.
  if (error) console.error("Failed to save customer email:", error.message);
}

export async function createBooking(data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeBookingCreate(data);
  if (!clean.customer_id) throw new Error("Customer is required");
  if (!clean.activity_id) throw new Error("Activity is required");
  if (!clean.guest_agreed) {
    throw new Error("You must confirm the guest agreed to the consent & liability before saving a booking.");
  }
  // Save first, then check: the form's address is the one the staff member is
  // looking at, and for 71 legacy customers it is the only way to satisfy the gate.
  await saveCustomerEmail(supabase, clean.customer_id, data.guest_email);

  // Every booking requires a customer with a valid email (copies/receipts are sent there)
  const { data: customer } = await supabase
    .from("customers")
    .select("email")
    .eq("id", clean.customer_id)
    .maybeSingle();
  const customerEmail = (customer?.email as string | null) || "";
  if (!VALID_EMAIL_RE.test(customerEmail.trim())) {
    throw new Error("This customer needs a valid email before a booking can be saved.");
  }
  const booking_ref = `OB-${Date.now().toString(36).toUpperCase()}`;
  const { data: result, error } = await supabase
    .from("bookings")
    .insert({
      ...clean,
      booking_ref,
      guest_agreed_at: new Date().toISOString(),
      agreement_version: "booking-enquiry-v1",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

/** Allowed booking statuses. */
const VALID_BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];

/** Quick status-only update. Validates allowed status, preserves all other fields. */
/**
 * Best-effort WhatsApp + email confirmation to the guest (no-op unless
 * OpenWA/Resend are configured). Never throws — the booking update
 * must never fail because of messaging.
 */
async function notifyBookingConfirmed(bookingId: string) {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("bookings")
      .select(`
        booking_ref, activity_id, booking_date, preferred_time,
        activities(name),
        customers(full_name, phone, email)
      `)
      .eq("id", bookingId)
      .maybeSingle();
    if (!data) return;
    const phone = (data.customers as { phone?: string } | null)?.phone || "";
    const email = (data.customers as { email?: string } | null)?.email || "";
    const guestName = (data.customers as { full_name?: string } | null)?.full_name || "Guest";
    if (!phone && !email) return;
    const message = buildBookingConfirmationMessage({
      guestName,
      activity: (data.activities as { name?: string } | null)?.name || "",
      date: data.booking_date ? friendlyDate(String(data.booking_date)) : "",
      time: (data.preferred_time as string | null) || "",
      reference: String(data.booking_ref || ""),
    });
    if (phone) await sendWhatsAppText(phone, message);
    if (email) {
      await sendEmail({
        to: email,
        subject: `Your Thoddoo Marine booking is confirmed: ${data.booking_ref || ""}`.replace(/\s+/g, " ").trim(),
        text: message,
      });
    }
  } catch {
    // messaging is advisory; ignore any failure
  }
}

/**
 * Status update of a single booking.
 */
export async function updateBookingStatus(bookingId: string, status: string) {
  if (!VALID_BOOKING_STATUSES.includes(status)) {
    throw new Error(`Invalid booking status: "${status}". Must be one of: ${VALID_BOOKING_STATUSES.join(", ")}`);
  }
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("bookings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);
  // Confirmed bookings get a trip list entry (attach or draft-create).
  if (status === "confirmed") {
    try {
      await ensureTripForBooking(bookingId);
    } catch {
      // Auto-trip is optimistic; never block the status change on it.
    }
    // Auto-send the guest a confirmation over WhatsApp when OpenWA is configured.
    await notifyBookingConfirmed(bookingId);
  }
  revalidatePath("/admin/bookings");
}

/**
 * Partial update of a booking — whitelist-only, never overwrites generated/protected fields.
 * Uses sanitizeBookingPatch: only validates fields actually present, never adds missing keys.
 * Protected fields never accepted: id, booking_ref, created_at, created_by,
 * payment_status, agreement evidence fields, exchange-rate snapshots, converted currency snapshots.
 */
export async function updateBooking(id: string, data: Record<string, unknown>) {
  const supabase = await getSupabase();
  // Adding commission to an old trip and adding the guest's email are the same
  // visit; neither should require leaving the booking to go fix the customer.
  if (data.customer_id) {
    await saveCustomerEmail(supabase, String(data.customer_id), data.guest_email);
  }
  const patch = sanitizeBookingPatch(data);
  if (Object.keys(patch).length === 0) {
    throw new Error("No valid fields to update");
  }
  const { data: result, error } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/bookings");
  return result;
}

// =============================================
// EQUIPMENT
// =============================================
export async function getEquipment() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("equipment")
    .select("id, name, asset_number, category, description, condition_status, active, daily_rate_cents, deposit_cents, currency, photo_url, created_at")
    .order("name");
  if (error) throw error;
  return data;
}

export async function createEquipment(data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeEquipment(data);
  if (!clean.name) throw new Error("Name is required");
  if (!clean.asset_number) throw new Error("Asset number is required");
  if (!clean.category) throw new Error("Category is required");
  const { data: result, error } = await supabase
    .from("equipment")
    .insert(clean)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function updateEquipment(id: string, data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeEquipment(data);
  const { data: result, error } = await supabase
    .from("equipment")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

// =============================================
// EQUIPMENT RENTALS
// =============================================
export async function getRentals(status?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("equipment_rentals")
    .select(
      "*, equipment(name, asset_number), customers(full_name, phone, email), consent_forms(status, guest_name, is_minor, signed_at), payments(amount_cents, converted_amount_cents, currency, method, reference, notes, status, created_at, recorded_by)"
    )
    .order("created_at", { ascending: false });
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];

  // Walk-in baskets (migration 085): the signed waiver hangs off the REQUEST,
  // not off each unit. Attach it to every row of the basket so the Consent
  // column shows the real state instead of "—".
  const requestIds = [...new Set(rows.map((r) => r.rental_request_id).filter(Boolean))] as string[];
  if (requestIds.length > 0) {
    const { data: requestConsents, error: reqConsentErr } = await supabase
      .from("consent_forms")
      .select("rental_request_id, status, guest_name, is_minor, signed_at")
      .in("rental_request_id", requestIds);
    if (reqConsentErr) throw reqConsentErr;
    const byRequest = new Map<string, Record<string, unknown>>();
    for (const c of requestConsents || []) {
      if (c.rental_request_id) byRequest.set(String(c.rental_request_id), c as Record<string, unknown>);
    }
    for (const r of rows) {
      const hasConsent = Array.isArray(r.consent_forms)
        ? r.consent_forms.length > 0
        : Boolean(r.consent_forms);
      if (!hasConsent && r.rental_request_id) {
        const c = byRequest.get(String(r.rental_request_id));
        if (c) r.consent_forms = [c];
      }
    }
  }

  return rows;
}

export async function checkoutEquipment(data: Record<string, unknown>) {
  const { supabase, user } = await requireAuth();
  const clean = {
    equipment_id: data.equipment_id as string,
    customer_id: data.customer_id as string,
    booking_id: emptyToNull(data.booking_id),
    checkout_condition: emptyToNull(data.checkout_condition) || "excellent",
    expected_return_at: data.expected_return_at as string,
    rental_charge_cents: typeof data.rental_charge_cents === "number" ? data.rental_charge_cents : 0,
    deposit_cents: typeof data.deposit_cents === "number" ? data.deposit_cents : 0,
  };
  if (!clean.equipment_id) throw new Error("Equipment is required");
  if (!clean.customer_id) throw new Error("Customer is required");
  if (!clean.expected_return_at) throw new Error("Expected return date is required");
  const {
    data: staff,
    error: staffError,
  } = await supabase.from("staff_profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) throw new Error("Current staff profile not found — checkout must be performed by signed-in staff");
  const {
    data: inflight,
    error: inflightError,
  } = await supabase
    .from("equipment_rentals")
    .select("id")
    .eq("equipment_id", clean.equipment_id)
    .in("status", ["checked_out", "overdue"])
    .maybeSingle();
  if (inflightError) throw new Error(inflightError.message);
  if (inflight) throw new Error("This equipment is already checked out (double checkout blocked)");
  const { data: result, error } = await supabase
    .from("equipment_rentals")
    .insert({
      equipment_id: clean.equipment_id,
      customer_id: clean.customer_id,
      booking_id: clean.booking_id,
      checkout_condition: clean.checkout_condition,
      expected_return_at: clean.expected_return_at,
      rental_charge_cents: clean.rental_charge_cents,
      deposit_cents: clean.deposit_cents,
      status: "checked_out",
      checked_out_by: staff.id,
      currency: assertCurrency(data.currency),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Auto-create the pending consent & liability form for this rental.
  const { error: consentError } = await supabase.rpc("create_rental_consent", {
    p_rental_id: result.id,
  });
  if (consentError) {
    await supabase.from("equipment_rentals").delete().eq("id", result.id);
    throw new Error(consentError.message);
  }

  return result;
}

export async function returnEquipment(rentalId: string, data: Record<string, unknown>) {
  const { supabase, user } = await requireAuth();
  const {
    data: staff,
    error: staffError,
  } = await supabase.from("staff_profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) throw new Error("Current staff profile not found — return must be performed by signed-in staff");

  // Mandatory consent gate: do not allow return until the liability waiver is signed.
  // Walk-in baskets (migration 085) have ONE signed waiver covering every unit in
  // the request, so a unit whose consent row is only linked through its request
  // must still pass — otherwise rows 2..N could never be returned.
  const { data: rentalRow, error: rentalRowErr } = await supabase
    .from("equipment_rentals")
    .select("rental_request_id")
    .eq("id", rentalId)
    .single();
  if (rentalRowErr) throw new Error(rentalRowErr.message);

  let consentQuery = supabase
    .from("consent_forms")
    .select("id")
    .eq("consent_type", "equipment_rental")
    .eq("status", "signed");
  if (rentalRow?.rental_request_id) {
    consentQuery = consentQuery.eq("rental_request_id", String(rentalRow.rental_request_id));
  } else {
    consentQuery = consentQuery.eq("rental_id", rentalId);
  }
  const { data: signedConsent, error: consentQueryError } = await consentQuery.maybeSingle();
  if (consentQueryError) throw new Error(consentQueryError.message);
  if (!signedConsent) {
    throw new Error("Guest consent & liability form must be signed before this rental can be returned.");
  }

  // Additional charges are set at return, so the paid/partial flag has to be
  // recomputed in the same write — otherwise a rental that has just become
  // owing money keeps saying "paid".
  const [{ data: rental, error: rentErr }, { data: rentalPayments, error: payErr }] = await Promise.all([
    supabase.from("equipment_rentals").select("rental_charge_cents, additional_charges_cents").eq("id", rentalId).single(),
    supabase.from("payments").select("amount_cents, converted_amount_cents").eq("rental_id", rentalId).eq("status", "completed"),
  ]);
  if (rentErr) throw new Error(rentErr.message);
  if (payErr) throw new Error(payErr.message);

  const addedCharges = typeof data.additional_charges_cents === "number" ? data.additional_charges_cents : 0;
  const payable = (Number(rental?.rental_charge_cents) || 0) + addedCharges;
  const paid = ((rentalPayments || []) as { amount_cents: number | null; converted_amount_cents: number | null }[])
    .reduce((sum, p) => sum + Math.max(Number(p.converted_amount_cents ?? p.amount_cents) || 0, 0), 0);
  const paymentStatus = paid <= 0 ? "unpaid" : payable > 0 && paid >= payable ? "paid" : "partial";

  const { error } = await supabase
    .from("equipment_rentals")
    .update({
      return_condition: emptyToNull(data.return_condition) || "good",
      damage_notes: emptyToNull(data.damage_notes),
      additional_charges_cents: addedCharges,
      returned_at: new Date().toISOString(),
      returned_to: staff.id,
      status: "returned",
      payment_status: paymentStatus,
    })
    .eq("id", rentalId);
  if (error) throw new Error(error.message);
}

// =============================================
// WALK-IN RENTAL REQUESTS (QR self-service, migration 085)
// =============================================

export interface RentalRequestConsent {
  id?: string;
  status?: string | null;
  signed_at?: string | null;
  is_minor?: boolean | null;
  signature_data_url?: string | null;
  signing_token?: string | null;
  signing_token_expires_at?: string | null;
}

export interface RentalRequestRow {
  id: string;
  guest_name: string;
  email?: string | null;
  phone?: string | null;
  hotel?: string | null;
  room_number?: string | null;
  items: Array<{ name: string; qty: number }>;
  notes?: string | null;
  status: string;
  created_at: string;
  issued_at?: string | null;
  consent_forms?: RentalRequestConsent[] | RentalRequestConsent | null;
}

const requestConsent = (r: RentalRequestRow | Record<string, unknown>): RentalRequestConsent | null => {
  const raw = (r as RentalRequestRow).consent_forms;
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) ?? null;
};

/** Queue of guest-built walk-in rental baskets waiting to be issued. */
export async function getRentalRequests(): Promise<RentalRequestRow[]> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("rental_requests")
    .select(
      // The FK hint is required: rental_requests points at consent_forms
      // twice (consent_form_id, plus consent_forms.rental_request_id back
      // from 085), and an unhinted embed is rejected as ambiguous (PGRST201)
      // — which is what blanked the rentals page.
      "id, guest_name, email, phone, hotel, room_number, items, notes, status, created_at, issued_at, consent_forms!consent_forms_rental_request_id_fkey(id, status, signed_at, is_minor, signing_token, signing_token_expires_at)"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data || []) as unknown as RentalRequestRow[];
}

/** Pull an unissued request back off the queue (its waiver is voided too). */
export async function cancelRentalRequest(requestId: string) {
  const { supabase } = await requireAuth();
  if (!requestId) throw new Error("Request is required");
  const { data: req, error: reqErr } = await supabase
    .from("rental_requests")
    .select("id, status, consent_form_id")
    .eq("id", requestId)
    .single();
  if (reqErr) throw new Error(reqErr.message);
  if (req.status !== "open") throw new Error("This request is no longer open.");

  const { error: cancelErr } = await supabase
    .from("rental_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", requestId);
  if (cancelErr) throw new Error(cancelErr.message);

  // Only a PENDING waiver can be voided directly: 080 makes a signed consent
  // immutable except through its own transaction-local flag. A signed-but-
  // unissued waiver is superseded automatically the next time this guest
  // submits a walk-in request (submit_rental_request sets the flag there).
  if (req.consent_form_id) {
    const { error: voidErr } = await supabase
      .from("consent_forms")
      .update({ status: "voided" })
      .eq("id", req.consent_form_id)
      .eq("status", "pending");
    if (voidErr) throw new Error(voidErr.message);
  }
}

export interface RentalIssueUnitInput {
  equipment_id: string;
  charge_cents: number;
  deposit_cents: number;
}

export interface RentalIssueInput {
  units: RentalIssueUnitInput[];
  expected_return_at: string;
  currency: string;
  payment_amount_cents?: number;
  payment_method?: string;
  payment_reference?: string;
}

/**
 * Hand over the gear for a walk-in request: assign numbered units, write the
 * rental rows (linked back to the request), carry the guest's waiver signature
 * onto each unit and optionally take the money — all or nothing.
 */
export async function issueRentalRequest(requestId: string, input: RentalIssueInput) {
  const { supabase, user } = await requireAuth();
  if (!requestId) throw new Error("Request is required");
  if (!input.expected_return_at) throw new Error("Expected return date & time is required");
  const currency = assertCurrency(input.currency);

  const units = Array.isArray(input.units) ? input.units : [];
  if (units.length === 0) throw new Error("Assign at least one unit to hand over.");
  const unitIds = units.map((u) => String(u.equipment_id || ""));
  if (unitIds.some((id) => !id)) throw new Error("Every unit needs an equipment selection.");
  if (new Set(unitIds).size !== unitIds.length) throw new Error("The same unit cannot be handed over twice.");
  for (const u of units) {
    if (Math.round(Number(u.charge_cents) || 0) < 0 || Math.round(Number(u.deposit_cents) || 0) < 0) {
      throw new Error("Charges and deposits cannot be negative.");
    }
  }

  const { data: staff, error: staffError } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) throw new Error("Current staff profile not found — issue must be performed by signed-in staff");

  const { data: req, error: reqErr } = await supabase
    .from("rental_requests")
    .select("id, customer_id, status, items, consent_forms(id, status, signed_at, signature_data_url)")
    .eq("id", requestId)
    .single();
  if (reqErr) throw new Error(reqErr.message);
  if (req.status !== "open") throw new Error("This request is no longer open.");
  const consent = requestConsent(req as unknown as RentalRequestRow);

  // The basket decides HOW MANY units of each type go out; staff decide WHICH ones.
  const requested: Record<string, number> = {};
  let totalQty = 0;
  for (const raw of (req.items as Array<{ name?: string; qty?: number }> | null) || []) {
    const name = String(raw.name || "").trim();
    const qty = Math.round(Number(raw.qty) || 0);
    if (!name || qty < 1) continue;
    requested[name] = (requested[name] || 0) + qty;
    totalQty += qty;
  }
  if (units.length !== totalQty) {
    throw new Error(`Select exactly ${totalQty} unit${totalQty === 1 ? "" : "s"} to match the guest's request.`);
  }

  const { data: eqRows, error: eqErr } = await supabase
    .from("equipment")
    .select("id, name, active")
    .in("id", unitIds);
  if (eqErr) throw new Error(eqErr.message);
  const byId = new Map((eqRows || []).map((e) => [String(e.id), e]));
  const assigned: Record<string, number> = {};
  for (const id of unitIds) {
    const eq = byId.get(id);
    if (!eq) throw new Error("One of the selected units no longer exists.");
    if (!eq.active) throw new Error(`${eq.name} is no longer active.`);
    assigned[eq.name] = (assigned[eq.name] || 0) + 1;
  }
  for (const [name, qty] of Object.entries(requested)) {
    if ((assigned[name] || 0) !== qty) {
      throw new Error(`Assign exactly ${qty} × ${name} (${assigned[name] || 0} selected).`);
    }
  }

  // Double-checkout guard — the same guard checkoutEquipment applies, per unit.
  const { data: inflight, error: inflightErr } = await supabase
    .from("equipment_rentals")
    .select("id, equipment_id, equipment(name)")
    .in("equipment_id", unitIds)
    .in("status", ["checked_out", "overdue"]);
  if (inflightErr) throw new Error(inflightErr.message);
  if (inflight && inflight.length > 0) {
    const name = (inflight[0].equipment as { name?: string } | null)?.name || "One of these units";
    throw new Error(`${name} is already checked out.`);
  }

  const totalChargeCents = units.reduce((s, u) => s + (Math.round(Number(u.charge_cents) || 0)), 0);
  const payCents = Math.round(Number(input.payment_amount_cents) || 0);
  if (payCents > totalChargeCents) {
    throw new Error(
      `Payment is more than the total rental charges (${totalChargeCents} ${currency}). Deposits are held separately and are not part of this payment.`
    );
  }

  const rows = units.map((u) => ({
    equipment_id: u.equipment_id,
    customer_id: req.customer_id,
    rental_request_id: requestId,
    checkout_condition: "good",
    expected_return_at: input.expected_return_at,
    rental_charge_cents: Math.round(Number(u.charge_cents) || 0),
    deposit_cents: Math.round(Number(u.deposit_cents) || 0),
    status: "checked_out",
    checked_out_by: staff.id,
    currency,
    guest_signature_data_url: consent?.signature_data_url || null,
    guest_signed_at: consent?.signed_at || null,
  }));

  const { data: created, error: insErr } = await supabase
    .from("equipment_rentals")
    .insert(rows)
    .select("id, rental_charge_cents");
  if (insErr) throw new Error(insErr.message);
  const createdRows = (created || []) as Array<{ id: string; rental_charge_cents: number }>;

  // Park the one waiver on the first unit: it frees the unique-index slot so the
  // same guest can raise another walk-in request later, and the return gate still
  // finds the waiver through rental_request_id for every unit in the basket.
  if (consent?.id) {
    const { error: linkErr } = await supabase
      .from("consent_forms")
      .update({ rental_id: createdRows[0].id })
      .eq("id", consent.id);
    if (linkErr) {
      await supabase.from("equipment_rentals").delete().in("id", createdRows.map((r) => r.id));
      throw new Error(linkErr.message);
    }
  }

  // Payment: one guest, one basket — split the amount across the units that
  // actually carry a charge so each row's own paid/partial flag stays honest.
  if (payCents > 0) {
    const chargeRows = createdRows.filter((r) => Math.round(Number(r.rental_charge_cents) || 0) > 0);
    let remaining = payCents;
    for (let i = 0; i < chargeRows.length; i++) {
      const row = chargeRows[i];
      const charge = Math.round(Number(row.rental_charge_cents) || 0);
      const share =
        i === chargeRows.length - 1
          ? remaining
          : Math.max(0, Math.min(Math.round((payCents * charge) / totalChargeCents), remaining, charge));
      remaining -= share;
      if (share <= 0) continue;
      const { error: payError } = await supabase.rpc("create_rental_payment", {
        p_rental_id: row.id,
        p_amount_cents: share,
        p_currency: currency,
        p_method: (input.payment_method as string) || "cash",
        p_reference: input.payment_reference || null,
        p_notes: "Collected when the walk-in request was issued",
      });
      if (payError) {
        throw new Error(
          `Equipment was issued, but recording the payment failed: ${payError.message}. Take the remaining payment from the Rentals table.`
        );
      }
    }
  }

  const { error: issuedErr } = await supabase
    .from("rental_requests")
    .update({ status: "issued", issued_at: new Date().toISOString() })
    .eq("id", requestId);
  if (issuedErr) throw new Error(issuedErr.message);

  revalidatePath("/admin/rentals");
  return { issued: createdRows.length, rental_ids: createdRows.map((r) => r.id) };
}

// =============================================
// CONSENT FORMS
// =============================================
export async function getConsentForms(status?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("consent_forms")
    .select("id, guest_name, consent_type, booking_ref, hotel, status, signed_at, signing_token, signing_token_expires_at, void_reason, activity_name, activities(name)")
    .order("created_at", { ascending: false });
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getConsentForm(id: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("consent_forms")
    .select("*, activities(name)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createConsentForm(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeConsentForm(data);
  if (!clean.customer_id) throw new Error("Customer is required");
  if (!clean.guest_name) throw new Error("Guest name is required");
  if (!clean.activity_id) throw new Error("Activity is required");

  // Validate customer exists
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("id", clean.customer_id)
    .single();
  if (!customer) throw new Error("Customer not found");

  // If booking supplied, validate it belongs to this customer and is not cancelled
  if (clean.booking_id) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, customer_id, status")
      .eq("id", clean.booking_id)
      .single();
    if (!booking) throw new Error("Booking not found");
    if (booking.customer_id !== clean.customer_id) throw new Error("Booking does not belong to this customer");
    if (booking.status === "cancelled") throw new Error("Cannot create consent for a cancelled booking");
  }

  // Look up activity_name from activities table
  const { data: activity } = await supabase
    .from("activities")
    .select("name")
    .eq("id", clean.activity_id)
    .single();
  if (!activity) throw new Error("Activity not found");

  // Always use "activity" consent type — rental agreements stay under Rentals
  const insertData: Record<string, unknown> = {
    customer_id: clean.customer_id,
    activity_id: clean.activity_id,
    activity_name: activity.name,
    guest_name: clean.guest_name,
    consent_type: "activity",
    form_version: clean.form_version || "1.0",
  };
  if (clean.booking_id) insertData.booking_id = clean.booking_id;
  if (clean.guest_email) insertData.phone = clean.guest_email;
  if (clean.guest_phone) insertData.phone = clean.guest_phone;

  // signing_token and signing_token_expires_at are auto-set by DB trigger
  const { data: result, error } = await supabase
    .from("consent_forms")
    .insert(insertData)
    .select("id, signing_token")
    .single();
  if (error) {
    // Friendly message for unique constraint violation (e.g. duplicate consent for same booking+guest)
    if (error.code === "23505") {
      throw new Error("A consent form already exists for this guest and activity. Please check existing forms or void the previous one first.");
    }
    throw new Error(error.message);
  }
  return result;
}

export async function voidConsentForm(id: string, reason: string) {
  const { supabase } = await requireAuth();
  if (!reason || !reason.trim()) throw new Error("Void reason is required");
  const { data, error } = await supabase.rpc("void_consent_form", {
    p_consent_id: id,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as Record<string, string>).message || "Failed to void consent form");
  }
}

/**
 * @deprecated Staff signing must go through the browser Supabase client calling
 * staff_sign_consent RPC directly — NOT through a Server Action.
 * Next.js development logs print Server Action arguments, which would expose signature data.
 */
export async function signConsentForm(_signingToken: string, _data: Record<string, unknown>) {
  throw new Error(
    "Server-side signing is disabled for security. " +
    "Staff must sign using the browser client directly."
  );
}

// =============================================
// INCIDENT REPORTS
// =============================================
export async function getIncidents(resolved?: boolean) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("incident_reports")
    .select("*, activities(name), customers(full_name), bookings(booking_ref)")
    .order("incident_date", { ascending: false });
  if (resolved !== undefined) query = query.eq("resolved", resolved);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Full incident record with linked booking/customer/activity and damage charges, for a printable report. */
export async function getIncidentReport(id: string) {
  const { supabase } = await requireAuth();
  if (!id) throw new Error("Incident ID is required");
  const { data: incident, error } = await supabase
    .from("incident_reports")
    .select(
      "*, activities(name), customers(full_name, phone, nationality), bookings(booking_ref, status, payment_status, booking_currency, total_cents, created_at)"
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  if (!incident) throw new Error("Incident not found");

  let charges: unknown[] = [];
  if (incident.booking_id) {
    const bookingId = incident.booking_id as string;
    try {
      charges = (await getBookingCharges(bookingId)).filter(
        (c) => !(c as unknown as { voided_at?: string | null }).voided_at
      );
    } catch {
      charges = [];
    }
  }
  return { incident, charges };
}

export async function createIncident(data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeIncident(data);
  if (!clean.description) throw new Error("Description is required");
  const { data: result, error } = await supabase
    .from("incident_reports")
    .insert(clean)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

export async function updateIncident(id: string, data: Record<string, unknown>) {
  const supabase = await getSupabase();
  const clean = sanitizeIncident(data);
  const { data: result, error } = await supabase
    .from("incident_reports")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return result;
}

// =============================================
// EXPENSES (owner & manager only)
// =============================================
export async function getExpenses(from?: string, to?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("expenses")
    .select("*")
    .is("archived_at", null)
    .order("expense_date", { ascending: false });
  if (from) query = query.gte("expense_date", from);
  if (to) query = query.lte("expense_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getAllExpenses() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .is("archived_at", null)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createExpense(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeExpense(data);
  if (!clean.title) throw new Error("Expense title is required");
  if (Number(clean.amount_cents) <= 0) throw new Error("Amount must be greater than zero");
  const { data: result, error } = await supabase
    .from("expenses")
    .insert(clean)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/expenses");
  return result;
}

export async function updateExpense(id: string, data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeExpense(data);
  if (!clean.title) throw new Error("Expense title is required");
  const { data: result, error } = await supabase
    .from("expenses")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/expenses");
  return result;
}

export async function deleteExpense(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/expenses");
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function assertMonth(month: string) {
  if (!MONTH_RE.test(String(month || ""))) throw new Error("Month must be YYYY-MM.");
}

/** One month of grid-entered expenses (rows carrying an entry_key). */
export async function getExpenseGrid(month: string) {
  assertMonth(month);
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .gte("expense_date", `${month}-01`)
    .lt("expense_date", nextMonthStart(month))
    .not("entry_key", "is", null)
    .order("expense_date");
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Save a whole month of the sheet. Each filled cell is one expense row keyed
 * by `YYYY-MM-DD:column`; cells cleared since the last save are deleted, so
 * re-saving a month never piles up duplicates.
 */
export async function saveExpenseGrid(month: string, drafts: ExpenseDraft[]) {
  assertMonth(month);
  const { supabase } = await requireAuth();

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const d of drafts || []) {
    const cents = Math.round(Number(d?.amount_cents) || 0);
    if (cents <= 0) continue;
    const key = String(d?.entry_key || "");
    const date = String(d?.expense_date || "");
    if (!key.startsWith(`${month}-`) || !date.startsWith(month)) {
      throw new Error(`Grid row ${key || "?"} is outside ${month}.`);
    }
    if (seen.has(key)) throw new Error(`Duplicate grid cell ${key}.`);
    seen.add(key);
    rows.push({
      entry_key: key,
      expense_date: date,
      title: String(d.title || "Expense").trim().slice(0, 200),
      category: normalizeExpenseCategory(d.category),
      amount_cents: cents,
      currency: d.currency === "USD" ? "USD" : "MVR",
      notes: emptyToNull(String(d.notes || "")),
    });
  }

  const { data: existing, error: exErr } = await supabase
    .from("expenses")
    .select("id, entry_key")
    .gte("expense_date", `${month}-01`)
    .lt("expense_date", nextMonthStart(month))
    .not("entry_key", "is", null);
  if (exErr) throw new Error(exErr.message);

  const byKey = new Map<string, string>(
    ((existing || []) as Array<{ id: string; entry_key: string }>).map((r) => [String(r.entry_key), String(r.id)])
  );

  for (const row of rows) {
    const id = byKey.get(String(row.entry_key));
    if (id) {
      const { error } = await supabase.from("expenses").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      byKey.delete(String(row.entry_key));
    } else {
      const { error } = await supabase.from("expenses").insert(row);
      if (error) throw new Error(error.message);
    }
  }

  const cleared = [...byKey.values()];
  if (cleared.length) {
    const { error } = await supabase.from("expenses").delete().in("id", cleared);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin/expenses");
  return { saved: rows.length, cleared: cleared.length };
}

/**
 * Import pasted/CSV expense rows (parsed by `parseExpenseImport`). Valid rows
 * go in; bad ones are reported rather than thrown, so a half-tidy paste still
 * lands what it can.
 */
export async function importExpenseRows(rows: ExpenseImportRow[]) {
  const { supabase } = await requireAuth();
  const out: Record<string, unknown>[] = [];
  const errors: string[] = [];
  (rows || []).forEach((r, i) => {
    const n = i + 1;
    const date = String(r?.expense_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Row ${n}: unreadable date "${date}".`);
      return;
    }
    const title = String(r?.title || "").trim();
    if (!title) {
      errors.push(`Row ${n}: missing title.`);
      return;
    }
    const cents = Math.round(Number(r?.amount_cents) || 0);
    if (cents <= 0) {
      errors.push(`Row ${n}: amount must be above zero.`);
      return;
    }
    out.push({
      expense_date: date,
      title: title.slice(0, 200),
      category: normalizeExpenseCategory(r?.category),
      amount_cents: cents,
      currency: r?.currency === "USD" ? "USD" : "MVR",
      vendor: emptyToNull(String(r?.vendor || "")),
      notes: emptyToNull(String(r?.notes || "")),
    });
  });
  if (out.length) {
    const { error } = await supabase.from("expenses").insert(out);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/expenses");
  }
  return { imported: out.length, skipped: errors.length, errors };
}

export async function getOtherIncome(from?: string, to?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("other_income")
    .select("*")
    .is("archived_at", null)
    .order("income_date", { ascending: false });
  if (from) query = query.gte("income_date", from);
  if (to) query = query.lte("income_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createOtherIncome(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeExpense(data);
  if (!clean.title) throw new Error("Income title is required");
  if (Number(clean.amount_cents) <= 0) throw new Error("Amount must be greater than zero");
  const patch = { ...clean };
  if (clean.expense_date) patch.income_date = clean.expense_date;
  delete patch.expense_date;
  const { data: result, error } = await supabase
    .from("other_income")
    .insert(patch)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/income");
  return result;
}

export async function updateOtherIncome(id: string, data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeExpense(data);
  if (!clean.title) throw new Error("Income title is required");
  const patch = { ...clean };
  if (clean.expense_date) patch.income_date = clean.expense_date;
  delete patch.expense_date;
  const { data: result, error } = await supabase
    .from("other_income")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/income");
  return result;
}

export async function deleteOtherIncome(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("other_income").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/income");
}

// =============================================
// ZOHO SHEET FINANCE SYNC (owner & manager only)
// =============================================
export async function syncFinanceFromSheetAction(): Promise<SyncFinanceResult> {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, role")
    .eq("user_id", user.id)
    .single();
  if (!profile || (profile.role !== "owner" && profile.role !== "manager")) {
    throw new Error("Only the owner or manager can run a sheet sync.");
  }
  const result = await syncFinanceSheets();
  if (!result.ok) {
    throw new Error(
      result.reason === "missing_env" || result.reason === "missing_service_key"
        ? "Zoho Sheet sync is not configured yet. Ask the owner to complete the Zoho Sheet setup."
        : `Sync failed: ${result.reason}`
    );
  }
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/income");
  revalidatePath("/admin/reports");
  return result;
}

/** All 14 grid columns, whole-tab scans. */
const PUSH_GRID_RANGE = "A:N";

/**
 * Push every non-archived expense into the workbook as the accountant's
 * monthly grid (Date | Detail | … | SALARY | Commission), one row per expense
 * plus a column-totals row per month. Only cells that actually changed are
 * written, so a no-change push costs a handful of calls; cells that vanished
 * from the books are cleared.
 */
export async function pushExpensesToZoho(): Promise<
  | { ok: true; rows: number; written: number; cleared: number; created: boolean }
  | { ok: false; reason: string }
> {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, role")
    .eq("user_id", user.id)
    .single();
  if (!profile || (profile.role !== "owner" && profile.role !== "manager")) {
    throw new Error("Only the owner or manager can push expenses to the sheet.");
  }
  const cfg = isFinanceConfigured();
  if (cfg !== "ok") {
    return {
      ok: false,
      reason:
        cfg === "missing_env"
          ? "Zoho Sheet sync is not configured yet. Ask the owner to complete the Zoho Sheet setup."
          : "Zoho Sheet sync is not configured yet (missing service key).",
    };
  }
  const workbookId = getFinanceWorkbookId();
  if (!workbookId) return { ok: false, reason: "FINANCE_WORKBOOK_ID is not set." };

  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .is("archived_at", null)
      .order("expense_date");
    if (error) throw new Error(error.message);

    const grid = buildZohoMonthlyGrid((data || []) as Parameters<typeof buildZohoMonthlyGrid>[0]);
    const created = await ensureWorksheet(workbookId, PUSH_TAB);

    const current = await readSheetRange(workbookId, `${PUSH_TAB}!${PUSH_GRID_RANGE}`);
    const currentMap = new Map<string, string>();
    current.forEach((r, ri) =>
      r.forEach((v, ci) => {
        if (v !== "") currentMap.set(`${ri + 1}:${ci + 1}`, v);
      }),
    );

    const toWrite: Array<{ row: number; col: number; value: string }> = [];
    for (const cell of grid.nonEmpty) {
      if (currentMap.get(`${cell.row}:${cell.col}`) !== cell.value) {
        toWrite.push({ row: cell.row, col: cell.col, value: cell.value });
      }
      currentMap.delete(`${cell.row}:${cell.col}`);
    }
    // Whatever is left was on the tab but is no longer in the books — clear it.
    const toClear = [...currentMap.keys()].map((key) => {
      const [row, col] = key.split(":").map(Number);
      return { row, col, value: "" };
    });

    await setCells(workbookId, PUSH_TAB, toWrite);
    await setCells(workbookId, PUSH_TAB, toClear);

    revalidatePath("/admin/expenses");
    return {
      ok: true,
      rows: grid.values.length - 1, // minus the header
      written: toWrite.length,
      cleared: toClear.length,
      created,
    };
  } catch (err) {
    // A Zoho failure is a toast, never a crashed page.
    return { ok: false, reason: err instanceof Error ? err.message : "Sheet push failed." };
  }
}

// =============================================
// CASH REGISTER
// =============================================
export async function getCashRegisters(from?: string, to?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("cash_registers")
    .select("*")
    .order("register_date", { ascending: false });
  if (from) query = query.gte("register_date", from);
  if (to) query = query.lte("register_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getOpenCashRegister() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("cash_registers")
    .select("*")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getCashRegisterEntries(registerId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("cash_register_entries")
    .select("*")
    .eq("register_id", registerId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function openCashRegister(data: Record<string, unknown>) {
  const { supabase, user } = await requireAuth();
  const clean = sanitizeCashRegisterOpen(data);
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const existing = await getOpenCashRegister();
  if (existing) {
    throw new Error("A cash register is already open for this business day.");
  }
  const { data: result, error } = await supabase
    .from("cash_registers")
    .insert({ ...clean, status: "open", opened_by: profile?.id || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/cashreg");
  revalidatePath("/admin/cashier");
  return result;
}

export async function closeCashRegister(id: string, data: Record<string, unknown>) {
  const { supabase, user } = await requireAuth();
  const clean = sanitizeCashRegisterClose(data);
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: result, error } = await supabase
    .from("cash_registers")
    .update({ ...clean, status: "closed", closed_by: profile?.id || null, closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/cashreg");
  revalidatePath("/admin/cashier");
  return result;
}

export async function addCashRegisterEntry(data: Record<string, unknown>) {
  const { supabase, user } = await requireAuth();
  const clean = sanitizeCashRegisterEntry(data);
  if (!clean.register_id) throw new Error("Missing cash register.");
  if (Number(clean.amount_cents) <= 0) throw new Error("Amount must be greater than zero.");
  const { data: register } = await supabase
    .from("cash_registers")
    .select("status")
    .eq("id", clean.register_id)
    .maybeSingle();
  if (!register) throw new Error("Cash register not found.");
  if (register.status !== "open") throw new Error("This cash register is closed.");
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  // Link the money to a booking: explicitly chosen in the form, or matched from
  // a typed booking ref so existing habits keep working without the picker.
  let bookingId = clean.booking_id;
  let bookingRef: string | null = null;
  if (bookingId) {
    const { data: chosen } = await supabase
      .from("bookings")
      .select("booking_ref")
      .eq("id", bookingId)
      .maybeSingle();
    if (!chosen) throw new Error("That booking no longer exists.");
    bookingRef = String(chosen.booking_ref || "");
  } else if (clean.reference && BOOKING_REF_RE.test(clean.reference)) {
    const { data: matched } = await supabase
      .from("bookings")
      .select("id, booking_ref")
      .ilike("booking_ref", clean.reference)
      .limit(1)
      .maybeSingle();
    if (matched) {
      bookingId = String(matched.id);
      bookingRef = String(matched.booking_ref || "");
    }
  }
  const { data: result, error } = await supabase
    .from("cash_register_entries")
    .insert({ ...clean, booking_id: bookingId, recorded_by: profile?.id || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/cashreg");
  revalidatePath("/admin/bookings");
  return { ...result, booking_ref: bookingRef };
}

/** Booking refs look like OB-260922-6C5E — reject anything else before querying. */
const BOOKING_REF_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export interface CashRegisterBookingCandidate {
  id: string;
  booking_ref: string;
  booking_date: string;
  guests: number | null;
  total_cents: number | null;
  net_cents: number | null;
  currency: string | null;
  payment_status: string | null;
  status: string | null;
  guest_name: string | null;
  activity_name: string | null;
  /** Cash already recorded against this booking in `payments`. */
  cash_paid_cents: number | null;
}

/**
 * Bookings offered in the till's entry form, so money in the drawer can be tied
 * to the trip it was collected for.
 */
export async function searchCashRegisterBookings(
  search: string
): Promise<CashRegisterBookingCandidate[]> {
  const { supabase } = await requireAuth();
  const term = String(search || "").trim();
  let query = supabase
    .from("bookings")
    .select(
      "id, booking_ref, booking_date, guests, total_cents, net_cents, booking_currency, payment_status, status, customer_id, activity_id"
    )
    .neq("status", "cancelled")
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(25);
  // A ref-shaped search filters to that booking; anything else just lists the
  // most recent bookings, which is what staff reach for by default.
  if (term && BOOKING_REF_RE.test(term)) query = query.ilike("booking_ref", term);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter((v): v is string => typeof v === "string"))
  );
  const activityIds = Array.from(
    new Set(rows.map((r) => r.activity_id).filter((v): v is string => typeof v === "string"))
  );
  const bookingIds = rows.map((r) => String(r.id));

  const [{ data: customers }, { data: activities }, { data: cashPaid }] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, full_name").in("id", customerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    activityIds.length
      ? supabase.from("activities").select("id, name").in("id", activityIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
    supabase
      .from("payments")
      .select("booking_id, amount_cents, converted_amount_cents, currency, booking_currency, status")
      .eq("method", "cash")
      .eq("status", "completed")
      .in("booking_id", bookingIds),
  ]);

  const nameByCustomer = new Map(
    ((customers || []) as Array<{ id: string; full_name: string | null }>).map((c) => [c.id, c.full_name])
  );
  const nameByActivity = new Map(
    ((activities || []) as Array<{ id: string; name: string | null }>).map((a) => [a.id, a.name])
  );
  const cashByBooking = new Map<string, number>();
  for (const p of (cashPaid || []) as Array<{
    booking_id: string | null; amount_cents: number | null;
    converted_amount_cents: number | null; currency: string | null; booking_currency: string | null;
  }>) {
    if (!p.booking_id) continue;
    cashByBooking.set(p.booking_id, (cashByBooking.get(p.booking_id) || 0) + paymentAmountInBookingCurrency(p));
  }

  return rows.map((r) => ({
    id: String(r.id),
    booking_ref: String(r.booking_ref || ""),
    booking_date: String(r.booking_date || ""),
    guests: typeof r.guests === "number" ? r.guests : null,
    total_cents: typeof r.total_cents === "number" ? r.total_cents : null,
    net_cents: typeof r.net_cents === "number" ? r.net_cents : null,
    currency: typeof r.booking_currency === "string" ? r.booking_currency : null,
    payment_status: typeof r.payment_status === "string" ? r.payment_status : null,
    status: typeof r.status === "string" ? r.status : null,
    guest_name: r.customer_id ? nameByCustomer.get(String(r.customer_id)) || null : null,
    activity_name: r.activity_id ? nameByActivity.get(String(r.activity_id)) || null : null,
    cash_paid_cents: cashByBooking.get(String(r.id)) ?? null,
  }));
}

/** Maldives is a fixed UTC+5, so a business day maps to a fixed UTC window. */
function maldivesDayBoundsUtc(date: string): { startIso: string; endIso: string } {
  const start = new Date(`${date}T00:00:00.000Z`).getTime() - 5 * 60 * 60 * 1000;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** The Maldives calendar date an instant belongs to. */
function maldivesDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface CashReconciliationDay {
  date: string;
  hasRegister: boolean;
  reconciliation: CashReconciliation;
}

/**
 * Cash taken against bookings versus cash actually recorded in the till, per
 * business day across the range. This is the check that catches collections
 * booked against a guest but never dropped in the drawer (and the reverse) —
 * nothing in the system compares the two on its own.
 */
export async function getCashReconciliation(from: string, to: string): Promise<{ days: CashReconciliationDay[] }> {
  const { supabase } = await requireAuth();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(String(from || "")) || !dateRe.test(String(to || ""))) throw new Error("Invalid date range.");
  if (from > to) throw new Error("Start date must not be after end date.");

  const window = maldivesDayBoundsUtc(to);
  const [{ data: registers, error: regErr }, { data: payments, error: payErr }] = await Promise.all([
    supabase
      .from("cash_registers")
      .select("id, register_date")
      .gte("register_date", from)
      .lte("register_date", to),
    supabase
      .from("payments")
      .select("amount_cents, currency, created_at, status")
      .eq("method", "cash")
      .eq("status", "completed")
      .gte("created_at", maldivesDayBoundsUtc(from).startIso)
      .lt("created_at", window.endIso),
  ]);
  if (regErr) throw new Error(regErr.message);
  if (payErr) throw new Error(payErr.message);

  const regs = (registers || []) as Array<{ id: string; register_date: string }>;
  let entries: Array<{ register_id: string; method: string; amount_cents: number; currency: string; booking_id: string | null }> = [];
  if (regs.length > 0) {
    const { data, error } = await supabase
      .from("cash_register_entries")
      .select("register_id, method, amount_cents, currency, booking_id")
      .in("register_id", regs.map((r) => r.id));
    if (error) throw new Error(error.message);
    entries = (data || []) as typeof entries;
  }

  const paymentsByDay = new Map<string, Array<{ amount_cents: number; currency: string }>>();
  for (const p of (payments || []) as Array<{ amount_cents: number | null; currency: string | null; created_at: string }>) {
    const day = maldivesDateOf(p.created_at);
    if (day < from || day > to) continue;
    const list = paymentsByDay.get(day) || [];
    list.push({ amount_cents: Number(p.amount_cents) || 0, currency: p.currency || "USD" });
    paymentsByDay.set(day, list);
  }

  const registerDays = new Map<string, string>();
  const entriesByDay = new Map<string, typeof entries>();
  for (const r of regs) {
    registerDays.set(r.register_date, r.id);
    entriesByDay.set(r.register_date, entries.filter((e) => e.register_id === r.id));
  }

  const days: CashReconciliationDay[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({
      date: day,
      hasRegister: registerDays.has(day),
      reconciliation: reconcileCashAgainstPayments(
        (paymentsByDay.get(day) || []) as Array<{ amount_cents: number; currency: string }>,
        (entriesByDay.get(day) || []) as Parameters<typeof reconcileCashAgainstPayments>[1]
      ),
    });
  }
  return { days };
}

/**
 * Money received each Maldives business day in the range: total income (all
 * methods) plus the cash slice that actually reaches the drawer. The cash
 * register reads both from here — `cash_register_entries` only ever contain
 * what staff typed in (in production, nothing at all), so an entries-based
 * "income" reads zero on a day with real sales and "Cash Received" never
 * grows past the float.
 */
export async function getDailySales(from: string, to: string): Promise<Record<string, TillDayFlow>> {
  const { supabase } = await requireAuth();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(String(from || "")) || !dateRe.test(String(to || ""))) throw new Error("Invalid date range.");
  if (from > to) throw new Error("Start date must not be after end date.");

  const { data, error } = await supabase
    .from("payments")
    .select("amount_cents, currency, method, created_at")
    .eq("status", "completed")
    .gte("created_at", maldivesDayBoundsUtc(from).startIso)
    .lt("created_at", maldivesDayBoundsUtc(to).endIso);
  if (error) throw new Error(error.message);

  const byDay: Record<string, Array<{ amount_cents: number | null; currency: string | null; method: string | null }>> = {};
  for (const p of (data || []) as Array<{ amount_cents: number | null; currency: string | null; method: string | null; created_at: string }>) {
    const day = maldivesDateOf(p.created_at);
    if (day < from || day > to) continue;
    (byDay[day] ||= []).push({ amount_cents: p.amount_cents, currency: p.currency, method: p.method });
  }

  const out: Record<string, TillDayFlow> = {};
  for (const [day, rows] of Object.entries(byDay)) {
    out[day] = { income: salesPerCurrency(rows), cash: cashPerCurrency(rows) };
  }
  return out;
}

export async function deleteCashRegisterEntry(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("cash_register_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/cashreg");
  revalidatePath("/admin/cashier");
}

export async function updateCashRegisterNotes(id: string, notes: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("cash_registers")
    .update({ notes: emptyToNull(notes) })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/cashreg");
  revalidatePath("/admin/cashier");
}

// =============================================
// PAYMENTS
// =============================================
export async function getPayments(bookingId?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("payments")
    .select("*, bookings(booking_ref, customers(full_name))")
    .order("created_at", { ascending: false });
  if (bookingId) query = query.eq("booking_id", bookingId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createPayment(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  if (!data.booking_id) throw new Error("Booking is required");
  const amountCents = typeof data.amount_cents === "number" ? data.amount_cents : 0;
  if (amountCents <= 0) throw new Error("Amount must be greater than 0");
  const currency = assertCurrency(data.currency);
  const method = (data.method as string) || "cash";
  const reference = (data.reference as string) || undefined;
  const notes = (data.notes as string) || undefined;

  const { data: result, error: rpcError } = await supabase.rpc("create_booking_payment", {
    p_booking_id: data.booking_id,
    p_amount_cents: amountCents,
    p_currency: currency,
    p_method: method,
    p_reference: reference || null,
    p_notes: notes || null,
  });
  if (rpcError) throw new Error(rpcError.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Payment recording failed");
  }
  // Booking is fully paid → snap it onto the matching trip (auto-attach).
  if (res && typeof res === "object" && (res as { new_payment_status?: string }).new_payment_status === "paid") {
    try {
      await autoAssignBooking(data.booking_id as string);
    } catch {
      // Optimistic — payment is already recorded, trip assignment is best-effort.
    }
  }
  return res;
}

export async function voidPaymentAction(paymentId: string, reason?: string) {
  const { supabase } = await requireAuth();
  if (!paymentId) throw new Error("Payment ID is required");

  const { data: result, error: rpcError } = await supabase.rpc("void_payment", {
    p_payment_id: paymentId,
    p_reason: reason || null,
  });
  if (rpcError) throw new Error(rpcError.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to void payment");
  }
  return res;
}

export async function createRentalPayment(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  if (!data.rental_id) throw new Error("Rental is required");
  const amountCents = typeof data.amount_cents === "number" ? data.amount_cents : 0;
  if (amountCents <= 0) throw new Error("Amount must be greater than 0");
  const currency = assertCurrency(data.currency);
  const method = (data.method as string) || "cash";
  const reference = (data.reference as string) || undefined;
  const notes = (data.notes as string) || undefined;

  const { data: result, error: rpcError } = await supabase.rpc("create_rental_payment", {
    p_rental_id: data.rental_id,
    p_amount_cents: amountCents,
    p_currency: currency,
    p_method: method,
    p_reference: reference || null,
    p_notes: notes || null,
  });
  if (rpcError) throw new Error(rpcError.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Payment recording failed");
  }
  return res;
}

// =============================================
// QUICK INVOICES — Invoices page "+ New invoice"
// =============================================

export interface QuickInvoiceInput {
  billTo: string;
  email?: string;
  phone?: string;
  activityId: string;
  description?: string;
  amountCents: number;
  currency?: string;
  date?: string;
  guests?: number;
  guestAgreed: boolean;
}

/** Escape LIKE wildcards (% _ \) so a name is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Raise an invoice for a person or company from three fields: who, what, how much.
 *
 * Stored as a booking so it inherits everything that already works — an invoice
 * number (booking_ref), the ¶ PDF and ✉ email actions, payments, Collected
 * reporting and the income-ledger mirror from migration 083.
 *
 * Email is optional: when the bill-to has no address, bookings.email_optional
 * (migration 084) waives the 072 customer-email gate for this row and the ✉
 * action prompts for an address at send time instead.
 */
export async function createQuickInvoice(input: QuickInvoiceInput) {
  const { supabase, user } = await requireAuth();

  const billTo = String(input.billTo || "").trim();
  if (!billTo) throw new Error("Enter the person or company the invoice is for.");
  if (!input.activityId) throw new Error("Choose what the invoice is for.");

  const amountCents = Math.round(Number(input.amountCents) || 0);
  if (amountCents <= 0) throw new Error("Invoice amount must be greater than 0.");

  const email = String(input.email || "").trim().toLowerCase();
  if (email && !VALID_EMAIL_RE.test(email)) {
    throw new Error("That email address doesn't look right — leave it blank if the bill-to has none.");
  }
  if (input.guestAgreed !== true) {
    throw new Error("Confirm the guest agreed to the Consent & Liability before raising the invoice.");
  }

  const currency = assertCurrency(input.currency);
  const guests = Math.max(Math.round(Number(input.guests) || 1), 1);
  const bookingDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? String(input.date) : maldivesToday();

  // ---- Find the bill-to (by address first, then by name) or create them ----
  let customerId = "";
  let customerEmail: string | null = null;

  if (email) {
    const { data: byEmail } = await supabase
      .from("customers")
      .select("id, email")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (byEmail) {
      customerId = String(byEmail.id);
      customerEmail = String(byEmail.email || "");
    }
  }
  if (!customerId) {
    const { data: byName } = await supabase
      .from("customers")
      .select("id, email")
      .ilike("full_name", escapeLikePattern(billTo))
      .limit(1)
      .maybeSingle();
    if (byName) {
      customerId = String(byName.id);
      customerEmail = String(byName.email || "") || null;
    }
  }
  if (customerId) {
    // A known customer missing an address gets the one just typed.
    if (email && !customerEmail) {
      const { error } = await supabase.from("customers").update({ email }).eq("id", customerId);
      if (error) throw new Error(error.message);
      customerEmail = email;
    }
  } else {
    const { data: created, error } = await supabase
      .from("customers")
      .insert({ full_name: billTo, email: email || null, phone: emptyToNull(input.phone) })
      .select("id, email")
      .single();
    if (error) throw new Error(error.message);
    customerId = String(created.id);
    customerEmail = String(created.email || "") || null;
  }

  // The gate (072) reads the customer's address; legacy rows can hold junk, so
  // the exemption is based on whether that address is actually usable.
  const emailOptional = !VALID_EMAIL_RE.test(String(customerEmail || "").trim());

  let createdBy: string | null = null;
  try {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    createdBy = staff?.id ? String(staff.id) : null;
  } catch {
    createdBy = null;
  }

  const bookingRef = `OB-${Date.now().toString(36).toUpperCase()}`;
  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      booking_ref: bookingRef,
      customer_id: customerId,
      activity_id: input.activityId,
      source: "walk_in",
      status: "confirmed",
      guests,
      adults: guests,
      children_count: 0,
      booking_date: bookingDate,
      total_cents: amountCents,
      net_cents: amountCents,
      booking_currency: currency,
      payment_status: "unpaid",
      email_optional: emailOptional,
      pricing_option_label: emptyToNull(input.description),
      guest_agreed: true,
      guest_agreed_at: new Date().toISOString(),
      agreement_version: "booking-enquiry-v1",
      created_by: createdBy,
    })
    .select("id, booking_ref")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/invoices");
  return { id: String(booking.id), booking_ref: String(booking.booking_ref) };
}

/** Latest invoices (bookings), newest first — the Invoices page list. */
export async function getRecentInvoices(limit = 20) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, created_at, booking_date, status, payment_status, total_cents, estimated_total_cents, booking_currency, guests, pricing_option_label, activities(name), customers(full_name, email), payments(amount_cents, converted_amount_cents, status)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Record the whole outstanding balance as one payment (cash by default), the
 * "they paid" switch on the Invoices page.
 *
 * Goes through create_booking_payment so the booking's payment_status, the
 * Collected figures, the profit line and the income-ledger mirror all move
 * together — exactly as they do for any other payment.
 */
export async function markInvoicePaid(bookingId: string, method = "cash", reference?: string) {
  if (!bookingId) throw new Error("Invoice is required");
  const { supabase } = await requireAuth();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, booking_ref, status, total_cents, estimated_total_cents, booking_currency, payments(amount_cents, converted_amount_cents, status)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) throw new Error("Invoice not found.");
  if (String(booking.status) === "cancelled") throw new Error("A cancelled invoice can't be marked paid.");

  // Same payable rule the invoice PDF prints (total, falling back to estimate).
  const payable = Math.max(Math.round(Number(booking.total_cents || booking.estimated_total_cents) || 0), 0);
  const due = invoiceBalanceCents(payable, (booking.payments || []) as PaymentLike[]);
  if (due <= 0) throw new Error("This invoice is already fully paid.");

  return await createPayment({
    booking_id: bookingId,
    amount_cents: due,
    currency: booking.booking_currency === "MVR" ? "MVR" : "USD",
    method,
    reference: reference || undefined,
    notes: "Marked paid from the Invoices page",
  });
}

// =============================================
// AUDIT LOG
// =============================================
export async function getAuditLog(limit = 50) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_name, action, table_name, record_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// =============================================
// DELETE OPERATIONS
// =============================================
export async function deleteEquipment(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/equipment");
}

export async function deleteCustomer(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/customers");
}

// =============================================
// ACTIVITY PRICING OPERATIONS
// =============================================
export async function replaceActivityPricing(
  activityId: string,
  pricing: Array<{ label: string; price_cents: number; pricing_unit: string; note?: string; sort_order: number; currency?: string }>
) {
  const { supabase } = await requireAuth();

  const validUnits = ["per_person", "per_unit", "per_hour"];
  for (const p of pricing) {
    if (!validUnits.includes(p.pricing_unit)) {
      throw new Error(`Pricing option "${p.label || "(blank)"}" has an invalid unit "${p.pricing_unit}". Must be per_person, per_unit, or per_hour.`);
    }
  }

  const { error: delErr } = await supabase
    .from("activity_pricing")
    .delete()
    .eq("activity_id", activityId);
  if (delErr) throw delErr;

  if (pricing.length > 0) {
    const rows = pricing.map((p) => ({
      activity_id: activityId,
      label: p.label,
      price_cents: p.price_cents,
      pricing_unit: p.pricing_unit,
      note: p.note || null,
      sort_order: p.sort_order,
      currency: assertCurrency(p.currency),
    }));
    const { error: insErr } = await supabase.from("activity_pricing").insert(rows);
    if (insErr) throw insErr;
  }

  revalidatePath("/admin/activities");
}

// =============================================
// SELECT DATA HELPERS
// =============================================
export async function getBookingsForSelect() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_ref, payment_status, total_cents, estimated_total_cents, booking_currency, customers(full_name), payments(amount_cents, converted_amount_cents, currency, booking_currency, status)")
    .in("payment_status", ["unpaid", "partial"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((b) => {
    const cust = b.customers as { full_name?: string } | null;
    const total = Number(b.total_cents) > 0 ? Number(b.total_cents) : Number(b.estimated_total_cents) || 0;
    const payments = (b.payments as PaymentLike[]) || [];
    const paid = payments
      .filter(isCompletedPayment)
      .reduce((s, p) => s + paymentAmountInBookingCurrency(p), 0);
    return {
      id: b.id,
      label: b.booking_ref,
      sub: cust?.full_name || "",
      total_cents: total,
      paid_cents: paid,
      currency: b.booking_currency || "USD",
    };
  });
}

export async function getCustomersForSelect() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .order("full_name");
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.id,
    label: c.full_name,
    sub: c.phone || "",
  }));
}

export interface EquipmentSelectOption {
  id: string;
  label: string;
  sub?: string;
  dailyRateCents?: number | null;
  depositCents?: number | null;
  currency: string;
}

export async function getEquipmentForSelect(): Promise<EquipmentSelectOption[]> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("equipment")
    .select("id, name, asset_number, daily_rate_cents, deposit_cents, currency")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data || []).map((e) => ({
    id: e.id,
    label: e.name,
    sub: e.asset_number || "",
    dailyRateCents: Number(e.daily_rate_cents) || 0,
    depositCents: Number(e.deposit_cents) || 0,
    currency: String(e.currency || "USD"),
  }));
}

export interface FreeEquipmentUnit {
  id: string;
  name: string;
  asset_number: string;
  daily_rate_cents: number;
  deposit_cents: number;
  currency: string;
}

/**
 * Active units that are NOT out on another rental — what staff can assign when
 * issuing a walk-in request (same availability rule as get_rental_catalog).
 */
export async function getFreeEquipmentForIssue(): Promise<FreeEquipmentUnit[]> {
  const { supabase } = await requireAuth();
  const [eqRes, busyRes] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, asset_number, daily_rate_cents, deposit_cents, currency")
      .eq("active", true)
      .order("name"),
    supabase
      .from("equipment_rentals")
      .select("equipment_id")
      .in("status", ["checked_out", "overdue"]),
  ]);
  if (eqRes.error) throw new Error(eqRes.error.message);
  if (busyRes.error) throw new Error(busyRes.error.message);
  const busy = new Set((busyRes.data || []).map((r) => String(r.equipment_id)));
  return ((eqRes.data || []) as FreeEquipmentUnit[]).filter((e) => !busy.has(String(e.id)));
}

export async function getActivitiesForSelect() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("activities")
    .select("id, name, slug, category")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data || []).map((a) => ({
    id: a.id,
    slug: a.slug,
    label: a.name,
    sub: a.category || "",
  }));
}

export async function getBookingsForCustomer(customerId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_ref, status, activity_id, activities(name)")
    .eq("customer_id", customerId)
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((b) => {
    const act = b.activities as { name?: string } | null;
    return {
      id: b.id,
      label: b.booking_ref,
      sub: `${act?.name || ""} (${b.status})`,
      activity_id: b.activity_id,
    };
  });
}

// =============================================
// OPERATIONS – FLEET (BOATS)
// =============================================
export async function getBoats() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("boats")
    .select("id, name, boat_type, capacity_pax, status, notes, created_at, updated_at")
    .order("boat_type")
    .order("name");
  if (error) throw error;
  return data || [];
}

export async function getBoatsForSelect() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("boats")
    .select("id, name, boat_type, capacity_pax, status")
    .order("name");
  if (error) throw error;
  return (data || []).map((b) => ({
    id: b.id,
    label: `${b.name} (${b.capacity_pax} pax)`,
    sub: b.boat_type,
    capacity_pax: Number(b.capacity_pax),
    status: b.status,
  }));
}

export async function createBoat(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeBoat(data);
  if (!clean.name) throw new Error("Boat name is required");
  if (!clean.capacity_pax || clean.capacity_pax < 1) throw new Error("Capacity must be at least 1");
  const { data: result, error } = await supabase.from("boats").insert(clean).select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/boats");
  return result;
}

export async function updateBoat(id: string, data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeBoat(data);
  if (!clean.name) throw new Error("Boat name is required");
  if (!clean.capacity_pax || clean.capacity_pax < 1) throw new Error("Capacity must be at least 1");
  const { data: result, error } = await supabase
    .from("boats")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/boats");
  revalidatePath("/admin/trips");
  return result;
}

export async function deleteBoat(id: string) {
  const { supabase } = await requireAuth();
  const { data: trips } = await supabase.from("trips").select("id").eq("boat_id", id).limit(1);
  if (trips && trips.length > 0) throw new Error("Cannot delete a boat that is used by trips. Mark it as maintenance instead.");
  const { error } = await supabase.from("boats").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/boats");
}

// =============================================
// OPERATIONS – CREW ROSTER
// =============================================
export async function getCrewMembers() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, full_name, role, phone, active, notes, staff_profile_id, created_at, updated_at")
    .order("full_name");
  if (error) throw error;
  return data || [];
}

export async function getCrewForSelect() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, full_name, role")
    .eq("active", true)
    .order("full_name");
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.id,
    label: c.full_name,
    sub: c.role || "",
  }));
}

export async function createCrewMember(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeCrewMember(data);
  if (!clean.full_name) throw new Error("Crew member name is required");
  if (!clean.role) throw new Error("Role is required");
  const { data: result, error } = await supabase.from("crew_members").insert(clean).select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crew");
  return result;
}

export async function updateCrewMember(id: string, data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeCrewMember(data);
  if (!clean.full_name) throw new Error("Crew member name is required");
  const { data: result, error } = await supabase
    .from("crew_members")
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crew");
  revalidatePath("/admin/trips");
  return result;
}

export async function deleteCrewMember(id: string) {
  const { supabase } = await requireAuth();
  const { data: trips } = await supabase
    .from("trips")
    .select("id")
    .or(`guide_id.eq.${id},captain_id.eq.${id}`)
    .limit(1);
  if (trips && trips.length > 0) throw new Error("Cannot delete crew who are assigned to trips. Mark them inactive instead.");
  const { error } = await supabase.from("crew_members").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/crew");
}

// =============================================
// OPERATIONS – TRIPS
// =============================================
export async function getTrips(date?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("trips")
    .select(`
      *, 
      activities(name, slug, category),
      boats(name, boat_type, capacity_pax, status),
      guide:crew_members!trips_guide_id_fkey(full_name, role, phone, staff_profile_id),
      captain:crew_members!trips_captain_id_fkey(full_name, phone, staff_profile_id),
      trip_manifest(
        id, pax, guest_name, arrival_date, arrival_time, transfer, hotel, room_number,
        special_requests, checked_in, checked_in_at,
        bookings(id, booking_ref, status, payment_status, source, preferred_time, special_requests, partner,
                 guests, estimated_total_cents, total_cents, net_cents, commission_cents, booking_currency, customer_id,
                 customers(full_name, phone, hotel, room_number),
                 consent_forms(status, signed_at))
      )
    `)
    .order("start_time")
    .order("created_at");
  if (date) query = query.eq("trip_date", date);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getTripsForDateRange(fromDate: string, toDate: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("trips")
    .select(`
      *,
      activities(name, slug, category),
      boats(name, boat_type, capacity_pax, status),
      guide:crew_members!trips_guide_id_fkey(full_name, role, phone),
      captain:crew_members!trips_captain_id_fkey(full_name, phone),
      trip_manifest(
        id, pax, guest_name, arrival_date, arrival_time, transfer, hotel, room_number,
        special_requests, checked_in, checked_in_at,
        bookings(id, booking_ref, status, payment_status, source, preferred_time, special_requests, partner,
                 guests, estimated_total_cents, total_cents, net_cents, commission_cents, booking_currency, customer_id,
                 customers(full_name, phone, hotel, room_number),
                 consent_forms(status, signed_at))
      )
    `)
    .gte("trip_date", fromDate)
    .lte("trip_date", toDate)
    .order("trip_date")
    .order("start_time");
  if (error) throw error;
  return data || [];
}

/**
 * Returns the current staff member's task summary:
 * - today's trips where they are guide or captain (owner/manager see all)
 * - bookings needing payment on those trips
 * - bookings lacking a signed consent form on those trips
 */
export async function getMyTasks() {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles").select("id, role").eq("user_id", user.id).single();
  if (!profile) return { trips: [] as TripRow[], paymentsDue: [] as Record<string, unknown>[], consentsPending: [] as Record<string, unknown>[] };

  const isAdmin = profile.role === "owner" || profile.role === "manager";
  const today = maldivesToday();

  let myCrewIds: string[] = [];
  if (!isAdmin) {
    const { data: crewRows } = await supabase.from("crew_members").select("id").eq("staff_profile_id", profile.id).eq("active", true);
    myCrewIds = crewRows?.map(r => r.id as string) ?? [];
    if (myCrewIds.length === 0) return { trips: [] as TripRow[], paymentsDue: [] as Record<string, unknown>[], consentsPending: [] as Record<string, unknown>[] };
  }

  const allTrips = (await getTrips(today)) as TripRow[];
  const myTrips = isAdmin ? allTrips : allTrips.filter(t => myCrewIds.includes(t.guide_id ?? "") || myCrewIds.includes(t.captain_id ?? ""));

  // Collect all booking ids from manifest
  const bookingIdToTripRef: Record<string, string> = {};
  for (const trip of myTrips) {
    for (const row of trip.trip_manifest ?? []) {
      const bookings = Array.isArray(row.bookings) ? row.bookings : row.bookings ? [row.bookings] : [];
      for (const b of bookings) {
        if (b && (b as Record<string, unknown>).id) bookingIdToTripRef[(b as Record<string, unknown>).id as string] = trip.trip_ref;
      }
    }
  }
  const allBookingIds = Object.keys(bookingIdToTripRef);

  // Payment-due bookings
  const paymentsDue: Record<string, unknown>[] = [];
  if (allBookingIds.length > 0) {
    const { data: payBookings } = await supabase
      .from("bookings")
      .select("id, booking_ref, payment_status, total_cents, estimated_total_cents, customer_id, customers(full_name, phone)")
      .in("id", allBookingIds)
      .in("payment_status", ["unpaid", "partial"]);
    for (const b of payBookings ?? []) {
      paymentsDue.push({
        bookingId: b.id,
        bookingRef: b.booking_ref,
        guestName: ((b.customers ?? {}) as unknown as Record<string, unknown>)?.full_name ?? "Guest",
        phone: ((b.customers ?? {}) as unknown as Record<string, unknown>)?.phone ?? null,
        tripRef: bookingIdToTripRef[b.id],
        customerId: b.customer_id,
      });
    }
  }

  // Consent-pending bookings
  const consentsPending: Record<string, unknown>[] = [];
  const consentMap = new Map<string, { status: string; token: string | null; guestName: string | null }>();
  if (allBookingIds.length > 0) {
    // Consent RLS may restrict visibility — if so this returns empty, acceptable degradation
    const { data: consentForms } = await supabase
      .from("consent_forms")
      .select("id, booking_id, status, signing_token, guest_name")
      .in("booking_id", allBookingIds);
    for (const cf of consentForms ?? []) consentMap.set(cf.booking_id, { status: cf.status, token: cf.signing_token, guestName: cf.guest_name });
  }

  for (const trip of myTrips) {
    for (const row of trip.trip_manifest ?? []) {
      const bookings = Array.isArray(row.bookings) ? row.bookings : row.bookings ? [row.bookings] : [];
      for (const b of bookings) {
        if (!b) continue;
        const bid = (b as Record<string, unknown>).id as string;
        const consent = consentMap.get(bid);
        if (!consent || consent.status !== "signed") {
          consentsPending.push({
            bookingId: bid,
            bookingRef: (b as Record<string, unknown>).booking_ref,
            guestName: consent?.guestName ?? row.guest_name ?? (((b.customers ?? {}) as unknown as Record<string, unknown>)?.full_name as string) ?? "Guest",
            phone: ((b.customers ?? {}) as unknown as Record<string, unknown>)?.phone ?? null,
            tripRef: trip.trip_ref,
            tripDate: trip.trip_date,
            activityName: trip.activities?.name ?? "Activity",
            activityId: trip.activity_id,
            customerId: (b as Record<string, unknown>).customer_id,
            signingToken: consent?.token ?? null,
          });
        }
      }
    }
  }

  return { trips: myTrips, paymentsDue, consentsPending };
}

export async function createTripAction(data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeTrip(data);
  if (!clean.activity_id) throw new Error("Product/Activity is required");
  if (!clean.trip_date) throw new Error("Trip date is required");
  const { data: result, error } = await supabase.rpc("create_trip", {
    p_activity_id: clean.activity_id,
    p_boat_id: clean.boat_id,
    p_trip_date: clean.trip_date,
    p_start_time: clean.start_time,
    p_end_time: clean.end_time,
    p_guide_id: clean.guide_id,
    p_captain_id: clean.captain_id,
    p_capacity_pax: clean.capacity_pax,
    p_seats_open: clean.seats_open,
    p_notes: clean.notes,
    p_status: clean.status,
    p_destination: clean.destination,
    p_transfer_price_cents: clean.transfer_price_cents,
    p_transfer_currency: clean.transfer_currency,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to create trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
  return res;
}

export async function updateTripAction(id: string, data: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const clean = sanitizeTrip(data);
  const { data: result, error } = await supabase.rpc("update_trip", {
    p_trip_id: id,
    p_boat_id: clean.boat_id,
    p_start_time: clean.start_time,
    p_end_time: clean.end_time,
    p_guide_id: clean.guide_id,
    p_captain_id: clean.captain_id,
    p_capacity_pax: clean.capacity_pax,
    p_seats_open: clean.seats_open,
    p_notes: clean.notes,
    p_destination: clean.destination,
    p_transfer_price_cents: clean.transfer_price_cents,
    p_transfer_currency: clean.transfer_currency,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to update trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
  return res;
}

/** Manual trip deletion — only for empty, non-departed trips (guarded in SQL). */
export async function deleteTripAction(id: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("delete_trip", { p_trip_id: id });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to delete trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
}

/** Advance a trip through planned → ready → departed → returned (flow enforced in SQL). */
export async function updateTripStatusAction(id: string, status: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("update_trip_status", {
    p_trip_id: id,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to update trip status");
  }
  revalidatePath("/admin/operations");
  revalidatePath("/admin/trips");
  revalidatePath("/admin/reception");
  return res;
}

export async function assignTripCrewAction(tripId: string, guideId: string | null, captainId: string | null) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("assign_trip_crew", {
    p_trip_id: tripId,
    p_guide_id: guideId,
    p_captain_id: captainId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to assign crew");
  }
  // Best-effort: notify the newly assigned crew when OpenWA is configured.
  await notifyTripCrewAssigned(tripId, guideId, captainId);
  revalidatePath("/admin/operations");
  revalidatePath("/admin/trips");
  return res;
}

async function notifyTripCrewAssigned(tripId: string, guideId: string | null, captainId: string | null) {
  try {
    const supabase = await getSupabase();
    const { data: trip } = await supabase
      .from("trips")
      .select("trip_ref, trip_date, start_time, activities(name)")
      .eq("id", tripId)
      .maybeSingle();
    if (!trip) return;
    const activity = (trip.activities as { name?: string } | null)?.name || "activity";
    const members: { id: string | null; value: string | null; label: string }[] = [
      { id: guideId, value: guideId, label: "guide" },
      { id: captainId, value: captainId, label: "captain" },
    ];
    const wanted = members
      .filter((m) => m.value)
      .map((m) => m.value) as string[];
    if (wanted.length === 0) return;
    const { data: crew } = await supabase
      .from("crew_members")
      .select("id, full_name, phone")
      .in("id", wanted);
    const byId = new Map((crew || []).map((c) => [String(c.id), c]));
    for (const m of members) {
      if (!m.value) continue;
      const person = byId.get(String(m.value));
      if (!person?.phone) continue;
      const message = buildTripAssignmentMessage(
        String(trip.trip_ref || ""),
        activity,
        trip.trip_date ? friendlyDate(String(trip.trip_date)) : "",
        (trip.start_time as string | null) || "",
        m.label
      );
      await sendWhatsAppText(String(person.phone), message);
    }
  } catch {
    // advisory only
  }
}

export async function closeTripBookingsAction(tripId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("close_trip_bookings", {
    p_trip_id: tripId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to close trip bookings");
  }
  revalidatePath("/admin/operations");
  revalidatePath("/admin/trips");
  return res;
}

// =============================================
// OPERATIONS – MANIFESTS & ASSIGNMENT
// =============================================
export async function getUnassignedBookings(date?: string) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("bookings")
    .select(`
      id, booking_ref, activity_id, booking_date, preferred_time, guests, adults, children_count,
      payment_status, status, partner, arrival_date, arrival_time, transfer, hotel_name, room_number,
      activities(name), customers(full_name)
    `)
    .is("trip_id", null)
    .eq("status", "confirmed")
    .order("booking_date")
    .order("preferred_time");
  if (date) query = query.eq("booking_date", date);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Manually assign a booking onto a trip (capacity-checked in SQL). */
export async function assignBookingToTrip(bookingId: string, tripId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("assign_booking_to_trip", {
    p_booking_id: bookingId,
    p_trip_id: tripId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to assign booking to trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/bookings");
  return res;
}

export async function unassignBookingFromTrip(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("unassign_booking_from_trip", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to release booking from trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/bookings");
  return res;
}

/** Quick-create a planned trip matching the booking's activity/date/guests, then assign it. */
export async function quickCreateTripForBookingAction(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("activity_id, booking_date, preferred_time, guests")
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr || !booking) throw new Error(bErr?.message || "Booking not found");
  const capacity = Math.max(Number(booking.guests) || 1, 8);
  const { data: tripRes, error: tErr } = await supabase.rpc("create_trip", {
    p_activity_id: booking.activity_id,
    p_boat_id: null,
    p_trip_date: booking.booking_date,
    p_start_time: booking.preferred_time || null,
    p_capacity_pax: capacity,
    p_seats_open: capacity,
    p_status: "planned",
  });
  if (tErr) throw new Error(tErr.message);
  const res = tripRes as unknown as { error?: string; message?: string; success?: boolean; trip_id?: string; trip_ref?: string };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to create trip");
  }
  if (!res?.trip_id) throw new Error("No trip_id returned from create_trip");
  await assignBookingToTrip(bookingId, res.trip_id);
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
  return { tripId: res.trip_id, tripRef: res.trip_ref };
}

/** Crew ticking a guest onto the manifest in the morning. */
export async function toggleManifestCheckin(manifestId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("toggle_manifest_checkin", {
    p_manifest_id: manifestId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to update check-in");
  }
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/operations");
  return res;
}

/** Batch auto-attach for a whole day: confirmed + paid bookings snap onto matching trips. */
export async function autoAssignForDate(date?: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("auto_assign_bookings_to_trips", {
    p_date: date || null,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean; assigned?: number; unassigned?: number };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Auto-assign failed");
  }
  revalidatePath("/admin/operations");
  revalidatePath("/admin/trips");
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/bookings");
  return res;
}

/** Auto-attach for a single booking. Used silently by the booking/payment flows. */
export async function autoAssignBooking(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("auto_assign_booking_to_trip", {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  return result as unknown as { success: boolean; reason?: string; trip_id?: string };
}

/**
 * Create (or attach to) the operations trip for a confirmed booking.
 * Trigger-backed on status change; exposed for manual retry.
 */
export async function ensureTripForBooking(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("ensure_trip_for_booking", {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to prepare trip");
  }
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
  return res;
}

// =============================================
// RECEPTION – DEPARTURES & RETURNS
// =============================================
/** Today's manifest rows (optionally a date) for the reception departure board. */
export async function getReceptionBoard(date?: string) {
  const { supabase } = await requireAuth();
  const d = date || maldivesToday();
  const { data, error } = await supabase
    .from("trip_manifest")
    .select(`
      id, pax, guest_name, hotel, room_number, checked_in, checked_in_at,
      departed_at, returned_at, special_requests,
      trips!inner(
        id, trip_ref, trip_date, start_time, end_time, status,
        activities(name, slug, category),
        boats(name),
        guide:crew_members!trips_guide_id_fkey(full_name),
        captain:crew_members!trips_captain_id_fkey(full_name)
      ),
      bookings!inner(
        id, booking_ref, status, payment_status, source,
        customers(full_name, phone)
      )
    `)
    .eq("trips.trip_date", d)
    .order("trip_id");
  if (error) throw error;
  return data || [];
}

export async function markGuestDeparted(manifestId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("set_manifest_departure", {
    p_manifest_id: manifestId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to mark departure");
  }
  revalidatePath("/admin/reception");
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/operations");
  return res;
}

export async function markGuestReturned(manifestId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("set_manifest_return", {
    p_manifest_id: manifestId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to mark return");
  }
  revalidatePath("/admin/reception");
  revalidatePath("/admin/manifests");
  revalidatePath("/admin/operations");
  return res;
}

export async function resetGuestTracking(manifestId: string) {
  const { supabase } = await requireAuth();
  const { data: result, error } = await supabase.rpc("reset_manifest_tracking", {
    p_manifest_id: manifestId,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to reset tracking");
  }
  revalidatePath("/admin/reception");
  revalidatePath("/admin/manifests");
  return res;
}

// =============================================
// BOOKING GROUPS (MULTI-ACTIVITY)
// =============================================
export async function getBookingGroup(groupId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id, booking_ref, status, payment_status, booking_date, preferred_time,
      guests, estimated_total_cents, total_cents, booking_currency,
      activities(name, slug),
      customers(full_name, phone)
    `)
    .eq("group_id", groupId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

/** Confirm every pending booking in the group (each fires the auto-trip trigger). */
export async function confirmBookingGroup(groupId: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  // Auto-send a confirmation to each affected guest when OpenWA is configured.
  const { data: affected } = await supabase
    .from("bookings")
    .select("id")
    .eq("group_id", groupId)
    .neq("status", "cancelled");
  for (const b of affected || []) {
    await notifyBookingConfirmed(String(b.id));
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/trips");
  revalidatePath("/admin/operations");
}

/**
 * Take a combined payment for a booking group: pays each sibling's
 * remaining balance in its own booking currency.
 */
export async function createGroupPayment(
  groupId: string,
  method = "cash",
  reference?: string,
  notes?: string
) {
  const { supabase } = await requireAuth();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("group_id", groupId)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);

  let paidCount = 0;
  let skippedCount = 0;
  const results: unknown[] = [];

  for (const b of bookings || []) {
    const { data: summary, error: sErr } = await supabase.rpc("get_booking_payment_summary", {
      p_booking_id: b.id,
    });
    if (sErr) throw new Error(sErr.message);
    const s = summary as unknown as { remaining_cents?: number; booking_currency?: string };
    const remaining = Number(s?.remaining_cents || 0);
    if (remaining <= 0) {
      skippedCount += 1;
      continue;
    }
    const { data: result, error: pErr } = await supabase.rpc("create_booking_payment", {
      p_booking_id: b.id,
      p_amount_cents: remaining,
      p_currency: s?.booking_currency || "USD",
      p_method: method,
      p_reference: reference || null,
      p_notes: notes || null,
    });
    if (pErr) throw new Error(pErr.message);
    paidCount += 1;
    results.push(result);
  }

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/operations");
  return { paidCount, skippedCount, results };
}

// =============================================
// COMMISSION BACKFILL
// =============================================
/**
 * What the backfill found, or would change. `applied: false` is a dry preview —
 * the RPC computes everything and writes nothing, so the office can see the
 * count and the money before touching a month of history.
 */
export interface CommissionBackfillResult {
  from: string;
  to: string;
  applied: boolean;
  changed: number;
  unchanged: number;
  netsAdjusted: number;
  oldCommissionCents: number;
  newCommissionCents: number;
  samples: { ref: string; date: string; old_cents: number; new_cents: number }[];
}

/**
 * Recompute commission for a date range from each booking's own rule snapshot,
 * falling back to the activity's current rule.
 *
 * This exists because the 054/056 split trigger is BEFORE INSERT: setting a rate
 * on an activity only ever affected bookings created afterwards, so a commission
 * missed on a past trip could only be repaired one booking at a time.
 *
 * The RPC is the authority on roles (owner/manager/reception) and repeats the
 * check here so a forbidden call reads as a clear message rather than a bare
 * JSON error object.
 */
async function backfillCommission(
  from: string,
  to: string,
  apply: boolean
): Promise<CommissionBackfillResult> {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, role")
    .eq("user_id", user.id)
    .single();
  if (!profile || !["owner", "manager", "reception"].includes(String(profile.role))) {
    throw new Error("Only the owner, manager or reception can backfill commission.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("Choose a valid date range.");
  }

  const { data, error } = await supabase.rpc("backfill_booking_commission", {
    p_from: from,
    p_to: to,
    p_apply: apply,
  });
  if (error) throw new Error(error.message);

  const res = (data || {}) as Record<string, unknown>;
  if (res.error) {
    throw new Error(typeof res.message === "string" ? res.message : "Backfill failed.");
  }
  if (apply) {
    revalidatePath("/admin/reports");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/trips");
  }
  return {
    from: String(res.from ?? from),
    to: String(res.to ?? to),
    applied: Boolean(res.applied),
    changed: Number(res.changed) || 0,
    unchanged: Number(res.unchanged) || 0,
    netsAdjusted: Number(res.nets_adjusted) || 0,
    oldCommissionCents: Number(res.old_commission_cents) || 0,
    newCommissionCents: Number(res.new_commission_cents) || 0,
    samples: Array.isArray(res.samples) ? (res.samples as CommissionBackfillResult["samples"]) : [],
  };
}

/** Dry run: what a backfill over this range would change. Writes nothing. */
export async function previewCommissionBackfillAction(from: string, to: string) {
  return backfillCommission(from, to, false);
}

/** Apply the backfill. Requires an explicit confirm in the UI. */
export async function applyCommissionBackfillAction(from: string, to: string) {
  return backfillCommission(from, to, true);
}

// =============================================
// AGENT BOOKING QR  (rate is never shown to the guest)
// =============================================
/**
 * Roles allowed to issue an agent booking QR. Mirrors MODULE_ACCESS.bookings
 * (owner/manager/reception/watersports_staff) in lib/permissions.ts, but checked
 * here too because the RLS policy on agent_booking_links only proves "some staff
 * member", not "someone who may work bookings".
 */
const AGENT_LINK_ROLES = ["owner", "manager", "reception", "watersports_staff"];

/**
 * Activities + their pricing options for the agent QR modal. This is an
 * AUTHENTICATED staff read, so prices are fine here — the admin needs them to
 * decide what to quote. None of this is ever sent to the guest page.
 */
export async function getActivitiesWithPricingForAgentQr() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("activities")
    .select("id, name, slug, category, base_price_cents, currency, activity_pricing(id, label, price_cents, pricing_unit, sort_order)")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data || []).map((a) => {
    const options = (a.activity_pricing as unknown as Array<Record<string, unknown>>) || [];
    return {
      id: String(a.id),
      label: String(a.name),
      sub: String(a.category || ""),
      currency: String(a.currency || "USD"),
      basePriceCents: Number(a.base_price_cents) || 0,
      options: options
        .slice()
        .sort((x, y) => (Number(x.sort_order) || 0) - (Number(y.sort_order) || 0))
        .map((o) => ({
          label: String(o.label),
          priceCents: Number(o.price_cents) || 0,
          pricingUnit: String(o.pricing_unit || "per_unit"),
        })),
    };
  });
}

/** Active staff who can be picked as the selling agent. */
export async function getAgentsForBookingQr() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, full_name, role")
    .eq("active", true)
    .order("full_name");
  if (error) throw error;
  return (data || []).map((p) => ({
    id: String(p.id),
    name: String(p.full_name),
    role: String(p.role),
  }));
}

interface CreateAgentLinkInput {
  agentId: string | null;
  agentName: string;
  activityIds: string[];
  /**
   * activityId -> pricing option label the agent quoted. Stored server-side and
   * used to compute bookings.total_cents in submit_agent_booking, so the guest
   * never has to see (or choose) a price.
   */
  quotedOptions?: Record<string, string>;
  expiresInDays?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Issue a guest-facing booking link attributed to an agent.
 *
 * The guest page this token unlocks renders no prices at all — the rate is
 * resolved server-side inside submit_agent_booking and only ever lands in
 * bookings.total_cents for the staff ledger.
 */
export async function createAgentBookingLink(input: CreateAgentLinkInput) {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, full_name, role")
    .eq("user_id", user.id)
    .single();
  if (!profile || !AGENT_LINK_ROLES.includes(String(profile.role))) {
    throw new Error("You do not have permission to create agent booking links.");
  }

  // The name is snapshotted on the link so attribution survives a staff rename
  // or deactivation. A typed-in name is accepted on purpose: reception often
  // sells under the name on the badge, not the account name.
  const agentName = input.agentName.trim();
  if (agentName.length < 2 || agentName.length > 80) {
    throw new Error("Enter the agent name (2-80 characters).");
  }

  // Resolve the agent id against real staff so a forged id cannot be attached.
  let agentId: string | null = null;
  if (input.agentId && UUID_RE.test(input.agentId)) {
    const { data: agent } = await supabase
      .from("staff_profiles")
      .select("id")
      .eq("id", input.agentId)
      .maybeSingle();
    if (!agent) throw new Error("That agent could not be found.");
    agentId = agent.id as string;
  }

  const activityIds = Array.from(
    new Set((input.activityIds || []).filter((id) => UUID_RE.test(id)))
  ).slice(0, 8);

  // Only offer trips that actually exist and are sellable, otherwise the guest
  // would see a link whose only activity 404s at submit time.
  if (activityIds.length > 0) {
    const { data: ok } = await supabase
      .from("activities")
      .select("id")
      .in("id", activityIds)
      .eq("active", true);
    const found = new Set((ok || []).map((a) => String(a.id)));
    const missing = activityIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error("One of the selected trips is no longer available. Refresh and try again.");
    }
  }

  const days = Math.min(Math.max(Math.trunc(input.expiresInDays ?? 7), 1), 30);

  // Only keep quoted labels that actually exist on the chosen activity, so a
  // stale label cannot silently fall back to the base price in the ledger.
  const quotedOptions: Record<string, string> = {};
  const wanted = Object.entries(input.quotedOptions || {});
  if (wanted.length > 0) {
    const ids = Array.from(new Set(wanted.map(([id]) => id).filter((id) => UUID_RE.test(id))));
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from("activity_pricing")
        .select("activity_id, label")
        .in("activity_id", ids);
      const valid = new Set(
        (rows || []).map((r) => `${r.activity_id}\u0000${r.label}`)
      );
      for (const [id, label] of wanted) {
        const clean = String(label || "").trim();
        if (clean && valid.has(`${id}\u0000${clean}`)) quotedOptions[id] = clean;
      }
    }
  }

  const { data, error } = await supabase
    .from("agent_booking_links")
    .insert({
      agent_id: agentId,
      agent_name: agentName,
      activity_ids: activityIds,
      quoted_option_labels: quotedOptions,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      created_by: profile.id,
    })
    .select("token, expires_at")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/admin/bookings");
  return { token: String(data.token), expiresAt: String(data.expires_at) };
}

/** Recently issued links, for the admin list. */
export async function getAgentBookingLinks(limit = 25) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("agent_booking_links")
    .select("id, token, agent_name, activity_ids, expires_at, uses_count, active, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return data || [];
}

/** Close a link so its QR stops accepting bookings. */
export async function revokeAgentBookingLink(id: string) {
  const { supabase, user } = await requireAuth();
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, role")
    .eq("user_id", user.id)
    .single();
  if (!profile || !AGENT_LINK_ROLES.includes(String(profile.role))) {
    throw new Error("You do not have permission to revoke agent booking links.");
  }
  if (!UUID_RE.test(id)) throw new Error("Invalid link.");
  const { error } = await supabase
    .from("agent_booking_links")
    .update({ active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/bookings");
}

// =============================================
// BOOKING CHARGES (DAMAGE / ACCIDENT / FUEL)
// =============================================
export async function getBookingCharges(bookingId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("get_booking_charges", {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  return (data as unknown as unknown[]) || [];
}

export async function addBookingCharge(data: {
  bookingId: string;
  category: string;
  description: string;
  amountCents: number;
  currency?: string;
  quotationReference?: string;
  notes?: string;
}) {
  const { supabase } = await requireAuth();
  if (!data.bookingId) throw new Error("Booking is required");
  if (!data.category) throw new Error("Charge category is required");
  if (!data.description || data.description.trim().length < 3) throw new Error("Description is required");
  if (!data.amountCents || data.amountCents <= 0) throw new Error("Amount must be greater than 0");
  const currency = assertCurrency(data.currency);
  const { data: result, error } = await supabase.rpc("add_booking_charge", {
    p_booking_id: data.bookingId,
    p_category: data.category,
    p_description: data.description.trim(),
    p_amount_cents: data.amountCents,
    p_currency: currency,
    p_quotation_reference: data.quotationReference || null,
    p_notes: data.notes || null,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to add charge");
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/payments");
  return res;
}

export async function voidBookingCharge(chargeId: string, reason?: string) {
  const { supabase } = await requireAuth();
  if (!chargeId) throw new Error("Charge ID is required");
  const { data: result, error } = await supabase.rpc("void_booking_charge", {
    p_charge_id: chargeId,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
  const res = result as unknown as { error?: string; message?: string; success?: boolean };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to void charge");
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/payments");
  return res;
}

// =============================================
// CHECK-IN SESSION MANAGEMENT
// =============================================

/** Returned once from create RPC. raw_token exists only in this response. */
export interface CreatedCheckinSession {
  raw_token: string;
  session_id: string;
  token_short_id: string;
  expires_at: string;
  is_walkin: boolean;
}

/** Safe session summary for list/display. Never contains raw_token or token_hash. */
export interface StoredSessionSummary {
  id: string;
  token_short_id: string;
  expires_at: string;
  revoked_at: string | null;
  session_attempt_count: number;
  is_walkin: boolean;
  created_at: string;
  activities?: { name?: string } | { name?: string }[] | null;
}

export async function createCheckinSession(bookingId: string, activityId: string): Promise<CreatedCheckinSession> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("create_checkin_session", {
    p_booking_id: bookingId,
    p_activity_id: activityId,
    p_is_walkin: false,
  });
  if (error) throw error;
  const res = data as unknown as Record<string, unknown>;
  if (res && typeof res === "object" && "error" in res) {
    throw new Error(((res as { message?: string }).message) || "Failed to create session");
  }
  const raw_token = String(res?.session_token ?? "");
  if (!raw_token || !/^[0-9a-f]{64}$/i.test(raw_token)) {
    throw new Error("Server returned an invalid check-in token. Please try again.");
  }
  return {
    raw_token,
    session_id: String(res?.session_id ?? ""),
    token_short_id: String(res?.token_short_id ?? ""),
    expires_at: String(res?.expires_at ?? ""),
    is_walkin: Boolean(res?.is_walkin),
  };
}

export async function createWalkinCheckinSession(activityId: string): Promise<CreatedCheckinSession> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("create_checkin_session", {
    p_booking_id: "00000000-0000-0000-0000-000000000000",
    p_activity_id: activityId,
    p_is_walkin: true,
  });
  if (error) throw error;
  const res = data as unknown as Record<string, unknown>;
  if (res && typeof res === "object" && "error" in res) {
    throw new Error(((res as { message?: string }).message) || "Failed to create walk-in session");
  }
  const raw_token = String(res?.session_token ?? "");
  if (!raw_token || !/^[0-9a-f]{64}$/i.test(raw_token)) {
    throw new Error("Server returned an invalid check-in token. Please try again.");
  }
  return {
    raw_token,
    session_id: String(res?.session_id ?? ""),
    token_short_id: String(res?.token_short_id ?? ""),
    expires_at: String(res?.expires_at ?? ""),
    is_walkin: Boolean(res?.is_walkin),
  };
}

export async function revokeCheckinSession(sessionId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("revoke_checkin_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const res = data as unknown as { error?: string; message?: string };
  if (res && typeof res === "object" && "error" in res) {
    throw new Error((res as { message?: string }).message || "Failed to revoke session");
  }
}

export async function getCheckinSessionStatus(sessionId: string) {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("get_checkin_session_status", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data as unknown as {
    session_id: string;
    token_short_id: string;
    activity_name: string;
    booking_id: string;
    expires_at: string;
    revoked_at: string | null;
    session_attempt_count: number;
    max_session_attempts: number;
    is_walkin: boolean;
    participants: Array<{
      participant_id: string;
      full_name: string;
      participant_type: string;
      consent_status: string;
    }>;
  };
}

export async function getCheckinSessionsForBooking(bookingId: string): Promise<StoredSessionSummary[]> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("consent_checkin_sessions")
    .select("id, token_short_id, expires_at, revoked_at, session_attempt_count, is_walkin, created_at, activities(name)")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StoredSessionSummary[];
}

// =============================================
// CMS (site content, gallery, explore, activities content)
// Write access is enforced by RLS: owner/manager only.
// =============================================
const CMS_REVALIDATE = ["/"];

export async function getCMSContentSettings(): Promise<Record<string, string>> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.from("site_content").select("key, value");
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  return map;
}

export async function upsertSiteContent(pairs: { key: string; value: string }[]) {
  const { supabase } = await requireAuth();
  const rows = pairs
    .filter((p) => p.key.trim() !== "")
    .map((p) => ({ key: p.key.trim(), value: p.value, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("site_content").upsert(rows, { onConflict: "key" });
  if (error) throw error;
  for (const p of CMS_REVALIDATE) revalidatePath(p);
}

export async function getAllGalleryItems() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("gallery_items")
    .select("id, image_url, caption, orientation, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createGalleryItem(formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("gallery_items").insert(sanitizeGalleryItem(formData));
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/gallery");
}

export async function updateGalleryItem(id: string, formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("gallery_items")
    .update(sanitizeGalleryItem(formData))
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/gallery");
}

export async function deleteGalleryItem(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("gallery_items").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/gallery");
}

export async function getAllExploreItems() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("explore_items")
    .select("id, title, body, image_url, sort_order, active")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createExploreItem(formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("explore_items").insert(sanitizeExploreItem(formData));
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/explore");
}

export async function updateExploreItem(id: string, formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("explore_items")
    .update(sanitizeExploreItem(formData))
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/explore");
}

export async function deleteExploreItem(id: string) {
  const { supabase } = await requireAuth();
  const { error } = await supabase.from("explore_items").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/admin/content/explore");
}

export async function getActivityContentList() {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("activities")
    .select("id, name, slug, category, short_description, image, hero_image_url, featured, active")
    .order("category")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function updateActivityContent(id: string, formData: Record<string, unknown>) {
  const { supabase } = await requireAuth();
  const { error } = await supabase
    .from("activities")
    .update(sanitizeActivityContent(formData))
    .eq("id", id);
  if (error) throw error;
  for (const p of CMS_REVALIDATE) revalidatePath(p);
}
