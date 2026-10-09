// =============================================
// Thoddoo Marine — Currency formatting & conversion helpers
// All monetary storage is in MINOR UNITS (cents/laari).
// Exchange rate: 1 USD = 19 MVR (server-controlled constant).
// =============================================

export type Currency = "USD" | "MVR";

/** Cash-register-only extended currency set (USD, MVR plus Euro). */
export type Currency3 = "USD" | "MVR" | "EUR";

export const EXCHANGE_RATE_MVR_PER_USD = 19;

// Deterministic formatters using Intl.NumberFormat
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const laariFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// =============================================
// Core formatting
// =============================================

/** Format a minor-unit amount for display: $35.00 or MVR 630.00 */
export function formatMoney(amount: number, currency: Currency): string {
  if (currency === "MVR") {
    const majorUnits = amount / 100;
    return `MVR ${laariFormatter.format(majorUnits)}`;
  }
  return usdFormatter.format(amount / 100);
}

/** Nullable version — returns "—" for null/undefined */
export function formatMoneyNullable(
  amount: number | null | undefined,
  currency?: string | null
): string {
  if (amount == null) return "—";
  return formatMoney(amount, (currency as Currency) || "USD");
}

/** Format a minor-unit amount in any of the three cash-register currencies. */
export function formatMoney3(amount: number, currency: Currency3): string {
  if (currency === "EUR") return eurFormatter.format(amount / 100);
  return formatMoney(amount, currency);
}

/** Strict 3-way currency check for cash register — throws otherwise. */
export function assertCurrency3(v: unknown): Currency3 {
  if (v === "USD" || v === "MVR" || v === "EUR") return v;
  throw new Error("Currency must be USD, MVR or EUR.");
}

/** 3-way currency fallback — returns 'USD' for anything unrecognized. */
export function currency3ForDisplay(v: unknown): Currency3 {
  if (v === "MVR") return "MVR";
  if (v === "EUR") return "EUR";
  return "USD";
}

// =============================================
// Dual-currency display
// =============================================

/**
 * Dual-currency display for USD-priced items:
 * "$35.00 / MVR 630.00"
 */
export function formatDualCurrency(usdCents: number): string {
  const usd = formatMoney(usdCents, "USD");
  const mvrCents = convertUsdCentsToMvrCents(usdCents, EXCHANGE_RATE_MVR_PER_USD);
  return `${usd} / ${formatMoney(mvrCents, "MVR")}`;
}

/**
 * Dual-currency display for MVR-priced items:
 * "MVR 630.00 / $35.00"
 */
export function formatDualCurrencyMvr(mvrCents: number): string {
  const mvr = formatMoney(mvrCents, "MVR");
  const usdCents = convertMvrCentsToUsdCents(mvrCents, EXCHANGE_RATE_MVR_PER_USD);
  return `${mvr} / ${formatMoney(usdCents, "USD")}`;
}

/**
 * Format price for a specific activity currency, with optional dual display.
 * Returns "$35.00" for USD or "MVR 630.00" for MVR.
 * For single-currency display (no conversion).
 */
export function formatActivityPrice(
  cents: number,
  currency?: string | null
): string {
  return formatMoney(cents, (currency as Currency) || "USD");
}

/**
 * Format price label for dual-currency display.
 * If currency is USD: "$35.00 / MVR 630.00"
 * If currency is MVR: "MVR 630.00 / $35.00"
 */
export function formatPriceDual(
  cents: number,
  currency?: string | null
): string {
  const c = (currency as Currency) || "USD";
  if (c === "MVR") {
    return formatDualCurrencyMvr(cents);
  }
  return formatDualCurrency(cents);
}

// =============================================
// Conversion helpers (integer arithmetic)
// =============================================

/** Convert USD cents to MVR cents (laari) using integer arithmetic */
export function convertUsdCentsToMvrCents(
  usdCents: number,
  rate: number = EXCHANGE_RATE_MVR_PER_USD
): number {
  return Math.round(usdCents * rate);
}

/** Convert MVR cents (laari) to USD cents using integer arithmetic */
export function convertMvrCentsToUsdCents(
  mvrCents: number,
  rate: number = EXCHANGE_RATE_MVR_PER_USD
): number {
  return Math.round(mvrCents / rate);
}

// =============================================
// Minor/major unit conversion (for forms)
// =============================================

/** Convert a major-unit value (dollars or MVR) to minor units (cents/laari).
 *  e.g. dollarsToCents(35) = 3500, mvrToLaari(630) = 63000
 */
export function majorToMinor(value: number): number {
  return Math.round(value * 100);
}

/** Convert minor units (cents/laari) to major units for display.
 *  e.g. minorToMajor(3500) = 35
 */
export function minorToMajor(cents: number): number {
  return cents / 100;
}

// =============================================
// Currency validation helpers
// =============================================

/** Strict currency validation — throws if value is not 'USD' or 'MVR'.
 *  Use in server actions and RPCs to reject invalid input.
 */
export function assertCurrency(v: unknown): Currency {
  if (v === "USD") return "USD";
  if (v === "MVR") return "MVR";
  throw new Error("Currency must be USD or MVR.");
}

/** Currency validation with fallback — returns 'USD' for invalid values.
 *  Use in client display code where graceful fallback is preferred.
 */
export function currencyForDisplay(v: unknown): Currency {
  if (v === "MVR") return "MVR";
  return "USD";
}

/** @deprecated Use currencyForDisplay() for display, assertCurrency() for validation */
export const validCurrency = currencyForDisplay;

// =============================================
// Form input helpers
// =============================================

/** Convert a form input string (major units) to cents/laari for storage.
 *  Returns 0 if input is empty.
 *  Strict regex: must match ^\d+(\.\d{1,2})?$ — no parseFloat before validation.
 *  Throws on invalid non-empty input.
 */
export function parseMajorInput(value: string): number {
  if (!value || value.trim() === "") return 0;
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Invalid amount format. Use a number with at most 2 decimal places (e.g. 35 or 35.50).");
  }
  return Math.round(parseFloat(trimmed) * 100);
}

// =============================================
// Public-facing (USD-only) display
// =============================================

/**
 * Single-currency USD display for the public website.
 * Always renders "$35.00" regardless of stored currency —
 * MVR-priced items are converted to USD so MVR never appears
 * on the public site. Backend/admin pages keep the dual display.
 */
export function formatUsdOnly(cents: number, currency?: string | null): string {
  if ((currency as Currency) === "MVR") {
    const usdCents = convertMvrCentsToUsdCents(cents, EXCHANGE_RATE_MVR_PER_USD);
    return formatMoney(usdCents, "USD");
  }
  return formatMoney(cents, "USD");
}

/** Convert cents/laari to a major-unit string for form display.
 *  Returns "" for 0.
 */
export function toMajorInput(cents: number): string {
  if (!cents || cents === 0) return "";
  return (cents / 100).toFixed(2).replace(/\.?0+$/, "");
}
