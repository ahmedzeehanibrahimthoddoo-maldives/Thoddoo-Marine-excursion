// Client-side mirror of the price resolution that
// submit_public_booking_group_v2 does server-side (migration 079).
//
// The rule, cheapest source of truth first:
//   1. an activity_pricing row for the selected option carries its own unit
//      ("10 minutes" -> per_unit), so the unit is never guessed;
//   2. an activity that HAS priced options but no chosen label is charged once
//      (a jet ski session is per ride, not per head);
//   3. an activity with NO priced options falls back to activities.price_note,
//      which reception types per trip ("/ person", "/ hour", "/ boat (half day)").
//      "/ person" means the base rate is charged per guest.
//
// Before 079 the client multiplied only when an option said per_person, so a
// $45 "/ person" dolphin cruise showed $45 for a party of four.

export type PricingUnit = "per_person" | "per_unit" | "per_hour";

export const PRICING_UNITS: PricingUnit[] = ["per_person", "per_unit", "per_hour"];

export interface PricingUnitOption {
  label: string;
  pricingUnit?: string | null;
}

export function resolvePricingUnit(
  options: PricingUnitOption[] | undefined,
  selectedLabel: string,
  priceNote?: string | null
): PricingUnit {
  const match = options?.find((o) => o.label === selectedLabel);
  const declared = match?.pricingUnit;
  if (declared === "per_person" || declared === "per_unit" || declared === "per_hour") {
    return declared;
  }
  if (options && options.length > 0) return "per_unit";
  if (priceNote && priceNote.toLowerCase().includes("person")) return "per_person";
  return "per_unit";
}

export function partyAdjustedCents(
  priceCents: number,
  options: PricingUnitOption[] | undefined,
  selectedLabel: string,
  priceNote: string | undefined,
  guests: number
): number {
  const unit = resolvePricingUnit(options, selectedLabel, priceNote);
  return unit === "per_person" ? priceCents * Math.max(1, guests) : priceCents;
}

/**
 * Total for an explicitly stated unit price, where the caller already knows the
 * basis (the admin edit form lets staff pick it) instead of inferring it from
 * the price list. Only a per-person price multiplies by the party size.
 */
export function unitPriceTotalCents(
  unitPriceCents: number | null | undefined,
  unit: PricingUnit | null | undefined,
  pax: number | null | undefined
): number {
  const price = Number(unitPriceCents) || 0;
  if (price <= 0) return 0;
  if (unit !== "per_person") return price;
  return price * Math.max(1, Number(pax) || 1);
}

/** Coerce anything stored or typed into a known pricing unit. */
export function normalizePricingUnit(value: unknown): PricingUnit {
  // Reading is tolerant because this value also arrives as free text elsewhere
  // ("Per person"), while writing stays strict in sanitize.ts — a typo should
  // be rejected on save, not silently flattened when a form loads.
  const v = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "per_person" || v === "per_hour" || v === "per_unit") return v;
  return "per_unit";
}
