/**
 * Commission rules — a partner cut that is either a percentage of the booking
 * total or a fixed amount, and may be quoted in USD or MVR.
 *
 * Why this file exists at all: `commission_cents` is a single integer and the
 * reports treat a booking's money as being in `booking_currency`. So a fixed
 * MVR commission typed onto a USD booking used to have nowhere to go except
 * into that integer, where it would later be read as USD and understate the
 * partner's cut by 18x. Everything here therefore ends in ONE currency — the
 * booking's — and reports stay able to sum it.
 *
 * The rule (mode + percent) is stored alongside the resolved amount so it stays
 * recomputable: a percentage that was flattened to a number on save cannot be
 * re-derived when the booking total changes. This mirrors what migration 077
 * snapshots on INSERT and what backfill_booking_commission() writes.
 *
 * Pure functions only — the SQL trigger and the RPC implement the same rules,
 * and tests/features.test.ts pins them to each other.
 */

import {
  EXCHANGE_RATE_MVR_PER_USD,
  convertMvrCentsToUsdCents,
  convertUsdCentsToMvrCents,
} from "@/lib/money";

export type CommissionMode = "fixed" | "percent";

/** Above 100% the partner cut exceeds the sale, which is never intended. */
export const MAX_COMMISSION_PERCENT = 100;

export function commissionMode(value: unknown): CommissionMode {
  return String(value || "") === "percent" ? "percent" : "fixed";
}

/** Coerce anything form-shaped into a sane percent, or null when unset. */
export function parseCommissionPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n * 100) / 100, MAX_COMMISSION_PERCENT);
}

export function isCurrencyCode(value: unknown): value is "USD" | "MVR" {
  return value === "USD" || value === "MVR";
}

/** Convert between the two ledger currencies at the project's fixed rate. */
export function convertToBasisCurrency(
  cents: number,
  from: string | null | undefined,
  to: string | null | undefined
): number {
  const amount = Math.round(Number(cents) || 0);
  const fromCur = isCurrencyCode(from) ? from : "USD";
  const toCur = isCurrencyCode(to) ? to : "USD";
  if (fromCur === toCur) return amount;
  return fromCur === "MVR"
    ? convertMvrCentsToUsdCents(amount, EXCHANGE_RATE_MVR_PER_USD)
    : convertUsdCentsToMvrCents(amount, EXCHANGE_RATE_MVR_PER_USD);
}

export interface CommissionInput {
  /** "fixed" (default) or "percent". */
  mode?: string | null;
  /** Percent of the booking total, e.g. 10 for 10%. */
  percent?: number | string | null;
  /**
   * Fixed amount in minor units. For an ACTIVITY this is per guest (the
   * long-standing 054 behaviour) and gets multiplied by pax; for a BOOKING it is
   * the whole-booking amount, so pass pax: 1.
   */
  fixedCents: number;
  /** Currency the fixed amount was quoted in. Defaults to the basis currency. */
  fixedCurrency?: string | null;
  /** What a percentage is taken of — normally the booking total. */
  basisCents: number;
  /** Guests, for a per-guest fixed rule. */
  pax?: number;
  /** The booking's own currency; everything is returned in this currency. */
  basisCurrency?: string | null;
}

export interface CommissionResult {
  /** Resolved commission, always in the booking/basis currency. */
  commissionCents: number;
  /** Operator's take: basis minus commission, floored at zero. */
  netCents: number;
  mode: CommissionMode;
  /** Rate to store alongside the amount, so the % survives a total change. */
  percent: number | null;
  /** Currency of commissionCents — always the basis currency. */
  currency: "USD" | "MVR";
  /** How the number was arrived at, for the form hint and the report footer. */
  basis: "percent" | "fixed_per_guest" | "fixed_total" | "none";
}

/**
 * Resolve a commission rule to a number.
 *
 * A percentage wins when a rate is present, because a rule stored as "10%" with
 * no percentage would otherwise silently mean "no commission". A missing or
 * unparseable percent falls back to the fixed amount so a half-filled form is
 * never worse than no form at all.
 */
export function resolveCommission(input: CommissionInput): CommissionResult {
  const basisCurrency: "USD" | "MVR" = isCurrencyCode(input.basisCurrency) ? input.basisCurrency : "USD";
  const basisCents = Math.max(Math.round(Number(input.basisCents) || 0), 0);
  const pax = Math.max(Math.round(Number(input.pax ?? 1) || 0), 1);
  const mode = commissionMode(input.mode);
  const percent = parseCommissionPercent(input.percent);

  if (mode === "percent" && percent !== null && percent > 0 && basisCents > 0) {
    const commissionCents = Math.round((basisCents * percent) / 100);
    return {
      commissionCents,
      netCents: Math.max(basisCents - commissionCents, 0),
      mode,
      percent,
      currency: basisCurrency,
      basis: "percent",
    };
  }

  const fixedCurrency = isCurrencyCode(input.fixedCurrency) ? input.fixedCurrency : basisCurrency;
  const perGuest = Math.max(Math.round(Number(input.fixedCents) || 0), 0);
  const totalFixed = perGuest * pax;
  const commissionCents = convertToBasisCurrency(totalFixed, fixedCurrency, basisCurrency);
  return {
    commissionCents,
    netCents: Math.max(basisCents - commissionCents, 0),
    mode,
    // A stale percent must not survive switching back to fixed.
    percent: null,
    currency: basisCurrency,
    basis: perGuest > 0 ? "fixed_per_guest" : "none",
  };
}

/** Human summary of a resolved rule, e.g. "10% of $220.00". */
export function describeCommissionBasis(result: CommissionResult): string {
  switch (result.basis) {
    case "percent":
      return `${result.percent}%`;
    case "fixed_per_guest":
      return "fixed amount";
    default:
      return "no commission";
  }
}

/**
 * Whether a stored net should be recomputed as basis − commission.
 *
 * 056 leaves net equal to the booking total whenever an activity has no partner
 * split, so "net == basis" is exactly the signature of a net that was never
 * deliberately set. Only that case may be rewritten by a backfill — a net an
 * operator typed by hand is never overwritten.
 */
export function netWasUnset(netCents: number | null | undefined, basisCents: number): boolean {
  const net = Math.round(Number(netCents ?? 0) || 0);
  const basis = Math.max(Math.round(Number(basisCents) || 0), 0);
  return basis > 0 && net === basis;
}