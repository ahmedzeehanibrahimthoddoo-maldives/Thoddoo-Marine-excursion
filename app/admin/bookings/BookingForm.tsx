"use client";

import { useState, useEffect, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createBooking, updateBooking, getCustomers, getActivities } from "@/lib/supabase/actions";
import {
  formatMoney,
  toMajorInput,
  parseMajorInput,
  validCurrency,
  EXCHANGE_RATE_MVR_PER_USD,
  type Currency,
} from "@/lib/money";
import { convertToBasisCurrency } from "@/lib/commission";
import { unitPriceTotalCents, normalizePricingUnit, type PricingUnit } from "@/lib/pricing";
import { EMAIL_REQUIRED_MESSAGE, isValidEmail } from "@/lib/email";
import {
  MAX_COMMISSION_PERCENT,
  commissionMode,
  resolveCommission,
  type CommissionMode,
} from "@/lib/commission";

interface BookingFormProps {
  open: boolean;
  onClose: () => void;
  booking?: Record<string, unknown>;
  onSaved: () => void;
}

export default function BookingForm({ open, onClose, booking, onSaved }: BookingFormProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [customersList, setCustomersList] = useState<Record<string, unknown>[]>([]);
  const [activitiesList, setActivitiesList] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({
    customer_id: (booking?.customer_id as string) || "",
    activity_id: (booking?.activity_id as string) || "",
    source: (booking?.source as string) || "online",
    guests: String(booking?.guests || "1"),
    adults: String(booking?.adults || ""),
    children_count: String(booking?.children_count || ""),
    booking_date: (booking?.booking_date as string) || "",
    preferred_time: (booking?.preferred_time as string) || "",
    hotel_name: (booking?.hotel_name as string) || "",
    room_number: (booking?.room_number as string) || "",
    pickup_location: (booking?.pickup_location as string) || "",
    pricing_option_label: (booking?.pricing_option_label as string) || "",
    pricing_option_cents: toMajorInput(Number(booking?.pricing_option_cents ?? 0)),
    pricing_unit: normalizePricingUnit(booking?.pricing_unit),
    estimated_total_cents: toMajorInput(Number(booking?.estimated_total_cents ?? 0)),
    total_cents: toMajorInput(Number(booking?.total_cents ?? 0)),
    special_requests: (booking?.special_requests as string) || "",
    status: (booking?.status as string) || "pending",
    partner: (booking?.partner as string) || "",
    net_cents: toMajorInput(Number(booking?.net_cents ?? 0)),
    commission_cents: toMajorInput(Number(booking?.commission_cents ?? 0)),
    arrival_date: (booking?.arrival_date as string) || "",
    arrival_time: (booking?.arrival_time as string) || "",
    transfer: (booking?.transfer as string) || "",
  });
  const [booking_currency, setBookingCurrency] = useState(validCurrency(booking?.booking_currency));
  // Records the last currency switch so the form can say what it did and at
  // what rate, rather than quietly rewriting the operator's figures.
  const [conversionNote, setConversionNote] = useState<{ from: Currency; to: Currency } | null>(null);
  const [guestAgreed, setGuestAgreed] = useState(false);

  // The guest's email, edited here rather than by a detour to the Customers
  // page: 072 makes a valid customer email a precondition for every booking, and
  // most of the old records have none, so staff hit that error constantly.
  const [guestEmail, setGuestEmail] = useState(
    String((booking?.customers as Record<string, unknown> | undefined)?.email || "")
  );

  // 077: the partner cut is either a percentage of the total or a fixed amount,
  // and the booking keeps its own rule so it stays recomputable. The resolved
  // numbers land in form.commission_cents / form.net_cents, which is what saves.
  const [commissionKind, setCommissionKind] = useState<CommissionMode>(
    commissionMode(booking?.commission_mode)
  );
  const [commissionPercent, setCommissionPercent] = useState(
    booking?.commission_percent === null || booking?.commission_percent === undefined
      ? ""
      : String(booking.commission_percent)
  );
  const [commissionCurrency, setCommissionCurrency] = useState<"USD" | "MVR">(
    validCurrency(booking?.commission_currency) || validCurrency(booking?.booking_currency)
  );

  useEffect(() => {
    if (!open) return;
    getCustomers().then(setCustomersList).catch(() => {});
    getActivities().then(setActivitiesList).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (booking) {
      setBookingCurrency(validCurrency(booking.booking_currency));
      setConversionNote(null);
      setGuestAgreed(booking.guest_agreed === true);
      setCommissionKind(commissionMode(booking.commission_mode));
      setCommissionPercent(
        booking.commission_percent === null || booking.commission_percent === undefined
          ? ""
          : String(booking.commission_percent)
      );
      setCommissionCurrency(
        validCurrency(booking.commission_currency) || validCurrency(booking.booking_currency)
      );
      setForm({
        customer_id: (booking.customer_id as string) || "",
        activity_id: (booking.activity_id as string) || "",
        source: (booking.source as string) || "online",
        guests: String(booking.guests || "1"),
        adults: String(booking.adults || ""),
        children_count: String(booking.children_count || ""),
        booking_date: (booking.booking_date as string) || "",
        preferred_time: (booking.preferred_time as string) || "",
        hotel_name: (booking.hotel_name as string) || "",
        room_number: (booking.room_number as string) || "",
        pickup_location: (booking.pickup_location as string) || "",
        pricing_option_label: (booking.pricing_option_label as string) || "",
        pricing_option_cents: toMajorInput(Number(booking.pricing_option_cents ?? 0)),
        pricing_unit: normalizePricingUnit(booking.pricing_unit),
        estimated_total_cents: toMajorInput(Number(booking.estimated_total_cents ?? 0)),
        total_cents: toMajorInput(Number(booking.total_cents ?? 0)),
        special_requests: (booking.special_requests as string) || "",
        status: (booking.status as string) || "pending",
        partner: (booking.partner as string) || "",
        net_cents: toMajorInput(Number(booking.net_cents ?? 0)),
        commission_cents: toMajorInput(Number(booking.commission_cents ?? 0)),
        arrival_date: (booking.arrival_date as string) || "",
        arrival_time: (booking.arrival_time as string) || "",
        transfer: (booking.transfer as string) || "",
      });
    } else {
      setBookingCurrency("USD");
      setConversionNote(null);
      setGuestAgreed(false);
      setCommissionKind("fixed");
      setCommissionPercent("");
      setCommissionCurrency("USD");
      setForm({
        customer_id: "",
        activity_id: "",
        source: "online",
        guests: "1",
        adults: "",
        children_count: "",
        booking_date: "",
        preferred_time: "",
        hotel_name: "",
        room_number: "",
        pickup_location: "",
        pricing_option_label: "",
        pricing_option_cents: "",
        pricing_unit: "per_unit",
        estimated_total_cents: "",
        total_cents: "",
        special_requests: "",
        status: "pending",
        partner: "",
        net_cents: "",
        commission_cents: "",
        arrival_date: "",
        arrival_time: "",
        transfer: "",
      });
    }
  }, [booking, open]);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /** Amount helpers that never throw on a half-typed field. */
  const cents = (value: string) => {
    try {
      return parseMajorInput(value);
    } catch {
      return 0;
    }
  };

  /**
   * Re-resolve the commission and the operator's take from the rule, and write
   * both into the form. Called when the rule changes OR when the total changes,
   * because a percentage moves with the total — that re-derivability is the
   * whole reason the rate is stored next to the amount.
   *
   * pax is 1 here: this form's fixed amount is for the whole booking. The
   * per-guest fixed rate lives on the activity and is multiplied out by the
   * insert trigger / the backfill RPC.
   */
  function applyCommissionRule(next?: {
    mode?: CommissionMode;
    percent?: string;
    currency?: "USD" | "MVR";
    basis?: string;
    fixed?: string;
  }) {
    const mode = next?.mode ?? commissionKind;
    const percent = next?.percent ?? commissionPercent;
    const currency = next?.currency ?? commissionCurrency;
    const basis = cents(next?.basis ?? form.total_cents);
    const fixed = cents(next?.fixed ?? form.commission_cents);
    const result = resolveCommission({
      mode,
      percent,
      fixedCents: fixed,
      fixedCurrency: currency,
      basisCents: basis,
      pax: 1,
      basisCurrency: booking_currency,
    });
    setCommissionKind(mode);
    setCommissionPercent(percent);
    setCommissionCurrency(currency);
    setForm((prev) => ({
      ...prev,
      commission_cents: result.commissionCents ? toMajorInput(result.commissionCents) : "",
      net_cents: basis ? toMajorInput(result.netCents) : prev.net_cents,
    }));
  }

  const commissionPreview = resolveCommission({
    mode: commissionKind,
    percent: commissionPercent,
    fixedCents: cents(form.commission_cents),
    fixedCurrency: commissionCurrency,
    basisCents: cents(form.total_cents),
    pax: 1,
    basisCurrency: booking_currency,
  });

  // ---- Pricing basis: a unit price multiplied out into the total ----

  /** What the unit price works out to at the current party size. */
  const unitTotal = unitPriceTotalCents(
    cents(form.pricing_option_cents),
    form.pricing_unit as PricingUnit,
    Number(form.guests)
  );
  const hasUnitPrice = cents(form.pricing_option_cents) > 0;
  const isPerPerson = form.pricing_unit === "per_person";

  /** Move every entered amount into another currency at the fixed rate. */
  function convertAmount(value: string, from: Currency, to: Currency): string {
    const c = cents(value);
    if (!c) return value === "" ? "" : "0.00";
    return toMajorInput(convertToBasisCurrency(c, from, to));
  }

  /**
   * Switching currency must carry the money with it: totals, commission and
   * the unit price are all stored in the booking's own currency, so leaving
   * the numbers alone would silently relabel $100.00 as MVR 100.00. The
   * commission rule is re-resolved afterwards so a percentage still matches
   * the converted total.
   */
  function changeCurrency(next: Currency) {
    if (next === booking_currency) return;
    const from = booking_currency;
    setForm((prev) => ({
      ...prev,
      total_cents: convertAmount(prev.total_cents, from, next),
      net_cents: convertAmount(prev.net_cents, from, next),
      commission_cents: convertAmount(prev.commission_cents, from, next),
      pricing_option_cents: convertAmount(prev.pricing_option_cents, from, next),
      estimated_total_cents: prev.estimated_total_cents
        ? convertAmount(prev.estimated_total_cents, from, next)
        : prev.estimated_total_cents,
    }));
    // A fixed commission quoted in the old currency would be read as the new
    // one, so re-quote it alongside the total.
    if (commissionKind === "fixed" && commissionCurrency === from) {
      setCommissionCurrency(next);
    }
    setBookingCurrency(next);
    setConversionNote({ from, to: next });
  }

  /** Unit price, party size or unit changed: re-derive the total from them. */
  function applyUnitPrice(next?: { unit?: string; price?: string; pax?: string }) {
    const price = next?.price ?? form.pricing_option_cents;
    const pax = next?.pax ?? form.guests;
    const unit = (next?.unit ?? form.pricing_unit) as PricingUnit;
    setForm((prev) => {
      const updated: typeof prev = {
        ...prev,
        pricing_unit: unit,
        pricing_option_cents: price,
        guests: pax,
      };
      const total = unitPriceTotalCents(cents(price), unit, Number(pax));
      if (total > 0) updated.total_cents = toMajorInput(total);
      return updated;
    });
    const total = unitPriceTotalCents(cents(price), unit, Number(pax));
    if (total > 0 && commissionKind === "percent") {
      setForm((prev) => ({ ...prev, total_cents: toMajorInput(total) }));
      applyCommissionRule({ basis: toMajorInput(total) });
    }
  }

  // ---- Transparent breakdown of how the money was reached ----
  const totalCents = cents(form.total_cents);
  const commissionCents = cents(form.commission_cents);
  const netCents = cents(form.net_cents);
  const otherCurrency: Currency = booking_currency === "USD" ? "MVR" : "USD";
  const netMatchesTotal = totalCents === 0 || commissionCents === 0 || totalCents - commissionCents === netCents;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) {
      setToast({ type: "error", message: "Please select a customer." });
      return;
    }
    if (!form.activity_id) {
      setToast({ type: "error", message: "Please select an activity." });
      return;
    }
    if (!isValidEmail(guestEmail)) {
      setToast({ type: "error", message: EMAIL_REQUIRED_MESSAGE });
      return;
    }
    if (!guestAgreed) {
      setToast({ type: "error", message: "Confirm the guest agreed to the Consent & Liability before saving the booking." });
      return;
    }
    startTransition(async () => {
      try {
        if (booking?.id) {
          await updateBooking(booking.id as string, {
            customer_id: form.customer_id,
            guest_email: guestEmail.trim(),
            activity_id: form.activity_id,
            source: form.source,
            guests: Number(form.guests),
            adults: form.adults ? Number(form.adults) : null,
            children_count: form.children_count ? Number(form.children_count) : null,
            booking_date: form.booking_date || null,
            preferred_time: form.preferred_time || null,
            hotel_name: form.hotel_name || null,
            room_number: form.room_number || null,
            pickup_location: form.pickup_location || null,
            pricing_option_label: form.pricing_option_label || null,
            pricing_option_cents: form.pricing_option_cents ? parseMajorInput(form.pricing_option_cents) : 0,
            pricing_unit: hasUnitPrice ? form.pricing_unit : null,
            estimated_total_cents: form.estimated_total_cents ? parseMajorInput(form.estimated_total_cents) : null,
            total_cents: parseMajorInput(form.total_cents),
            special_requests: form.special_requests || null,
            status: form.status,
            booking_currency,
            partner: form.partner || null,
            net_cents: parseMajorInput(form.net_cents),
            commission_cents: parseMajorInput(form.commission_cents),
            commission_mode: commissionKind,
            commission_percent: commissionKind === "percent" ? commissionPercent : null,
            commission_currency: commissionCurrency,
            arrival_date: form.arrival_date || null,
            arrival_time: form.arrival_time || null,
            transfer: form.transfer || null,
          });
        } else {
          await createBooking({
            customer_id: form.customer_id,
            guest_email: guestEmail.trim(),
            activity_id: form.activity_id,
            source: form.source,
            guests: Number(form.guests),
            adults: form.adults ? Number(form.adults) : null,
            children_count: form.children_count ? Number(form.children_count) : null,
            booking_date: form.booking_date || null,
            preferred_time: form.preferred_time || null,
            hotel_name: form.hotel_name || null,
            room_number: form.room_number || null,
            pickup_location: form.pickup_location || null,
            pricing_option_label: form.pricing_option_label || null,
            estimated_total_cents: form.estimated_total_cents ? parseMajorInput(form.estimated_total_cents) : null,
            total_cents: parseMajorInput(form.total_cents) || 0,
            special_requests: form.special_requests || undefined,
            booking_currency,
            partner: form.partner || undefined,
            pricing_option_cents: form.pricing_option_cents ? parseMajorInput(form.pricing_option_cents) : 0,
            pricing_unit: hasUnitPrice ? form.pricing_unit : undefined,
            net_cents: parseMajorInput(form.net_cents) || 0,
            commission_cents: parseMajorInput(form.commission_cents) || 0,
            commission_mode: commissionKind,
            commission_percent: commissionKind === "percent" ? commissionPercent : null,
            commission_currency: commissionCurrency,
            arrival_date: form.arrival_date || undefined,
            arrival_time: form.arrival_time || undefined,
            transfer: form.transfer || undefined,
            guest_agreed: guestAgreed,
          });
        }
        onSaved();
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save booking." });
      }
    });
  }

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={booking?.id ? "Edit Booking" : "New Booking"}
      wide
      footer={
        <>
          <button type="button" className="formCancel" onClick={onClose}>Cancel</button>
          <button type="submit" form="booking-form" className="formSubmit" disabled={pending}>
            {pending ? "Saving..." : booking?.id ? "Update Booking" : "Create Booking"}
          </button>
        </>
      }
    >
      {toast && <Toast type={toast.type} message={toast.message} />}
      <form id="booking-form" onSubmit={handleSubmit}>
        <FormRow cols={2}>
          <FormField label="Customer" htmlFor="bf-customer" required>
            <select
              id="bf-customer"
              value={form.customer_id}
              onChange={(e) => {
                const id = e.target.value;
                set("customer_id", id);
                const chosen = customersList.find((c) => String(c.id) === id);
                setGuestEmail(chosen ? String(chosen.email || "") : "");
              }}
            >
              <option value="">Select customer...</option>
              {customersList.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {c.full_name as string}
                  {/* Flagged in the list so a missing address is visible before saving fails */}
                  {isValidEmail(c.email as string) ? "" : "  (no email)"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Activity" htmlFor="bf-activity" required>
            <select id="bf-activity" value={form.activity_id} onChange={(e) => set("activity_id", e.target.value)}>
              <option value="">Select activity...</option>
              {activitiesList.map((a) => (
                <option key={a.id as string} value={a.id as string}>{a.name as string}</option>
              ))}
            </select>
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Guest Email" htmlFor="bf-guest-email" required hint="Saved to the customer. Required for every booking — invoices and waivers are emailed here.">
            <input
              id="bf-guest-email"
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="guest@example.com"
            />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Source" htmlFor="bf-source">
            <select id="bf-source" value={form.source} onChange={(e) => set("source", e.target.value)}>
              <option value="online">Website</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="walk_in">Walk-in</option>
            </select>
          </FormField>
          <FormField label="Adults" htmlFor="bf-admin-adults">
            <input id="bf-admin-adults" type="number" min="0" value={form.adults} onChange={(e) => set("adults", e.target.value)} placeholder="0" />
          </FormField>
          <FormField label="Children" htmlFor="bf-admin-children">
            <input id="bf-admin-children" type="number" min="0" value={form.children_count} onChange={(e) => set("children_count", e.target.value)} placeholder="0" />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField
            label="Guests (total)"
            htmlFor="bf-guests"
            required
            hint={hasUnitPrice && isPerPerson ? "Total = price per person × guests" : undefined}
          >
            <input
              id="bf-guests"
              type="number"
              min="1"
              value={form.guests}
              onChange={(e) => applyUnitPrice({ pax: e.target.value })}
            />
          </FormField>
          <FormField label="Status" htmlFor="bf-status">
            <select id="bf-status" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </select>
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Booking Date" htmlFor="bf-admin-date">
            <input id="bf-admin-date" type="date" value={form.booking_date} onChange={(e) => set("booking_date", e.target.value)} />
          </FormField>
          <FormField label="Preferred Time" htmlFor="bf-admin-time">
            <input id="bf-admin-time" type="time" value={form.preferred_time} onChange={(e) => set("preferred_time", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Hotel / Guesthouse" htmlFor="bf-admin-hotel">
            <input id="bf-admin-hotel" type="text" value={form.hotel_name} onChange={(e) => set("hotel_name", e.target.value)} />
          </FormField>
          <FormField label="Room Number" htmlFor="bf-admin-room">
            <input id="bf-admin-room" type="text" value={form.room_number} onChange={(e) => set("room_number", e.target.value)} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Pickup Location" htmlFor="bf-admin-pickup">
            <input id="bf-admin-pickup" type="text" value={form.pickup_location} onChange={(e) => set("pickup_location", e.target.value)} />
          </FormField>
          <FormField label="Pricing Option" htmlFor="bf-admin-option">
            <input id="bf-admin-option" type="text" value={form.pricing_option_label} onChange={(e) => set("pricing_option_label", e.target.value)} placeholder="e.g. Per person" />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Price per" htmlFor="bf-admin-unit">
            <select
              id="bf-admin-unit"
              value={form.pricing_unit}
              onChange={(e) => applyUnitPrice({ unit: e.target.value })}
            >
              <option value="per_person">Person</option>
              <option value="per_unit">Booking / unit</option>
              <option value="per_hour">Hour</option>
            </select>
          </FormField>
          <FormField
            label={isPerPerson ? "Price per person" : "Price per unit"}
            htmlFor="bf-admin-unit-price"
            hint={
              hasUnitPrice && isPerPerson
                ? `${form.guests || "0"} × ${formatMoney(cents(form.pricing_option_cents), booking_currency)} = ${formatMoney(unitTotal, booking_currency)}`
                : hasUnitPrice
                  ? "Single price, not multiplied by party size"
                  : "Set a price to calculate the total automatically"
            }
          >
            <input
              id="bf-admin-unit-price"
              type="number"
              step="0.01"
              min="0"
              value={form.pricing_option_cents}
              onChange={(e) => applyUnitPrice({ price: e.target.value })}
              placeholder="0.00"
            />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Est. Total" htmlFor="bf-admin-est">
            <input id="bf-admin-est" type="number" step="0.01" min="0" value={form.estimated_total_cents} onChange={(e) => set("estimated_total_cents", e.target.value)} />
          </FormField>
          <FormField label="Total" htmlFor="bf-admin-total" required>
            <input
              id="bf-admin-total"
              type="number"
              step="0.01"
              min="0"
              value={form.total_cents}
              onChange={(e) => {
                const value = e.target.value;
                set("total_cents", value);
                // A percentage moves with the total, so re-resolve as they type.
                if (commissionKind === "percent") applyCommissionRule({ basis: value });
              }}
            />
          </FormField>
          <FormField
            label="Currency"
            htmlFor="bf-admin-currency"
            hint={`1 USD = ${EXCHANGE_RATE_MVR_PER_USD} MVR — switching converts the amounts`}
          >
            <select id="bf-admin-currency" value={booking_currency} onChange={(e) => changeCurrency(e.target.value as Currency)}>
              <option value="USD">USD</option>
              <option value="MVR">MVR</option>
            </select>
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Partner / Agent" htmlFor="bf-partner" hint="e.g. Botexmoja, operator name">
            <input id="bf-partner" type="text" value={form.partner} onChange={(e) => set("partner", e.target.value)} />
          </FormField>
          <FormField label="Commission type" htmlFor="bf-commission-mode">
            <select
              id="bf-commission-mode"
              value={commissionKind}
              onChange={(e) => applyCommissionRule({ mode: e.target.value as CommissionMode })}
            >
              <option value="fixed">Fixed amount</option>
              <option value="percent">Percent of total</option>
            </select>
          </FormField>
          <FormField
            label="Commission"
            htmlFor="bf-commission"
            hint={
              commissionKind === "percent"
                ? `Resolved automatically: ${formatMoney(commissionPreview.commissionCents, commissionPreview.currency)}.`
                : `Commission paid to the partner, quoted in ${commissionCurrency}.`
            }
          >
            {commissionKind === "percent" ? (
              <>
                <input
                  id="bf-commission"
                  type="number"
                  step="0.01"
                  min="0"
                  max={MAX_COMMISSION_PERCENT}
                  value={commissionPercent}
                  onChange={(e) => applyCommissionRule({ percent: e.target.value })}
                  placeholder="10"
                />
                <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}> % of the total</span>
              </>
            ) : (
              <input
                id="bf-commission"
                type="number"
                step="0.01"
                min="0"
                value={form.commission_cents}
                onChange={(e) => applyCommissionRule({ fixed: e.target.value })}
                placeholder="0"
              />
            )}
          </FormField>
          <FormField label="Net (your take)" htmlFor="bf-net" hint="Price minus commission. Used for trip revenue.">
            <input id="bf-net" type="number" step="0.01" min="0" value={form.net_cents} onChange={(e) => set("net_cents", e.target.value)} placeholder="0" />
          </FormField>
          {commissionKind === "fixed" && (
            <FormField label="Commission currency" htmlFor="bf-commission-currency" hint="Converted to the booking currency on save.">
              <select
                id="bf-commission-currency"
                value={commissionCurrency}
                onChange={(e) => {
                  const currency = e.target.value as "USD" | "MVR";
                  const resolved = resolveCommission({
                    mode: commissionKind,
                    percent: commissionPercent,
                    fixedCents: cents(form.commission_cents),
                    fixedCurrency: currency,
                    basisCents: cents(form.total_cents),
                    pax: 1,
                    basisCurrency: booking_currency,
                  });
                  setCommissionCurrency(currency);
                  setForm((prev) => ({ ...prev, commission_cents: resolved.commissionCents ? toMajorInput(resolved.commissionCents) : "" }));
                }}
              >
                <option value="USD">USD</option>
                <option value="MVR">MVR</option>
              </select>
            </FormField>
          )}
        </FormRow>

        {/* Every figure above, shown as the arithmetic that produced it, so a
            price can be checked at a glance instead of trusted. */}
        <div className="bookingCalc">
          <div className="bookingCalcTitle">Calculation</div>
          {conversionNote && (
            <div className="bookingCalcLine bookingCalcMuted">
              Converted from {conversionNote.from} to {conversionNote.to} at 1 USD ={" "}
              {EXCHANGE_RATE_MVR_PER_USD} MVR when you changed the currency.
            </div>
          )}
          <div className="bookingCalcLine">
            {hasUnitPrice ? (
              <>
                {isPerPerson
                  ? `${form.guests || 0} guest${form.guests === "1" ? "" : "s"} × ${formatMoney(cents(form.pricing_option_cents), booking_currency)} per person = `
                  : `Price per ${form.pricing_unit === "per_hour" ? "hour" : "unit"} ${formatMoney(cents(form.pricing_option_cents), booking_currency)} = `}
                <strong>{formatMoney(unitTotal, booking_currency)}</strong> total
                {!isPerPerson && <span className="bookingCalcMuted"> (not multiplied by party size)</span>}
              </>
            ) : (
              <>
                Total entered directly: <strong>{formatMoney(totalCents, booking_currency)}</strong>
              </>
            )}
          </div>
          <div className="bookingCalcLine">
            {commissionKind === "percent" ? `${commissionPercent || 0}% commission = ` : "Fixed commission "}
            <strong>{formatMoney(commissionCents, booking_currency)}</strong>
            {commissionKind === "fixed" && commissionCurrency !== booking_currency && (
              <span className="bookingCalcMuted">
                {" "}
                (quoted {formatMoney(cents(form.commission_cents), commissionCurrency)})
              </span>
            )}
            {" · net to operator "}
            <strong>{formatMoney(netCents, booking_currency)}</strong>
          </div>
          {!netMatchesTotal && totalCents > 0 && commissionCents > 0 && (
            <div className="bookingCalcLine bookingCalcWarn">
              Net does not equal total minus commission ({formatMoney(totalCents - commissionCents, booking_currency)});
              it will be saved exactly as entered.
            </div>
          )}
          {totalCents !== 0 && (
            <div className="bookingCalcLine bookingCalcMuted">
              At {EXCHANGE_RATE_MVR_PER_USD} MVR/USD: {formatMoney(totalCents, booking_currency)} ={" "}
              {formatMoney(convertToBasisCurrency(totalCents, booking_currency, otherCurrency), otherCurrency)}
              {commissionCents !== 0 &&
                ` · commission ${formatMoney(commissionCents, booking_currency)} = ${formatMoney(convertToBasisCurrency(commissionCents, booking_currency, otherCurrency), otherCurrency)}`}
              {` · net ${formatMoney(netCents, booking_currency)} = ${formatMoney(convertToBasisCurrency(netCents, booking_currency, otherCurrency), otherCurrency)}`}
            </div>
          )}
        </div>
        <FormRow cols={3}>
          <FormField label="Arrival Date" htmlFor="bf-arrival-date" hint="When the guest reaches Thoddoo.">
            <input id="bf-arrival-date" type="date" value={form.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} />
          </FormField>
          <FormField label="Arrival Time" htmlFor="bf-arrival-time">
            <input id="bf-arrival-time" type="time" value={form.arrival_time} onChange={(e) => set("arrival_time", e.target.value)} />
          </FormField>
          <FormField label="Transfer / Flight" htmlFor="bf-transfer" hint="e.g. TMA FLT 42 / speedboat transfer.">
            <input id="bf-transfer" type="text" value={form.transfer} onChange={(e) => set("transfer", e.target.value)} />
          </FormField>
        </FormRow>
        <FormField label="Special Requests" htmlFor="bf-admin-notes">
          <textarea id="bf-admin-notes" value={form.special_requests} onChange={(e) => set("special_requests", e.target.value)} />
        </FormField>
        <label className="consentTick" style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={guestAgreed}
            onChange={(e) => setGuestAgreed(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            I confirm the guest has read and agreed to the <strong>Consent &amp; Liability</strong> terms before booking.
          </span>
        </label>
      </form>
    </AdminModal>
  );
}
