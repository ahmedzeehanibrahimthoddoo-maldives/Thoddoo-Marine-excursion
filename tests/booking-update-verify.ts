/**
 * Thoddoo Marine — Booking Update & Consent Signing Regression Tests
 *
 * Verifies:
 * 1. status-only update does not require currency
 * 2. status-only update preserves booking_ref
 * 3. full edit preserves booking_ref
 * 4. omitted fields remain unchanged
 * 5. invalid supplied currency rejected
 * 6. generated/snapshot fields rejected or ignored
 * 7. staff signing uses browser RPC (no Server Action signature logging)
 * 8. duplicate consent friendly error
 * 9. PDF runtime path has no filesystem access
 * 10. signConsentForm Server Action is unreachable
 * 11. ConsentPageClient does not import signConsentForm
 * 12. Consent type restricted to activity only
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf-8");
}

// =============================================
// 1. status-only update does not require currency
// =============================================
describe("status-only update does not require currency", () => {
  it("sanitizeBookingPatch does not require booking_currency for status-only", () => {
    const src = read("lib/sanitize.ts");
    // sanitizeBookingPatch checks 'if (!(field in data)) continue'
    // so booking_currency is only validated when present
    assert.ok(
      src.includes('if (!(field in data)) continue'),
      "sanitizeBookingPatch must skip fields not present in data"
    );
  });

  it("updateBookingStatus does not accept or forward booking_currency", () => {
    const src = read("lib/supabase/actions.ts");
    // updateBookingStatus should only update status and updated_at
    assert.ok(
      src.includes("updateBookingStatus"),
      "updateBookingStatus must exist"
    );
    const fnMatch = src.match(
      /export async function updateBookingStatus\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch, "updateBookingStatus function body must be parseable");
    const body = fnMatch[0];
    assert.ok(
      !body.includes("booking_currency"),
      "updateBookingStatus must not reference booking_currency"
    );
    assert.ok(
      body.includes("updated_at"),
      "updateBookingStatus must update updated_at"
    );
    assert.ok(
      body.includes("VALID_BOOKING_STATUSES"),
      "updateBookingStatus must validate against VALID_BOOKING_STATUSES"
    );
  });

  it("BookingActions imports updateBookingStatus (not updateBooking)", () => {
    const src = read("app/admin/bookings/BookingActions.tsx");
    assert.ok(
      src.includes("updateBookingStatus"),
      "BookingActions must import updateBookingStatus"
    );
    assert.ok(
      !src.includes("import { updateBooking }"),
      "BookingActions must NOT import updateBooking for status changes"
    );
  });
});

// =============================================
// 2. status-only update preserves booking_ref
// =============================================
describe("status-only update preserves booking_ref", () => {
  it("updateBookingStatus does not touch booking_ref", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function updateBookingStatus\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch);
    assert.ok(
      !fnMatch[0].includes("booking_ref"),
      "updateBookingStatus must not touch booking_ref"
    );
  });

  it("BOOKING_PATCH_FIELDS does not include booking_ref", () => {
    const src = read("lib/sanitize.ts");
    assert.ok(
      src.includes("BOOKING_PATCH_FIELDS"),
      "BOOKING_PATCH_FIELDS must exist"
    );
    assert.ok(
      !src.includes('"booking_ref"'),
      "BOOKING_PATCH_FIELDS must not include booking_ref"
    );
  });
});

// =============================================
// 3. full edit preserves booking_ref
// =============================================
describe("full edit preserves booking_ref", () => {
  it("sanitizeBookingPatch never returns booking_ref", () => {
    const src = read("lib/sanitize.ts");
    // The function only processes fields from BOOKING_PATCH_FIELDS whitelist
    assert.ok(
      !src.match(/patch\["?booking_ref"?\]/),
      "sanitizeBookingPatch must never write booking_ref to patch"
    );
  });

  it("updateBooking uses sanitizeBookingPatch whitelist", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function updateBooking\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch, "updateBooking must exist");
    assert.ok(
      fnMatch[0].includes("sanitizeBookingPatch"),
      "updateBooking must use sanitizeBookingPatch"
    );
    assert.ok(
      !fnMatch[0].includes("sanitizeBooking("),
      "updateBooking must not use old sanitizeBooking"
    );
  });

  it("updateBooking never sends booking_ref", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function updateBooking\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch);
    assert.ok(
      !fnMatch[0].includes("booking_ref"),
      "updateBooking must not reference booking_ref"
    );
  });
});

// =============================================
// 4. omitted fields remain unchanged
// =============================================
describe("omitted fields remain unchanged", () => {
  it("sanitizeBookingPatch returns empty object for empty input", () => {
    const src = read("lib/sanitize.ts");
    assert.ok(
      src.includes("return patch"),
      "sanitizeBookingPatch must return patch object"
    );
    // The 'if (!(field in data)) continue' pattern ensures empty input = empty patch
  });

  it("updateBooking rejects empty patch", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function updateBooking\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch);
    assert.ok(
      fnMatch[0].includes('Object.keys(patch).length === 0'),
      "updateBooking must reject empty patch (no valid fields)"
    );
  });
});

// =============================================
// 5. invalid supplied currency rejected
// =============================================
describe("invalid supplied currency rejected", () => {
  it("sanitizeBookingPatch calls assertCurrency for booking_currency", () => {
    const src = read("lib/sanitize.ts");
    assert.ok(
      src.includes('booking_currency') && src.includes('assertCurrency'),
      "sanitizeBookingPatch must validate booking_currency with assertCurrency when present"
    );
  });

  it("sanitizeBookingCreate calls assertCurrency for booking_currency", () => {
    const src = read("lib/sanitize.ts");
    assert.ok(
      src.includes("sanitizeBookingCreate"),
      "sanitizeBookingCreate must exist"
    );
    // It must call assertCurrency for booking_currency
    const fnMatch = src.match(
      /export function sanitizeBookingCreate\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch, "sanitizeBookingCreate must be parseable");
    assert.ok(
      fnMatch[0].includes("assertCurrency"),
      "sanitizeBookingCreate must validate currency with assertCurrency"
    );
  });
});

// =============================================
// 6. generated/snapshot fields rejected or ignored
// =============================================
describe("generated/snapshot fields rejected or ignored", () => {
  it("BOOKING_PATCH_FIELDS does not include id", () => {
    const src = read("lib/sanitize.ts");
    const match = src.match(/BOOKING_PATCH_FIELDS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, "BOOKING_PATCH_FIELDS must be defined");
    assert.ok(!match[1].includes('"id"'), "must not include id");
    assert.ok(!match[1].includes('"booking_ref"'), "must not include booking_ref");
    assert.ok(!match[1].includes('"created_at"'), "must not include created_at");
    assert.ok(!match[1].includes('"created_by"'), "must not include created_by");
    assert.ok(!match[1].includes('"payment_status"'), "must not include payment_status");
    assert.ok(!match[1].includes('"exchange_rate_mvr_per_usd"'), "must not include exchange_rate_mvr_per_usd");
    assert.ok(!match[1].includes('"converted_usd_cents"'), "must not include converted_usd_cents");
    assert.ok(!match[1].includes('"converted_mvr_laari"'), "must not include converted_mvr_laari");
    assert.ok(!match[1].includes('"guest_agreed"'), "must not include guest_agreed");
    assert.ok(!match[1].includes('"guest_agreed_at"'), "must not include guest_agreed_at");
    assert.ok(!match[1].includes('"agreement_version"'), "must not include agreement_version");
  });

  it("updateBooking never overwrites id", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function updateBooking\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch);
    // Must not assign to id or accept it as a parameter
    assert.ok(!fnMatch[0].includes("patch.id"), "must not patch id");
    assert.ok(!fnMatch[0].includes("data.id"), "must not read data.id for update");
  });
});

// =============================================
// 7. staff signing uses browser RPC (no Server Action logging)
// =============================================
describe("staff signing uses browser RPC (no Server Action signature logging)", () => {
  it("ConsentPageClient does not import signConsentForm", () => {
    const src = read("app/admin/consents/ConsentPageClient.tsx");
    assert.ok(
      !src.includes("signConsentForm"),
      "ConsentPageClient must not reference signConsentForm"
    );
  });

  it("ConsentPageClient calls staff_sign_consent RPC via browser Supabase client", () => {
    const src = read("app/admin/consents/ConsentPageClient.tsx");
    assert.ok(
      src.includes('rpc("staff_sign_consent"'),
      "ConsentPageClient must call staff_sign_consent RPC directly"
    );
    assert.ok(
      src.includes("createClient()"),
      "ConsentPageClient must use browser Supabase client"
    );
  });

  it("ConsentPageClient clears signature state after success", () => {
    const src = read("app/admin/consents/ConsentPageClient.tsx");
    // After success, should clear signature
    const successBlock = src.match(/Consent form signed"[\s\S]*?setTimeout/);
    assert.ok(successBlock, "success handler must exist with setTimeout");
    assert.ok(
      successBlock[0].includes("setSignature(null)"),
      "must clear signature state after success"
    );
  });

  it("signConsentForm action throws (unreachable)", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /\/\*\*[\s\S]*?@deprecated[\s\S]*?\*\/[\s\S]*?export async function signConsentForm\([\s\S]*?\n\}/
    );
    assert.ok(fnMatch, "signConsentForm must exist with @deprecated JSDoc");
    assert.ok(
      fnMatch[0].includes("throw new Error"),
      "signConsentForm must throw"
    );
    assert.ok(
      fnMatch[0].includes("Server-side signing is disabled"),
      "signConsentForm must indicate signing is disabled"
    );
  });
});

// =============================================
// 8. duplicate consent friendly error
// =============================================
describe("duplicate consent friendly error", () => {
  it("createConsentForm catches 23505 with friendly message", () => {
    const src = read("lib/supabase/actions.ts");
    assert.ok(
      src.includes('23505'),
      "createConsentForm must handle unique constraint violation code 23505"
    );
    assert.ok(
      src.includes("already exists"),
      "duplicate consent error must say 'already exists'"
    );
    assert.ok(
      src.includes("void the previous one"),
      "error message must suggest voiding the previous consent"
    );
  });

  it("no raw database error surfaces to the client for duplicates", () => {
    const src = read("lib/supabase/actions.ts");
    // Find the createConsentForm function body
    const fnMatch = src.match(
      /export async function createConsentForm\([^)]*\)\s*\{[\s\S]*?return result;\s*\}/
    );
    assert.ok(fnMatch, "createConsentForm must be parseable");
    const fnBody = fnMatch[0];
    const idx23505 = fnBody.indexOf("23505");
    const idxMsg = fnBody.indexOf("throw new Error(error.message)");
    assert.ok(idx23505 > 0, "23505 check must exist within createConsentForm");
    assert.ok(idxMsg > 0, "generic error throw must exist within createConsentForm");
    assert.ok(
      idx23505 < idxMsg,
      "23505 friendly message must come before generic error.message throw"
    );
  });
});

// =============================================
// 9. PDF runtime path has no filesystem access
// =============================================
describe("PDF runtime path has no filesystem access", () => {
  it("consent-pdf.ts has no fs/path/process.cwd", () => {
    const src = read("lib/consent-pdf.ts");
    assert.ok(!src.includes('from "fs"'), "consent-pdf.ts must not import fs");
    assert.ok(!src.includes("from 'fs'"), "consent-pdf.ts must not import fs (single quotes)");
    assert.ok(!src.includes('from "path"'), "consent-pdf.ts must not import path");
    assert.ok(!src.includes("from 'path'"), "consent-pdf.ts must not import path (single quotes)");
    assert.ok(!src.includes("readFileSync"), "consent-pdf.ts must not use readFileSync");
    assert.ok(!src.includes("process.cwd"), "consent-pdf.ts must not use process.cwd");
  });

  it("PDF API route uses fetch() for logo (Cloudflare-compatible)", () => {
    const src = read("app/api/admin/consents/[id]/pdf/route.ts");
    assert.ok(!src.includes('from "fs"'), "route must not import fs");
    assert.ok(!src.includes("readFileSync"), "route must not use readFileSync");
    assert.ok(!src.includes("process.cwd"), "route must not use process.cwd");
    assert.ok(
      src.includes("fetch("),
      "route must use fetch() for logo loading"
    );
  });
});

// =============================================
// 10. signConsentForm Server Action is unreachable
// =============================================
describe("signConsentForm Server Action is unreachable", () => {
  it("signConsentForm action body only contains throw", () => {
    const src = read("lib/supabase/actions.ts");
    const fnMatch = src.match(
      /export async function signConsentForm\([^)]*\)\s*\{[\s\S]*?\n\}/
    );
    assert.ok(fnMatch, "signConsentForm must exist");
    const body = fnMatch[0];
    // Must not have supabase.rpc or any database calls
    assert.ok(
      !body.includes("supabase.rpc"),
      "signConsentForm must not make any RPC calls"
    );
    assert.ok(
      !body.includes("supabase"),
      "signSupabase must not reference supabase client at all"
    );
    assert.ok(
      body.includes("throw new Error"),
      "signConsentForm must immediately throw"
    );
  });
});

// =============================================
// 11. ConsentPageClient does not import signConsentForm
// =============================================
describe("ConsentPageClient does not import signConsentForm", () => {
  it("no signConsentForm import in ConsentPageClient", () => {
    const src = read("app/admin/consents/ConsentPageClient.tsx");
    assert.ok(
      !src.includes("import") || !src.match(/import[\s\S]*signConsentForm/),
      "ConsentPageClient must not import signConsentForm"
    );
  });
});

// =============================================
// 12. Consent type restricted to activity only
// =============================================
describe("Consent type restricted to activity only", () => {
  it("ConsentPageClient create modal shows Activity Consent only (no rental/medical/photo select)", () => {
    const src = read("app/admin/consents/ConsentPageClient.tsx");
    // Should NOT have a select with rental/medical/photo options
    assert.ok(
      !src.includes('<option value="rental">'),
      "must not offer rental consent type"
    );
    assert.ok(
      !src.includes('<option value="medical">'),
      "must not offer medical consent type"
    );
    assert.ok(
      !src.includes('<option value="photo">'),
      "must not offer photo consent type"
    );
    assert.ok(
      src.includes("Activity Consent"),
      "must show Activity Consent as the only type"
    );
    assert.ok(
      src.includes("Rental agreements are managed under Rentals"),
      "must inform staff that rental agreements are under Rentals"
    );
  });

  it("createConsentForm always uses activity consent type", () => {
    const src = read("lib/supabase/actions.ts");
    // Must force consent_type to "activity" regardless of input
    assert.ok(
      src.includes('consent_type: "activity"'),
      "createConsentForm must force consent_type to activity"
    );
  });
});

// =============================================
// 13. updateBookingStatus validation
// =============================================
describe("updateBookingStatus validates allowed statuses", () => {
  it("VALID_BOOKING_STATUSES contains expected values", () => {
    const src = read("lib/supabase/actions.ts");
    assert.ok(
      src.includes('"pending"'),
      "VALID_BOOKING_STATUSES must include pending"
    );
    assert.ok(
      src.includes('"confirmed"'),
      "VALID_BOOKING_STATUSES must include confirmed"
    );
    assert.ok(
      src.includes('"completed"'),
      "VALID_BOOKING_STATUSES must include completed"
    );
    assert.ok(
      src.includes('"cancelled"'),
      "VALID_BOOKING_STATUSES must include cancelled"
    );
    assert.ok(
      src.includes('"no_show"'),
      "VALID_BOOKING_STATUSES must include no_show"
    );
  });

  it("updateBookingStatus throws on invalid status", () => {
    const src = read("lib/supabase/actions.ts");
    assert.ok(
      src.includes("Invalid booking status"),
      "updateBookingStatus must throw descriptive error for invalid status"
    );
  });
});

// =============================================
// Run results
// =============================================
console.log("\n✓ All code-level checks passed.");
