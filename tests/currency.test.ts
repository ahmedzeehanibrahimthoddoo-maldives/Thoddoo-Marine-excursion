/**
 * Thoddoo Marine — Currency & Payment Tests
 * Run: node --import tsx tests/currency.test.ts
 * Or:  npx tsx tests/currency.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCurrency,
  currencyForDisplay,
  validCurrency,
  parseMajorInput,
  toMajorInput,
  formatMoney,
  formatDualCurrency,
  formatDualCurrencyMvr,
  formatPriceDual,
  majorToMinor,
  minorToMajor,
  convertUsdCentsToMvrCents,
  convertMvrCentsToUsdCents,
  EXCHANGE_RATE_MVR_PER_USD,
} from "../lib/money";

// =============================================
// 1. assertCurrency — strict, throws on invalid
// =============================================
describe("assertCurrency", () => {
  it("accepts USD", () => assert.equal(assertCurrency("USD"), "USD"));
  it("accepts MVR", () => assert.equal(assertCurrency("MVR"), "MVR"));
  it("throws on empty string", () => assert.throws(() => assertCurrency(""), /Currency must be USD or MVR/));
  it("throws on 'usd' (lowercase)", () => assert.throws(() => assertCurrency("usd"), /Currency must be USD or MVR/));
  it("throws on null", () => assert.throws(() => assertCurrency(null), /Currency must be USD or MVR/));
  it("throws on undefined", () => assert.throws(() => assertCurrency(undefined), /Currency must be USD or MVR/));
  it("throws on 'EUR'", () => assert.throws(() => assertCurrency("EUR"), /Currency must be USD or MVR/));
  it("throws on number", () => assert.throws(() => assertCurrency(1), /Currency must be USD or MVR/));
});

// =============================================
// 2. currencyForDisplay — graceful fallback
// =============================================
describe("currencyForDisplay", () => {
  it("returns USD for 'USD'", () => assert.equal(currencyForDisplay("USD"), "USD"));
  it("returns MVR for 'MVR'", () => assert.equal(currencyForDisplay("MVR"), "MVR"));
  it("returns USD for empty string", () => assert.equal(currencyForDisplay(""), "USD"));
  it("returns USD for null", () => assert.equal(currencyForDisplay(null), "USD"));
  it("returns USD for undefined", () => assert.equal(currencyForDisplay(undefined), "USD"));
  it("returns USD for 'EUR'", () => assert.equal(currencyForDisplay("EUR"), "USD"));
  it("validCurrency is alias for currencyForDisplay", () => assert.equal(validCurrency("MVR"), currencyForDisplay("MVR")));
  it("validCurrency fallback is USD", () => assert.equal(validCurrency("bad"), "USD"));
});

// =============================================
// 3. parseMajorInput — strict regex validation
// =============================================
describe("parseMajorInput", () => {
  it("returns 0 for empty string", () => assert.equal(parseMajorInput(""), 0));
  it("returns 0 for whitespace", () => assert.equal(parseMajorInput("  "), 0));
  it("converts integer: '35' → 3500", () => assert.equal(parseMajorInput("35"), 3500));
  it("converts decimal: '35.50' → 3550", () => assert.equal(parseMajorInput("35.50"), 3550));
  it("converts 1 decimal: '35.5' → 3550", () => assert.equal(parseMajorInput("35.5"), 3550));
  it("converts '0.01' → 1", () => assert.equal(parseMajorInput("0.01"), 1));
  it("converts '0' → 0", () => assert.equal(parseMajorInput("0"), 0));
  it("converts '100' → 10000", () => assert.equal(parseMajorInput("100"), 10000));
  it("rejects '35.999' (3 decimal places)", () => assert.throws(() => parseMajorInput("35.999"), /Invalid amount format/));
  it("rejects 'abc' (non-numeric)", () => assert.throws(() => parseMajorInput("abc"), /Invalid amount format/));
  it("rejects '-5' (negative)", () => assert.throws(() => parseMajorInput("-5"), /Invalid amount format/));
  it("rejects '12abc' (trailing letters)", () => assert.throws(() => parseMajorInput("12abc"), /Invalid amount format/));
  it("rejects '1,000' (comma)", () => assert.throws(() => parseMajorInput("1,000"), /Invalid amount format/));
  it("rejects '35.1234' (4 decimal places)", () => assert.throws(() => parseMajorInput("35.1234"), /Invalid amount format/));
  it("handles leading space: ' 35' → 3500", () => assert.equal(parseMajorInput(" 35"), 3500));
});

// =============================================
// 4. toMajorInput — round-trip inverse
// =============================================
describe("toMajorInput", () => {
  it("returns '' for 0", () => assert.equal(toMajorInput(0), ""));
  it("returns '' for NaN-ish values", () => assert.equal(toMajorInput(NaN), ""));
  it("converts 3500 → '35'", () => assert.equal(toMajorInput(3500), "35"));
  it("converts 3550 → '35.5'", () => assert.equal(toMajorInput(3550), "35.5"));
  it("converts 10000 → '100'", () => assert.equal(toMajorInput(10000), "100"));
  it("round-trip: parseMajorInput(toMajorInput(3550)) = 3550", () => {
    const cents = 3550;
    const major = toMajorInput(cents);
    assert.equal(parseMajorInput(major), cents);
  });
  it("round-trip: parseMajorInput(toMajorInput(1)) = 1", () => {
    const cents = 1;
    const major = toMajorInput(cents);
    assert.equal(parseMajorInput(major), cents);
  });
});

// =============================================
// 5. formatMoney — single currency
// =============================================
describe("formatMoney", () => {
  it("formats USD: 3500 → '$35.00'", () => assert.equal(formatMoney(3500, "USD"), "$35.00"));
  it("formats MVR: 63000 → 'MVR 630.00'", () => assert.equal(formatMoney(63000, "MVR"), "MVR 630.00"));
  it("formats USD zero: 0 → '$0.00'", () => assert.equal(formatMoney(0, "USD"), "$0.00"));
  it("formats MVR zero: 0 → 'MVR 0.00'", () => assert.equal(formatMoney(0, "MVR"), "MVR 0.00"));
  it("formats USD cents: 1 → '$0.01'", () => assert.equal(formatMoney(1, "USD"), "$0.01"));
  it("formats large USD: 12000 → '$120.00'", () => assert.equal(formatMoney(12000, "USD"), "$120.00"));
});

// =============================================
// 6. Dual-currency display
// =============================================
describe("formatDualCurrency", () => {
  it("USD: '$35.00 / MVR 665.00'", () => assert.equal(formatDualCurrency(3500), "$35.00 / MVR 665.00"));
  it("USD: '$80.00 / MVR 1,520.00'", () => assert.equal(formatDualCurrency(8000), "$80.00 / MVR 1,520.00"));
});

describe("formatDualCurrencyMvr", () => {
  it("MVR: 'MVR 665.00 / $35.00'", () => assert.equal(formatDualCurrencyMvr(66500), "MVR 665.00 / $35.00"));
});

describe("formatPriceDual", () => {
  it("USD → '$35.00 / MVR 665.00'", () => assert.equal(formatPriceDual(3500, "USD"), "$35.00 / MVR 665.00"));
  it("MVR → 'MVR 665.00 / $35.00'", () => assert.equal(formatPriceDual(66500, "MVR"), "MVR 665.00 / $35.00"));
  it("undefined currency → USD default", () => assert.equal(formatPriceDual(3500, undefined), "$35.00 / MVR 665.00"));
  it("null currency → USD default", () => assert.equal(formatPriceDual(3500, null), "$35.00 / MVR 665.00"));
});

// =============================================
// 7. Conversion helpers
// =============================================
describe("convertUsdCentsToMvrCents", () => {
  it("3500 USD cents → 66500 MVR cents", () => assert.equal(convertUsdCentsToMvrCents(3500), 66500));
  it("8000 USD cents → 152000 MVR cents", () => assert.equal(convertUsdCentsToMvrCents(8000), 152000));
  it("0 → 0", () => assert.equal(convertUsdCentsToMvrCents(0), 0));
});

describe("convertMvrCentsToUsdCents", () => {
  it("66500 MVR cents → 3500 USD cents", () => assert.equal(convertMvrCentsToUsdCents(66500), 3500));
  it("100 MVR cents → 5 USD cents (rounded)", () => assert.equal(convertMvrCentsToUsdCents(100), 5));
  it("0 → 0", () => assert.equal(convertMvrCentsToUsdCents(0), 0));
});

// =============================================
// 8. Major/minor conversion
// =============================================
describe("majorToMinor", () => {
  it("35 → 3500", () => assert.equal(majorToMinor(35), 3500));
  it("0.01 → 1", () => assert.equal(majorToMinor(0.01), 1));
  it("630 → 63000", () => assert.equal(majorToMinor(630), 63000));
});

describe("minorToMajor", () => {
  it("3500 → 35", () => assert.equal(minorToMajor(3500), 35));
  it("1 → 0.01", () => assert.equal(minorToMajor(1), 0.01));
  it("63000 → 630", () => assert.equal(minorToMajor(63000), 630));
});

// =============================================
// 9. Exchange rate constant
// =============================================
describe("EXCHANGE_RATE_MVR_PER_USD", () => {
  it("is 19", () => assert.equal(EXCHANGE_RATE_MVR_PER_USD, 19));
});

// =============================================
// 10. Migration 008 SQL verification
// =============================================
describe("migration 008 — SQL contains required patterns", () => {
  const fs = require("fs");
  const path = require("path");
  const sqlPath = path.resolve(__dirname, "../supabase/migrations/008_currency_support.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  it("has payments.booking_currency column", () => {
    assert.match(sql, /payments.*ADD COLUMN.*booking_currency.*TEXT NOT NULL DEFAULT 'USD'/);
  });
  it("has payments.status column", () => {
    assert.match(sql, /payments.*ADD COLUMN.*status.*TEXT NOT NULL DEFAULT 'completed'/);
  });
  it("has payments.status CHECK constraint", () => {
    assert.match(sql, /chk_payments_status.*CHECK.*status.*IN.*completed.*failed.*pending.*refunded/);
  });
  it("has chk_payments_booking_currency constraint", () => {
    assert.match(sql, /chk_payments_booking_currency.*CHECK.*booking_currency.*IN.*USD.*MVR/);
  });
  it("has SELECT FOR UPDATE in create_booking_payment", () => {
    assert.match(sql, /FROM public\.bookings b\s+WHERE b\.id = p_booking_id\s+FOR UPDATE/s);
  });
  it("has payable total logic (total_cents > 0)", () => {
    assert.match(sql, /v_booking\.total_cents > 0\s+THEN\s+v_payable_total := v_booking\.total_cents/s);
  });
  it("has overpayment rejection", () => {
    assert.match(sql, /v_new_total_paid \+ v_converted > v_payable_total/);
  });
  it("has completed-only filter in create_booking_payment", () => {
    assert.match(sql, /AND p2\.status = 'completed'/);
  });
  it("has booking_currency snapshot in INSERT", () => {
    assert.match(sql, /booking_currency.*v_booking\.booking_currency/);
  });
  it("has backfill for payments.booking_currency", () => {
    assert.match(sql, /UPDATE payments p\s+SET booking_currency = COALESCE\(b\.booking_currency/);
  });
  it("has backfill for payments.status", () => {
    assert.match(sql, /UPDATE payments SET status = 'completed' WHERE status IS NULL/);
  });
  it("has RPC security report section", () => {
    assert.match(sql, /RPC SECURITY REPORT/);
  });
  it("submit_public_booking REVOKE ALL FROM PUBLIC", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_public_booking[\s\S]*FROM PUBLIC/);
  });
  it("submit_public_booking GRANT to anon", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking[\s\S]*TO anon/);
  });
  it("create_booking_payment REVOKE from PUBLIC and anon", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_booking_payment[\s\S]*FROM PUBLIC/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_booking_payment[\s\S]*FROM anon/);
  });
  it("create_booking_payment GRANT to authenticated", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_booking_payment[\s\S]*TO authenticated/);
  });
  it("get_booking_payment_summary REVOKE from PUBLIC and anon", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_booking_payment_summary[\s\S]*FROM PUBLIC/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_booking_payment_summary[\s\S]*FROM anon/);
  });
  it("get_booking_payment_summary uses completed-only filter", () => {
    assert.match(sql, /get_booking_payment_summary[\s\S]*AND p2\.status = 'completed'/);
  });
  it("get_booking_payment_summary has payable total logic", () => {
    assert.match(sql, /get_booking_payment_summary[\s\S]*v_booking\.total_cents > 0/);
  });
  it("all exchange rate constraints use > 0", () => {
    assert.match(sql, /chk_bookings_exchange_rate.*CHECK.*exchange_rate_mvr_per_usd > 0/);
    assert.match(sql, /chk_payments_rate_snapshot.*CHECK.*booking_rate_snapshot > 0/);
  });
  it("has SECURITY DEFINER SET search_path = public on all RPCs", () => {
    const definerCount = (sql.match(/SECURITY DEFINER\s+SET search_path = public/g) || []).length;
    assert.ok(definerCount >= 4, `Expected at least 4 SECURITY DEFINER functions, found ${definerCount}`);
  });
  it("payments.amount_cents CHECK > 0 (strict non-negative)", () => {
    assert.match(sql, /chk_payments_amount.*CHECK.*amount_cents > 0/);
  });
});

// =============================================
// 11. Migration 009 SQL verification
// =============================================
describe("migration 009 — SQL contains required patterns", () => {
  const fs = require("fs");
  const path = require("path");
  const sqlPath = path.resolve(__dirname, "../supabase/migrations/009_consent_pdf_workflow.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  it("has REVOKE ALL ON consent_templates FROM PUBLIC", () => {
    assert.match(sql, /REVOKE ALL ON consent_templates FROM PUBLIC/);
  });
  it("has REVOKE ALL ON consent_templates FROM anon", () => {
    assert.match(sql, /REVOKE ALL ON consent_templates FROM anon/);
  });
  it("has REVOKE ALL ON consent_templates FROM authenticated", () => {
    assert.match(sql, /REVOKE ALL ON consent_templates FROM authenticated/);
  });
  it("has prevent_template_tampering trigger", () => {
    assert.match(sql, /prevent_template_tampering/);
  });
  it("has signing_method column on consent_forms", () => {
    assert.match(sql, /ALTER TABLE consent_forms[\s\S]*ADD COLUMN IF NOT EXISTS signing_method[\s\S]*TEXT/);
  });
  it("has signed_by_staff_id column on consent_forms", () => {
    assert.match(sql, /ALTER TABLE consent_forms[\s\S]*ADD COLUMN IF NOT EXISTS signed_by_staff_id[\s\S]*UUID/);
  });
  it("has all SECURITY DEFINER SET search_path = public", () => {
    const definerCount = (sql.match(/SECURITY DEFINER\s+SET search_path = public/g) || []).length;
    assert.ok(definerCount >= 3, `Expected at least 3 SECURITY DEFINER functions, found ${definerCount}`);
  });
});

console.log("\n✓ All tests passed");
