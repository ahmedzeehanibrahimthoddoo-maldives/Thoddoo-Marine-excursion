import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GENERAL_SAFETY, CONSENT_LIABILITY_ACK, allBriefings, getBriefing,
} from "../lib/briefings";
import {
  grossCents, netCents, type RangeBooking, profitTotals, sumOtherIncomeByCurrency,
  paidRatio, collectedGrossCents, collectedNetCents, paidByBooking,
  paymentAmountInBookingCurrency, isCompletedPayment, cashInCents, cashInCurrency,
  invoiceBalanceCents,
} from "../lib/reports";
import { tripRevenueCents, type TripRow } from "../lib/operations";
import {
  cashRegisterTotals, cashRegisterOverShort, countTotal,
  reconcileCashAgainstPayments, isCashReconciled, salesPerCurrency, cashPerCurrency, ZERO_CURRENCY,
  type CashRegisterMethod,
} from "../lib/cashreg";
import {
  MALDIVES_UTC_OFFSET, OUTSTANDING_LIMIT, TOMORROW_LINES_PER_ACTIVITY,
  dayEndIso, dayStartIso, isDateStr, renderDayEndMail, sourceLabel, type DayEndReport,
} from "../lib/dayend-report";
import { EMAIL_RE, EMAIL_REQUIRED_MESSAGE, isValidEmail } from "../lib/email";
import {
  PRICING_UNITS,
  normalizePricingUnit,
  partyAdjustedCents,
  resolvePricingUnit,
  unitPriceTotalCents,
} from "../lib/pricing";
import { sanitizeBookingCreate, sanitizeBookingPatch } from "../lib/sanitize";
import { columnLetter, flattenRangeContent, sheetApiDomain } from "../lib/sheets";
import { assertWriteOk, idHeaderColumn, parseSheetRows } from "../lib/finance-sync";
import {
  MAX_COMMISSION_PERCENT,
  commissionMode,
  convertToBasisCurrency,
  describeCommissionBasis,
  netWasUnset,
  parseCommissionPercent,
  resolveCommission,
} from "../lib/commission";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_GRID_COLUMNS,
  daysInMonth,
  expenseEntryKey,
  gridCellExpense,
  monthDates,
  nextMonthStart,
  normalizeExpenseCategory,
  parseExpenseImport,
  parseImportDate,
  parseMajorAmount,
  buildZohoMonthlyGrid,
  ZOHO_GRID_HEADERS,
} from "../lib/expenses";

function readMigration(file: string): string {
  return fs.readFileSync(path.resolve(__dirname, `../supabase/migrations/${file}`), "utf-8");
}

describe("briefing cards — all activities covered", () => {
  const expectedSlugs = [
    "banana-ride", "dolphin-cruise", "funtube", "jet-ski", "kayak",
    "manta-nurse-shark-combo", "manta-ray-snorkeling", "nurse-shark-adventure",
    "private-boat-hire", "sandbank-trip", "stand-up-paddleboard",
    "sup-with-scooter", "turtle-reef-snorkeling", "wakeboarding", "water-skiing",
  ];

  it("provides a briefing for every live activity slug", () => {
    for (const slug of expectedSlugs) {
      assert.ok(getBriefing(slug), `missing briefing for ${slug}`);
    }
  });
  it("every briefing has safety rules, requirements and included items", () => {
    for (const b of allBriefings()) {
      assert.ok(b.safety.length >= 4, `${b.slug}: needs activity safety rules`);
      assert.ok(b.requirements.length > 0, `${b.slug}: needs guest requirements`);
      assert.ok(b.included.length > 0, `${b.slug}: needs provided items`);
      assert.ok(b.overview.length > 10, `${b.slug}: needs an overview`);
    }
  });
  it("every briefing is linked from the cards index", () => {
    const idx = fs.readFileSync(path.resolve(__dirname, "../app/admin/briefings/page.tsx"), "utf-8");
    assert.ok(idx.includes("allBriefings()"));
  });
  it("shares general safety and consent/liability acknowledgments", () => {
    assert.ok(GENERAL_SAFETY.length >= 8);
    assert.ok(CONSENT_LIABILITY_ACK.length >= 3);
    assert.match(CONSENT_LIABILITY_ACK.join(" "), /Consent & Liability/i);
  });
  it("has a printable letterheaded card page with signatures", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../app/admin/briefings/[slug]/page.tsx"), "utf-8");
    assert.ok(page.includes("Thoddoo Marine Excursion"));
    assert.ok(page.includes("SAFETY BRIEFING CARD"));
    assert.ok(page.includes("Signatures"));
    assert.ok(page.includes("irSignatures"));
    assert.ok(page.includes("consent"));
  });
});

describe("migration 080 — signed consent voidable only via booking cancellation", () => {
  const sql = readMigration("080_signed_consent_voidable_on_cancel.sql");

  it("cancelling a booking flags the void as coming from a cancellation", () => {
    assert.match(sql, /set_config\('app\.consent_void_from_cancel', '1', true\)/);
    // Transaction-local, so the permission cannot outlive the statement.
    assert.match(sql, /set_config\('app\.consent_void_from_cancel', '', true\)/);
  });

  it("a signed consent may only become voided, and only with that flag set", () => {
    assert.match(sql, /IF OLD\.status = 'signed' THEN/);
    assert.match(sql, /NEW\.status <> 'voided'/);
    assert.match(
      sql,
      /current_setting\('app\.consent_void_from_cancel', true\) IS DISTINCT FROM '1'/
    );
  });

  it("the signature, witness, snapshot and signing facts stay immutable", () => {
    for (const column of [
      "signature_data_url",
      "witness_signature_data_url",
      "parent_guardian_signature_data_url",
      "signed_at",
      "consent_text_snapshot",
      "form_version",
      "consent_version",
      "signing_method",
      "signed_by_staff_id",
    ]) {
      assert.match(sql, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`));
    }
    assert.match(sql, /Signed consent forms are immutable and cannot be modified\./);
  });

  it("still voids pending consents on cancel, as migration 062 intended", () => {
    assert.match(sql, /WHERE booking_id = NEW\.id\s+AND status IN \('pending', 'signed'\)/);
  });
});

describe("migration 037 — consent v3 (liability & damage)", () => {
  const sql = readMigration("037_consent_liability_damage_v3.sql");

  it("rotates to activity-consent-v3", () => {
    assert.match(sql, /activity-consent-v3/);
  });
  it("deactivates the prior active activity template", () => {
    assert.match(sql, /SET active = false[\s\S]*consent_type = 'activity'/);
  });
  it("appends equipment/vessel damage liability", () => {
    assert.match(sql, /EQUIPMENT, VESSEL & PROPERTY DAMAGE/);
    assert.match(sql, /dealership/);
  });
  it("appends jet-ski capsize / recovery terms", () => {
    assert.match(sql, /JET-SKI \/ PERSONAL WATERCRAFT/);
    assert.match(sql, /capsize/i);
  });
  it("appends accident / medical cost terms", () => {
    assert.match(sql, /ACCIDENTS, INJURY & MEDICAL COSTS/);
  });
  it("disables the tamper trigger around the rotation", () => {
    assert.match(sql, /DISABLE TRIGGER trg_prevent_template_tampering/);
    assert.match(sql, /ENABLE TRIGGER trg_prevent_template_tampering/);
  });
});

describe("migration 038 — reception departure / return", () => {
  const sql = readMigration("038_reception_departure_return.sql");

  it("adds departure/return columns to trip_manifest", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS departed_at/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS returned_at/);
    assert.match(sql, /departed_by UUID REFERENCES public\.staff_profiles/);
  });
  it("defines the three tracking RPCs", () => {
    assert.match(sql, /FUNCTION public\.set_manifest_departure\(/);
    assert.match(sql, /FUNCTION public\.set_manifest_return\(/);
    assert.match(sql, /FUNCTION public\.reset_manifest_tracking\(/);
  });
  it("grants the RPCs to authenticated only", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_manifest_departure[\s\S]*TO authenticated/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_manifest_return[\s\S]*FROM anon/);
  });
  it("advances trip status when safe", () => {
    assert.match(sql, /status = 'departed'/);
    assert.match(sql, /status = 'returned'/);
  });
});

describe("migration 039 — auto draft trip on confirmation", () => {
  const sql = readMigration("039_auto_trip_on_confirm.sql");

  it("defines core + role-gated wrapper", () => {
    assert.match(sql, /FUNCTION public\.ensure_trip_for_booking_core\(/);
    assert.match(sql, /FUNCTION public\.ensure_trip_for_booking\(/);
  });
  it("creates a planned draft trip when none matches", () => {
    assert.match(sql, /INSERT INTO public\.trips/);
    assert.match(sql, /'planned'/);
    assert.match(sql, /Auto-created on booking confirmation/);
  });
  it("attaches the booking and writes the manifest", () => {
    assert.match(sql, /INSERT INTO public\.trip_manifest/);
    assert.match(sql, /SET trip_id = v_trip_id/);
  });
  it("fires on transition to confirmed", () => {
    assert.match(sql, /AFTER UPDATE OF status ON public\.bookings/);
    assert.match(sql, /NEW\.status = 'confirmed'/);
  });
  it("never blocks the confirmation on failure", () => {
    assert.match(sql, /EXCEPTION WHEN OTHERS/);
  });
});

describe("migration 040 — grouped bookings", () => {
  const sql = readMigration("040_grouped_bookings.sql");

  it("creates booking_groups and links bookings", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.booking_groups/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public\.booking_groups/);
  });
  it("enables RLS with staff-only select", () => {
    assert.match(sql, /ALTER TABLE public\.booking_groups ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /CREATE POLICY booking_groups_staff_select/);
  });
  it("defines the anon group booking RPC", () => {
    assert.match(sql, /FUNCTION public\.submit_public_booking_group\(/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group[\s\S]*TO anon/);
  });
  it("creates one booking per item with a derived idempotency key", () => {
    assert.match(sql, /md5\(trim\(p_idempotency_key\) \|\| ':' \|\| v_idx\)::UUID/);
    assert.match(sql, /group_id/);
  });
});

describe("migration 042 — card processing fee", () => {
  const sql = readMigration("042_card_processing_fee.sql");

  it("adds card_fee to the booking_charges category whitelist", () => {
    assert.match(sql, /DROP CONSTRAINT IF EXISTS booking_charges_category_check/);
    assert.match(sql, /'equipment_damage', 'vessel_damage', 'jetski_capsize',\s*'fuel', 'late_return', 'accident', 'card_fee', 'other'/);
  });
  it("defines a single-source fee rate (4.5%)", () => {
    assert.match(sql, /FUNCTION public\.card_fee_rate_pct\(\)/);
    assert.match(sql, /SELECT 4\.5;/);
  });
  it("auto-adds the fee exactly once on card payments", () => {
    assert.match(sql, /p_method = 'card'/);
    assert.match(sql, /category = 'card_fee'/);
    assert.match(sql, /v_existing_fee = 0/);
    assert.match(sql, /ROUND\(v_base_total \* \(public\.card_fee_rate_pct\(\) \/ 100\.0\)\)/);
  });
  it("folds the fee into bookings.total_cents", () => {
    assert.match(sql, /SET total_cents = v_base_total \+ v_card_fee/);
    assert.match(sql, /ON CONFLICT DO NOTHING/);
  });
  it("keeps grants staff-only", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.card_fee_rate_pct\(\) FROM anon/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_booking_payment[\s\S]*FROM anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_booking_payment[\s\S]*TO authenticated/);
  });
});

describe("migration 043 — incident report extras", () => {
  const sql = readMigration("043_incident_reports_extras.sql");

  it("extends the existing incident_reports table (no parallel table)", () => {
    assert.match(sql, /ALTER TABLE public\.incident_reports/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS alarm_warning_seen  BOOLEAN NOT NULL DEFAULT false/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS photos              JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.doesNotMatch(sql, /CREATE TABLE.*incidents/i);
  });
  it("adds repair estimate and evidence columns", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS mechanical_damage   TEXT/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS evidence_notes      TEXT/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS repair_quote_cents  INT/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS repair_quote_currency TEXT NOT NULL DEFAULT 'USD'/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_incidents_booking/);
  });
  it("keeps resolved_at in sync with the resolved flag", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.sync_incident_resolved_at/);
    assert.match(sql, /CREATE TRIGGER trg_incidents_resolved_at/);
  });
});

describe("migration 044 — consent v4 (safety rules, kayak, jet-ski alarm)", () => {
  const sql = readMigration("044_consent_safety_rules_v4.sql");

  it("rotates to activity-consent-v4", () => {
    assert.match(sql, /activity-consent-v4/);
  });
  it("deactivates the prior active activity template", () => {
    assert.match(sql, /SET active = false[\s\S]*consent_type = 'activity'/);
  });
  it("appends the safety briefing & general safety rules section", () => {
    assert.match(sql, /SAFETY RULES & SAFETY BRIEFING/);
    assert.match(sql, /safety briefing covering the activity/);
  });
  it("appends kayak specific safety rules", () => {
    assert.match(sql, /KAYAK SPECIFIC SAFETY RULES/);
    assert.match(sql, /lost or damaged paddle/);
  });
  it("appends the jet-ski engine alarm rule (stop and notify)", () => {
    assert.match(sql, /JET-SKI ENGINE ALARM \/ OPERATIONAL FAULT RULE/);
    assert.match(sql, /STOP immediately/);
    assert.match(sql, /NOT continue riding/);
    assert.match(sql, /notify Thoddoo Marine staff at once/);
  });
  it("keeps the existing jet-ski capsize / recovery terms", () => {
    assert.match(sql, /capsize\/recovery fee[\s\S]*section 14/);
  });
  it("disables the tamper trigger around the rotation", () => {
    assert.match(sql, /DISABLE TRIGGER trg_prevent_template_tampering/);
    assert.match(sql, /ENABLE TRIGGER trg_prevent_template_tampering/);
  });
  it("adds a token-keyed public PDF RPC granted to anon", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_consent_pdf_by_token/);
    assert.match(sql, /WHERE signing_token = p_token/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_consent_pdf_by_token\(text\) TO anon/);
  });
});

describe("migration 048 — remove card fee fold", () => {
  const sql = readMigration("048_remove_card_fee_fold.sql");

  it("replaces create_booking_payment without card-fee logic", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_booking_payment/);
    assert.doesNotMatch(sql, /v_card_fee/);
    assert.doesNotMatch(sql, /category = 'card_fee'/);
  });
  it("keeps the quoted price as the payable total", () => {
    assert.match(sql, /Payable is the quoted price/);
    assert.match(sql, /v_payable_total := v_booking\.total_cents/);
  });
  it("still guards against overpayment", () => {
    assert.match(sql, /Overpayment:/);
  });
  it("returns card_fee_cents 0", () => {
    assert.match(sql, /'card_fee_cents', 0/);
  });
  it("grants the RPC to authenticated only", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_booking_payment\(UUID,INT,TEXT,TEXT,TEXT,TEXT\) TO authenticated/);
  });
});

describe("invoice PDF footer — bank accounts", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/invoice-pdf.ts"), "utf-8");
  it("shows both BML USD and MVR account numbers", () => {
    assert.match(src, /BML USD Account No: 7730000649500/);
    assert.match(src, /BML MVR Account No: 7730000649501/);
  });
});

describe("admin payment form — card fee stays guidance only", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../app/admin/payments/PaymentForm.tsx"), "utf-8");
  it("keys the fee-inclusive amount into the terminal but records the quoted amount", () => {
    assert.match(src, /into the card terminal/);
    assert.match(src, /record the quoted amount/);
    assert.match(src, /fee not shown on the guest invoice/);
  });
  it("sets the amount to the quoted remaining balance, not the fee-inclusive due", () => {
    assert.match(src, /setAmountCents\(toMajorInput\(remaining\)\)/);
  });
});

describe("migration 047 — consent v5 (fixed capsize fee + clockwise-only procedure)", () => {
  const sql = readMigration("047_consent_capsize_fee_v5.sql");

  it("rotates to activity-consent-v5", () => {
    assert.match(sql, /activity-consent-v5/);
  });
  it("deactivates the prior active activity template", () => {
    assert.match(sql, /SET active = false[\s\S]*consent_type = 'activity'/);
  });
  it("adds a fixed USD 50 capsize / recovery fee for jet ski and kayak", () => {
    assert.match(sql, /21\. FIXED CAPSIZE & RECOVERY FEE \(USD 50\)/);
    assert.match(sql, /USD 50 \(fifty United States dollars\)/);
    assert.match(sql, /jet ski and kayak/);
  });
  it("adds the clockwise-only jet ski capsize recovery procedure", () => {
    assert.match(sql, /22\. JET-SKI CAPSIZE RECOVERY PROCEDURE \(CLOCKWISE ONLY\)/);
    assert.match(sql, /CLOCKWISE/);
    assert.match(sql, /anti-clockwise/);
  });
  it("confirms wrong-side flips cause engine damage charged to the guest", () => {
    assert.match(sql, /Flipping the craft the wrong way takes in water/);
    assert.match(sql, /negligent operation and is charged to me/);
  });
  it("keeps the fee in addition to repair / replacement costs", () => {
    assert.match(sql, /in addition to, and does not replace/);
    assert.match(sql, /written quotation or damage assessment/);
  });
  it("disables the tamper trigger around the rotation", () => {
    assert.match(sql, /DISABLE TRIGGER trg_prevent_template_tampering/);
    assert.match(sql, /ENABLE TRIGGER trg_prevent_template_tampering/);
  });
  it("guarantees exactly one active activity template", () => {
    assert.match(sql, /version <> 'activity-consent-v5'/);
  });
});

describe("migration 045 — crew assignment flow", () => {
  const sql = readMigration("045_crew_assignment_flow.sql");

  it("adds the inline crew assignment RPC", () => {
    assert.match(sql, /FUNCTION public\.assign_trip_crew\(/);
  });
  it("assigns both guide and captain idempotently", () => {
    assert.match(sql, /SET guide_id\s+= p_guide_id/);
    assert.match(sql, /captain_id\s+= p_captain_id/);
  });
  it("requires a staff role for assignment", () => {
    assert.match(sql, /current_staff_role/);
    assert.match(sql, /'owner', 'manager', 'reception', 'watersports_staff'/);
  });
  it("grants the crew RPC to authenticated only", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.assign_trip_crew[\s\S]*TO authenticated/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.assign_trip_crew[\s\S]*FROM anon/);
  });
  it("blocks building ready without crew", () => {
    assert.match(sql, /p_status = 'ready' AND v_trip\.guide_id IS NULL AND v_trip\.captain_id IS NULL/);
    assert.match(sql, /RAISE EXCEPTION 'Assign a guide or captain to % before marking it ready\.'/);
  });
  it("blocks departing guests without a ready/crewed trip", () => {
    assert.match(sql, /v_trip\.status NOT IN \('ready', 'departed'\)/);
    assert.match(sql, /Assign a guide or captain to % before departing its guests\./);
  });
});

describe("migration 046 — close booking on return", () => {
  const sql = readMigration("046_close_booking.sql");

  it("adds the close-trip-bookings RPC", () => {
    assert.match(sql, /FUNCTION public\.close_trip_bookings\(/);
  });
  it("marks booking status completed and never cancels", () => {
    assert.match(sql, /status = 'completed'/);
    assert.match(sql, /status != 'cancelled'/);
    assert.match(sql, /updated_at = now\(\)/);
  });
  it("only closes a returned trip", () => {
    assert.match(sql, /v_trip\.status != 'returned'/);
    assert.match(sql, /RAISE EXCEPTION 'Trip % must be returned/);
  });
  it("requires a staff role and authenticates", () => {
    assert.match(sql, /current_staff_role/);
    assert.match(sql, /'owner', 'manager', 'reception', 'watersports_staff'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.close_trip_bookings[\s\S]*FROM anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.close_trip_bookings[\s\S]*TO authenticated/);
  });
});

describe("migration 041 — booking charges", () => {
  const sql = readMigration("041_booking_charges.sql");

  it("creates booking_charges with a category whitelist", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.booking_charges/);
    assert.match(sql, /jetski_capsize/);
    assert.match(sql, /equipment_damage/);
  });
  it("folds charges into the booking payable total", () => {
    assert.match(sql, /SET total_cents = v_new_total/);
    assert.match(sql, /recompute_booking_payment_status/);
  });
  it("defines add/void/list RPCs grant-gated to authenticated", () => {
    assert.match(sql, /FUNCTION public\.add_booking_charge\(/);
    assert.match(sql, /FUNCTION public\.void_booking_charge\(/);
    assert.match(sql, /FUNCTION public\.get_booking_charges\(/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.add_booking_charge[\s\S]*TO authenticated/);
  });
});


describe("migration 049 — trip status → manifest cascade (R2)", () => {
  const sql = readMigration("049_trip_status_manifest_cascade.sql");

  it("cascades departed → stamps departed_at via COALESCE (idempotent, never clobbers a prior stamp)", () => {
    assert.match(sql, /COALESCE\(departed_at, now\(\)\)/);
    assert.match(sql, /status = 'departed'/);
  });
  it("cascades returned → stamps departed_at (if missing) and returned_at (idempotent)", () => {
    assert.match(sql, /status = 'returned'/);
    assert.match(sql, /COALESCE\(returned_at, now\(\)\)/);
  });
  it("never overwrites an existing manifest timestamp (guard uses IS NULL / COALESCE, not unconditional =)", () => {
    assert.match(sql, /COALESCE\(departed_at, now\(\)\)/);
    assert.match(sql, /COALESCE\(returned_at, now\(\)\)/);
    assert.match(sql, / AND departed_at IS NULL/);
    assert.match(sql, / AND returned_at IS NULL/);
  });
  it("keeps the cancelled branch: releases bookings and clears manifests", () => {
    assert.match(sql, /status = 'cancelled'/);
    assert.match(sql, /DELETE FROM public\.trip_manifest/);
    assert.match(sql, /UPDATE public\.bookings SET trip_id = NULL/);
  });
  it("is a single idempotent CREATE OR REPLACE (safe on re-apply / re-deploy)", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_trip_status/);
  });
});

describe("migration 050 — equipment in-flight guard (R1)", () => {
  const sql = readMigration("050_equipment_inflight_guard.sql");

  it("creates a partial UNIQUE index keyed on equipment_id", () => {
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_rentals_one_inflight/);
    assert.match(sql, /ON public\.equipment_rentals \(equipment_id\)/);
  });
  it("guards exactly the two in-flight statuses — never 'returned'", () => {
    assert.match(sql, /status IN \('checked_out', 'overdue'\)/);
    assert.doesNotMatch(sql, /status = 'returned'/);
  });
  it("excludes ONLY in-flight rows — scoped to the index DDL, never prose reviews/speculates over predicates", () => {
    // Never assert on the raw file: the 050 WHY-comment legitimately
    // QUOTES the rejected predicate as rationale. So slice out just the
    // DDL statement and assert only against that.
    const ddl = sql.slice(sql.indexOf("CREATE UNIQUE INDEX"), sql.indexOf(";", sql.indexOf("CREATE UNIQUE INDEX")) + 1);
    assert.match(ddl, /WHERE status IN \('checked_out', 'overdue'\)/);
    assert.doesNotMatch(ddl, /status = 'returned'/);
    assert.doesNotMatch(ddl, /returned_at/);
    assert.doesNotMatch(ddl, / WHERE returned_at/);
  });
});

describe("migration 075 — spatium bike removal (R1)", () => {
  const sql = readMigration("075_remove_spatium_bike.sql");

  it("hard deletes the spatium-bike activity so it leaves every surface", () => {
    assert.match(sql, /DELETE FROM public\.activities WHERE slug = 'spatium-bike'/);
  });
  it("deletes its pricing rows first so no orphans remain", () => {
    assert.match(
      sql,
      /delete from public\.activity_pricing[\s\S]*?select id from public\.activities where slug = 'spatium-bike'/i,
    );
    assert.ok(
      sql.indexOf("activity_pricing") < sql.indexOf("DELETE FROM public.activities"),
      "pricing must be deleted before the activity row",
    );
  });
  it("only touches spatium-bike", () => {
    const slugs = sql.match(/slug = '([^']+)'/g) ?? [];
    assert.deepEqual([...new Set(slugs)], ["slug = 'spatium-bike'"]);
  });
  it("is wrapped in a transaction", () => {
    assert.match(sql, /BEGIN;/);
    assert.match(sql, /COMMIT;/);
  });
  it("the spatium-bike product is gone from the code fallbacks too", () => {
    const data = fs.readFileSync(path.resolve(__dirname, "../lib/data.ts"), "utf-8");
    const briefings = fs.readFileSync(path.resolve(__dirname, "../lib/briefings.ts"), "utf-8");
    assert.doesNotMatch(data, /spatium-bike/);
    assert.doesNotMatch(briefings, /spatium-bike/);
  });
});

describe("confirmation receipt INCLUDES (R2)", () => {
  const { buildReceiptIncludes } = require("../lib/invoice-pdf");

  it("lists Water on every trip", () => {
    assert.deepEqual(buildReceiptIncludes(null, "watersports"), ["Water"]);
    assert.deepEqual(buildReceiptIncludes(null, "excursions"), ["Water"]);
    assert.deepEqual(buildReceiptIncludes(null, null), ["Water"]);
  });

  it("adds Snorkeling Gear and GoPro Video ONLY for snorkeling trips", () => {
    assert.deepEqual(
      buildReceiptIncludes(null, "snorkeling"),
      ["Water", "Snorkeling Gear", "GoPro Video"],
    );
  });

  it("keeps the pricing option as the first bullet when present", () => {
    assert.deepEqual(
      buildReceiptIncludes("Double Adult", "snorkeling"),
      ["Double Adult", "Water", "Snorkeling Gear", "GoPro Video"],
    );
    assert.deepEqual(buildReceiptIncludes("Double Adult", "watersports"), ["Double Adult", "Water"]);
  });

  it("passes the caller-filtered option through verbatim (dedupe vs activity name lives upstream)", () => {
    assert.deepEqual(buildReceiptIncludes("", "snorkeling"), ["Water", "Snorkeling Gear", "GoPro Video"]);
    assert.deepEqual(buildReceiptIncludes("   ", "watersports"), ["Water"]);
  });
});

describe("dashboard/report gross totals (R3)", () => {
  function row(over: Partial<RangeBooking>): RangeBooking {
    return {
      id: "x", booking_ref: "OB-TEST", booking_date: null, status: "confirmed",
      payment_status: "paid", booking_currency: "USD", guests: 2,
      adults: 2, children_count: 0, source: "walk_in",
      total_cents: 0, estimated_total_cents: 0, net_cents: 0, commission_cents: 0,
      ...over,
    };
  }

  it("falls back to estimated total when total_cents is 0 (walk-in bookings)", () => {
    assert.equal(grossCents(row({ estimated_total_cents: 28500 })), 28500);
    assert.equal(grossCents(row({ estimated_total_cents: 10000 })), 10000);
  });

  it("uses the final total when it is set", () => {
    assert.equal(grossCents(row({ total_cents: 6793, estimated_total_cents: 6500 })), 6793);
  });

  it("returns 0 only when both totals are absent", () => {
    assert.equal(grossCents(row({})), 0);
  });
});

describe("activity CRUD — add / modify / delete (R4)", () => {
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/activities/ActivityForm.tsx"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/activities/ActivityPageClient.tsx"), "utf-8");

  it("provides createActivity that validates name, slug uniqueness and currency", () => {
    assert.match(actions, /export async function createActivity/);
    assert.match(actions, /Activity name is required/);
    assert.match(actions, /slugifyActivityName/);
    assert.match(actions, /already exists/);
    assert.match(actions, /assertCurrency\(formData.currency\)/);
  });

  it("autogenerates a slug from the name when blank (slugify helper)", () => {
    assert.match(actions, /function slugifyActivityName/);
    assert.ok(actions.includes('.replace(/[^a-z0-9]+/g, "-")'), "slugify has the char-class replace");
  });

  it("inserts the new activity's pricing rows referencing the created id", () => {
    assert.match(actions, /\.from\("activity_pricing"\)\.insert\(rows\)/);
    assert.match(actions, /activity_id: inserted\.id/);
  });

  it("updateActivity supports slug modification (blank slug re-derives from name)", () => {
    assert.match(actions, /if \(formData\.slug !== undefined\)/);
    assert.match(actions, /slugifyActivityName\(String\(formData\.name\)\)/);
  });

  it("deleteActivity protects activities referenced by bookings/trips/consent/checkin/incidents", () => {
    assert.match(actions, /export async function deleteActivity/);
    assert.match(actions, /\["bookings"|\["trips"|\["consent_forms"|\["consent_checkin_sessions"|\["incident_reports"/);
    assert.match(actions, /Mark it inactive instead/);
    assert.match(actions, /\.from\("activities"\)\.delete\(\)\.eq\("id", id\)/);
  });

  it("the form supports create mode (distinct title + createActivity call)", () => {
    assert.match(form, /import \{ createActivity, updateActivity, replaceActivityPricing \}/);
    assert.match(form, /isNew \? "Add Activity" : "Edit Activity"/);
    assert.match(form, /isNew \? "Create Activity" : "Update Activity"/);
    assert.match(form, /await createActivity\(/);
  });

  it("the activities page has an Add button and a delete handler per row", () => {
    assert.match(client, /\+ Add Activity/);
    assert.match(client, /openCreate/);
    assert.match(client, /deleteActivity/);
    assert.match(client, /handleDelete/);
    assert.match(client, /actionBtn-cancelled/);
  });
});

describe("reception syncs with ops board departures/returns (R5)", () => {
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const migration = readMigration("049_trip_status_manifest_cascade.sql");

  it("ops status action revalidates the reception board", () => {
    assert.match(actions, /export async function updateTripStatusAction/);
    assert.match(actions, /revalidatePath\("\/admin\/reception"\)/);
  });

  it("trip-level departure cancels trip_manifest.departed_at down to manifests", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_trip_status/);
    assert.match(migration, /p_status = 'departed'/);
    assert.match(migration, /UPDATE public\.trip_manifest\s+SET departed_at = COALESCE\(departed_at, now\(\)\)/);
  });

  it("trip-level return stamps both departed_at and returned_at (preserves returned→planned reopen)", () => {
    assert.match(migration, /p_status = 'returned'/);
    assert.match(migration, /returned_at = COALESCE\(returned_at, now\(\)\)/);
    assert.match(migration, /v_trip\.status = 'returned'\s+AND p_status IN \('planned'\)/);
  });
});

describe("my tasks consent sync (R6)", () => {
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");

  it("getTrips embeds booking id in the manifest so task IDs & consent lookups resolve", () => {
    assert.match(actions, /export async function getTrips/);
    assert.match(actions, /bookings\(id, booking_ref, status, payment_status/);
  });

  it("getMyTasks flags a booking as consent-pending only when it has no signed consent form", () => {
    assert.match(actions, /export async function getMyTasks/);
    assert.match(actions, /consent\.status !== "signed"/);
  });
});

describe("partner split — resort trip gross/comission/net (R7)", () => {
  const migration = readMigration("054_partner_split.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/activities/ActivityForm.tsx"), "utf-8");

  it("migration adds per-activity partner, commission and net columns", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS partner TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS commission_cents INT NOT NULL DEFAULT 0 CHECK \(commission_cents >= 0\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS net_cents INT NOT NULL DEFAULT 0 CHECK \(net_cents >= 0\)/);
  });

  it("migration configures the Ellaidhoo resort trip split ($95 resort / $55 us)", () => {
    assert.match(migration, /slug = 'resort-trip-ellaidhoo'/);
    assert.match(migration, /commission_cents = 9500/);
    assert.match(migration, /net_cents = 5500/);
    assert.match(migration, /partner = 'Cinnamon Ellaidhoo Resort'/);
  });

  it("migration adds an INSERT trigger that auto-fills bookings from activity per-guest split", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.auto_partner_split_bookings/);
    assert.match(migration, /CREATE TRIGGER trg_bookings_auto_partner_split\s+BEFORE INSERT ON public\.bookings/);
    assert.match(migration, /NEW\.commission_cents := v_comm \* v_pax/);
    assert.match(migration, /NEW\.net_cents := v_net \* v_pax/);
    assert.match(migration, /NEW\.partner := v_partner/);
    assert.match(migration, /GREATEST\(COALESCE\(NEW\.adults, 0\), 0\)/);
  });

  it("updateActivity and createActivity persist partner / commission / net", () => {
    assert.match(actions, /if \(formData\.partner !== undefined\) patch\.partner = emptyToNull\(formData\.partner\)/);
    assert.match(actions, /patch\.commission_cents = Math\.max\(Math\.round\(Number\(formData\.commission_cents\) \|\| 0\), 0\)/);
    assert.match(actions, /patch\.net_cents = Math\.max\(Math\.round\(Number\(formData\.net_cents\) \|\| 0\), 0\)/);
    assert.match(actions, /commission_cents: Math\.max\(Math\.round\(Number\(formData\.commission_cents\) \|\| 0\), 0\),/);
    assert.match(actions, /net_cents: Math\.max\(Math\.round\(Number\(formData\.net_cents\) \|\| 0\), 0\),/);
  });

  it("the activity form exposes partner, commission/guest and net/guest inputs", () => {
    assert.match(form, /Partner \(resort\/partner\)/);
    assert.match(form, /Commission \/ guest/);
    assert.match(form, /Net \/ guest/);
    assert.match(form, /commission_cents: parseMajorInput\(commissionPerGuest\)/);
    assert.match(form, /net_cents: parseMajorInput\(netPerGuest\)/);
  });
});

describe("commission — percentage or fixed, in USD or MVR", () => {
  const migration = readMigration("077_commission_percent_or_fixed.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const sanitize = fs.readFileSync(path.resolve(__dirname, "../lib/sanitize.ts"), "utf-8");
  const activityForm = fs.readFileSync(path.resolve(__dirname, "../app/admin/activities/ActivityForm.tsx"), "utf-8");
  const bookingForm = fs.readFileSync(path.resolve(__dirname, "../app/admin/bookings/BookingForm.tsx"), "utf-8");
  const backfill = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/CommissionBackfill.tsx"), "utf-8");
  const reportsPage = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/page.tsx"), "utf-8");

  describe("resolveCommission", () => {
    it("takes a percentage of the booking total and reports the remainder as net", () => {
      const r = resolveCommission({ mode: "percent", percent: 10, fixedCents: 0, basisCents: 22000 });
      assert.equal(r.commissionCents, 2200);
      assert.equal(r.netCents, 19800);
      assert.equal(r.basis, "percent");
      assert.equal(r.percent, 10);
      assert.equal(r.currency, "USD");
    });

    it("rounds a percentage to whole minor units", () => {
      const r = resolveCommission({ mode: "percent", percent: 12.5, fixedCents: 0, basisCents: 3333 });
      assert.equal(r.commissionCents, 417); // 416.625 -> 417
    });

    it("keeps a per-guest fixed rate for an activity (054 behaviour)", () => {
      const r = resolveCommission({ mode: "fixed", fixedCents: 9500, basisCents: 60000, pax: 3 });
      assert.equal(r.commissionCents, 28500);
      assert.equal(r.netCents, 31500);
      assert.equal(r.basis, "fixed_per_guest");
    });

    it("converts a fixed MVR commission into a USD booking at the fixed rate", () => {
      const r = resolveCommission({
        mode: "fixed",
        fixedCents: 90000,        // 900.00 MVR quoted per booking (pax 1)
        fixedCurrency: "MVR",
        basisCents: 22000,        // $220.00 booking
        basisCurrency: "USD",
      });
      assert.equal(r.commissionCents, 4737); // 900 / 19 = $47.37
      assert.equal(r.netCents, 22000 - 4737);
      assert.equal(r.currency, "USD", "money must land in the booking currency");
    });

    it("floors net at zero when the commission exceeds the sale", () => {
      const r = resolveCommission({ mode: "fixed", fixedCents: 30000, basisCents: 22000 });
      assert.equal(r.commissionCents, 30000);
      assert.equal(r.netCents, 0);
    });

    it("falls back to the fixed amount when a percent rule has no rate yet", () => {
      const r = resolveCommission({ mode: "percent", percent: "", fixedCents: 2500, basisCents: 20000 });
      assert.equal(r.commissionCents, 2500);
      assert.equal(r.percent, null);
    });

    it("drops a stale percent when the rule is fixed", () => {
      const r = resolveCommission({ mode: "fixed", percent: 10, fixedCents: 5000, basisCents: 20000 });
      assert.equal(r.percent, null);
    });

    it("reports no commission when nothing is set", () => {
      const r = resolveCommission({ mode: "fixed", fixedCents: 0, basisCents: 20000 });
      assert.equal(r.basis, "none");
      assert.equal(r.netCents, 20000);
    });

    it("describes the basis for the UI", () => {
      assert.equal(describeCommissionBasis(resolveCommission({ mode: "percent", percent: 10, fixedCents: 0, basisCents: 10000 })), "10%");
      assert.equal(describeCommissionBasis(resolveCommission({ mode: "fixed", fixedCents: 500, basisCents: 10000 })), "fixed amount");
      assert.equal(describeCommissionBasis(resolveCommission({ mode: "fixed", fixedCents: 0, basisCents: 10000 })), "no commission");
    });
  });

  describe("helpers", () => {
    it("parses and clamps percentages", () => {
      assert.equal(parseCommissionPercent("10"), 10);
      assert.equal(parseCommissionPercent(12.345), 12.35);
      assert.equal(parseCommissionPercent(250), MAX_COMMISSION_PERCENT);
      assert.equal(parseCommissionPercent(""), null);
      assert.equal(parseCommissionPercent(null), null);
      assert.equal(parseCommissionPercent(-5), null);
      assert.equal(parseCommissionPercent("abc"), null);
    });

    it("defaults an unknown mode to fixed", () => {
      assert.equal(commissionMode("percent"), "percent");
      assert.equal(commissionMode(undefined), "fixed");
      assert.equal(commissionMode("nonsense"), "fixed");
    });

    it("converts only between the two ledger currencies", () => {
      assert.equal(convertToBasisCurrency(90000, "MVR", "USD"), 4737);
      assert.equal(convertToBasisCurrency(5000, "USD", "MVR"), 95000);
      assert.equal(convertToBasisCurrency(5000, "USD", "USD"), 5000);
    });

    it("treats net == basis as never-entered, which is what the backfill may rewrite", () => {
      assert.equal(netWasUnset(10000, 10000), true);
      assert.equal(netWasUnset(5000, 10000), false);
      assert.equal(netWasUnset(0, 10000), false);
      assert.equal(netWasUnset(10000, 0), false);
    });
  });

  describe("migration 077", () => {
    it("adds a mode + rate to activities and snapshots both onto bookings", () => {
      assert.match(migration, /ADD COLUMN IF NOT EXISTS commission_mode TEXT NOT NULL DEFAULT 'fixed'/);
      assert.match(migration, /ADD COLUMN IF NOT EXISTS commission_percent NUMERIC\(7, 2\)/);
      assert.match(migration, /CHECK \(commission_percent IS NULL OR \(commission_percent >= 0 AND commission_percent <= 100\)\)/);
      assert.match(migration, /ADD COLUMN IF NOT EXISTS commission_currency TEXT/);
    });

    it("leaves bookings.commission_mode nullable so the trigger and backfill can distinguish a snapshot", () => {
      const bookingsBlock = migration.slice(migration.indexOf("ALTER TABLE public.bookings"));
      assert.match(bookingsBlock, /ADD COLUMN IF NOT EXISTS commission_mode TEXT\s*\n?\s*CHECK \(commission_mode IS NULL/);
    });

    it("makes the insert trigger percent-aware and snapshots the rule", () => {
      assert.match(migration, /NEW\.commission_mode := COALESCE\(v_mode, 'fixed'\)/);
      assert.match(migration, /NEW\.commission_percent := v_pct/);
      assert.match(migration, /NEW\.commission_mode = 'percent' AND COALESCE\(v_pct, 0\) > 0/);
    });

    it("keeps the fixed per-guest maths for fixed-mode activities", () => {
      assert.match(migration, /THEN v_comm \* v_pax/);
      assert.match(migration, /THEN v_net \* v_pax/);
    });

    it("only rewrites a net that still equals the sale", () => {
      assert.match(migration, /CREATE OR REPLACE FUNCTION public\.net_was_unset/);
      assert.match(migration, /v_new_net := CASE WHEN public\.net_was_unset\(v_row\.net_cents, v_basis\)/);
    });

    it("previews by default, skips cancelled bookings and gates roles", () => {
      assert.match(migration, /p_apply BOOLEAN DEFAULT FALSE/);
      assert.match(migration, /AND b\.status <> 'cancelled'/);
      assert.match(migration, /IF v_role NOT IN \('owner', 'manager', 'reception'\)/);
      assert.match(migration, /json_build_object\('error', 'unauthorized'/);
    });

    it("falls back to the activity's current rule when a booking has no snapshot", () => {
      assert.match(migration, /v_comm_mode := COALESCE\(v_row\.commission_mode, v_row\.activity_mode, 'fixed'\)/);
      assert.match(migration, /v_pct := COALESCE\(v_row\.commission_percent, v_row\.activity_percent\)/);
    });

    it("reports counts, sums and samples", () => {
      assert.match(migration, /'changed', v_changed/);
      assert.match(migration, /'nets_adjusted', v_nets/);
      assert.match(migration, /'samples', v_samples/);
    });
  });

  describe("sanitizer and actions", () => {
    it("sanitizes the rule on create and patch", () => {
      assert.match(sanitize, /commission_mode: commissionMode\(data\.commission_mode\)/);
      assert.match(sanitize, /commission_percent: parseCommissionPercent\(data\.commission_percent\)/);
      assert.match(sanitize, /case "commission_mode":/);
      assert.match(sanitize, /case "commission_currency":/);
    });

    it("persists the activity default", () => {
      assert.match(actions, /commission_mode: commissionMode\(formData\.commission_mode\)/);
      assert.match(actions, /commission_percent: parseCommissionPercent\(formData\.commission_percent\)/);
    });

    it("exposes preview and apply backfill actions behind the staff role check", () => {
      assert.match(actions, /export async function previewCommissionBackfillAction\(from: string, to: string\)/);
      assert.match(actions, /export async function applyCommissionBackfillAction\(from: string, to: string\)/);
      assert.match(actions, /return backfillCommission\(from, to, false\)/);
      assert.match(actions, /return backfillCommission\(from, to, true\)/);
      assert.match(actions, /!\["owner", "manager", "reception"\]\.includes\(String\(profile\.role\)\)/);
      assert.match(actions, /p_apply: apply/);
    });
  });

  describe("UI", () => {
    it("activity form offers a fixed/percent choice with a rate box", () => {
      assert.match(activityForm, /label="Commission type"/);
      assert.match(activityForm, /<option value="percent">Percent of booking<\/option>/);
      assert.match(activityForm, /label="Commission %"/);
      assert.match(activityForm, /commission_percent: commissionKind === "percent" \? commissionPercent : null/);
    });

    it("booking form resolves the rule live and saves mode, rate and currency", () => {
      assert.match(bookingForm, /id="bf-commission-mode"/);
      assert.match(bookingForm, /applyCommissionRule\(\{ percent: e\.target\.value \}\)/);
      assert.match(bookingForm, /commission_percent: commissionKind === "percent" \? commissionPercent : null/);
      assert.match(bookingForm, /commission_currency: commissionCurrency/);
      assert.match(bookingForm, /Resolved automatically:/);
    });

    it("reports page shows the backfill only to the roles the RPC allows", () => {
      assert.match(reportsPage, /\{canFinance \? <CommissionBackfill from=\{from\} to=\{to\} \/> : null\}/);
    });

    it("backfill previews before offering to apply", () => {
      assert.match(backfill, /previewCommissionBackfillAction/);
      assert.match(backfill, /applyCommissionBackfillAction/);
      assert.match(backfill, /Preview changes/);
      assert.match(backfill, /preview && preview\.changed > 0/);
      assert.match(backfill, /disabled=\{pending \|\| !valid\}/);
    });
  });
});

describe("agent invoice — per-booking PDF that shows commission", () => {
  const agentRoute = fs.readFileSync(
    path.resolve(__dirname, "../app/api/admin/invoices/booking/[id]/partner/pdf/route.ts"),
    "utf-8",
  );
  const guestRoute = fs.readFileSync(
    path.resolve(__dirname, "../app/api/admin/invoices/booking/[id]/pdf/route.ts"),
    "utf-8",
  );
  const invoicePdf = fs.readFileSync(path.resolve(__dirname, "../lib/invoice-pdf.ts"), "utf-8");
  const bookingPage = fs.readFileSync(path.resolve(__dirname, "../app/admin/bookings/BookingPageClient.tsx"), "utf-8");

  it("keeps the statement renderer reusable for a single booking", () => {
    assert.match(invoicePdf, /title\?: string;/);
    assert.match(invoicePdf, /periodLabel\?: string;/);
    assert.match(invoicePdf, /data\.title \|\| "PARTNER STATEMENT"/);
    assert.match(invoicePdf, /data\.periodLabel \|\| `\$\{fmtDay\(data\.from\)\} — \$\{fmtDay\(data\.to\)\}`/);
  });

  it("prints the commission basis when the rule is a percentage", () => {
    assert.match(invoicePdf, /rateNote\?: string \| null/);
    assert.match(invoicePdf, /Commission basis: \$\{rateNote\}/);
    assert.match(agentRoute, /mode === "percent" && percent !== null/);
    assert.match(agentRoute, /`\$\{percent\}% of booking value`/);
  });

  it("titles the document AGENT INVOICE and keys it to the booking ref", () => {
    assert.match(agentRoute, /title: "AGENT INVOICE"/);
    assert.match(agentRoute, /periodLabel: `BOOKING \$\{String\(booking\.booking_ref \|\| id\.slice\(0, 8\)\)\}`/);
    assert.match(agentRoute, /thoddoo-marine-agent-invoice-/);
  });

  it("shows gross, commission and net in the booking currency", () => {
    assert.match(agentRoute, /total_cents, estimated_total_cents, net_cents, commission_cents, partner/);
    assert.match(agentRoute, /gross_cents: gross/);
    assert.match(agentRoute, /commission_cents: commission/);
    assert.match(agentRoute, /net_cents: net/);
    assert.match(agentRoute, /booking\.booking_currency === "MVR" \? "MVR" : "USD"/);
  });

  it("refuses a booking with no partner instead of printing an invoice to nobody", () => {
    assert.match(agentRoute, /This booking has no partner\/agent, so there is nobody to invoice/);
    assert.match(agentRoute, /status: 400/);
  });

  it("is gated to the same finance roles as the guest invoice", () => {
    assert.match(agentRoute, /isFinanceRole\(role\)/);
    assert.match(agentRoute, /status: 401/);
    assert.match(agentRoute, /status: 403/);
    assert.match(agentRoute, /UUID_RE\.test\(id\)/);
  });

  it("offers the agent copy next to the guest one, only when there is a partner", () => {
    assert.match(bookingPage, /\{b\.partner \? \(/);
    assert.match(bookingPage, /\/api\/admin\/invoices\/booking\/\$\{String\(b\.id\)\}\/partner\/pdf/);
    assert.match(bookingPage, /title="Invoice PDF"/);
    assert.match(bookingPage, /title="Agent invoice PDF \(includes commission\)"/);
  });

  it("never leaks commission or net into the guest invoice", () => {
    const guestSelect = guestRoute.slice(guestRoute.indexOf('"estimated_total_cents'), guestRoute.indexOf("payments("));
    assert.match(guestRoute, /estimate[d]?_total_cents/);
    assert.doesNotMatch(guestSelect, /commission_cents/);
    assert.doesNotMatch(guestRoute, /net_cents/);
    // partner is allowed: the agent name is not money.
    assert.doesNotMatch(guestRoute, /commission_mode|commission_percent/);
  });
});

describe("public + walk-in booking flows — the 072 email gate (migration 078)", () => {
  const migration = readMigration("078_public_booking_email_gate.sql");
  const email = fs.readFileSync(path.resolve(__dirname, "../lib/email.ts"), "utf-8");
  const walkin = fs.readFileSync(path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"), "utf-8");
  const siteForm = fs.readFileSync(path.resolve(__dirname, "../app/components/BookingForm.tsx"), "utf-8");
  const m072 = readMigration("072_compulsory_email_guest_copies.sql");

  it("the trigger blocked UPDATE too, which is why staff could not edit old bookings", () => {
    assert.match(m072, /BEFORE INSERT OR UPDATE ON public\.bookings/);
    assert.match(migration, /IF TG_OP <> 'INSERT' THEN\s*RETURN NEW;/);
    // Re-attached INSERT-only, since CREATE OR REPLACE leaves the trigger bound.
    assert.match(migration, /BEFORE INSERT ON public\.bookings/);
  });

  it("still requires a valid email when a booking is first created", () => {
    assert.match(migration, /SELECT email INTO v_email FROM customers WHERE id = NEW\.customer_id/);
    assert.match(migration, /IF v_email IS NULL OR NOT public\.is_valid_email\(v_email\) THEN/);
  });

  it("submit_public_booking_group_v2 takes and stores the guest email", () => {
    assert.match(migration, /p_guest_email         TEXT,/);
    assert.match(migration, /v_email_clean := lower\(NULLIF\(trim\(p_guest_email\), ''\)\)/);
    assert.match(migration, /IF NOT public\.is_valid_email\(v_email_clean\) THEN/);
    assert.match(migration, /INSERT INTO public\.customers \(full_name, phone, email\)/);
  });

  it("fills in a missing address but never overwrites one the guest corrected", () => {
    assert.match(migration, /ELSIF NOT EXISTS \(\s*SELECT 1 FROM public\.customers\s*WHERE id = v_customer_id AND public\.is_valid_email\(email\)/);
    assert.match(migration, /UPDATE public\.customers SET email = v_email_clean WHERE id = v_customer_id/);
  });

  it("drops the old overload so PostgREST cannot resolve the wrong signature", () => {
    assert.match(migration, /DROP FUNCTION IF EXISTS public\.submit_public_booking_group_v2\(JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT\)/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2\(JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT\) TO anon/);
  });

  it("carries the 066 rules over untouched, not a rewritten function", () => {
    // The consent gate, the register gate and the per-participant hard gate are
    // the reason this RPC is 250 lines; losing one of them would reopen a hole.
    assert.match(migration, /You must agree to the consent and liability terms/);
    assert.match(migration, /is_cash_register_open\(\)/);
    assert.match(migration, /The cash register is not open yet/);
    assert.match(migration, /Every guest must be listed as a participant/);
    assert.match(migration, /You can combine up to 8 activities/);
    assert.match(migration, /SECURITY DEFINER SET search_path = public/);
  });

  it("both public forms collect and send the email", () => {
    for (const src of [walkin, siteForm]) {
      assert.match(src, /guestEmail/);
      assert.match(src, /p_guest_email: guestEmail\.trim\(\)/);
      assert.match(src, /isValidEmail\(guestEmail\)/);
      assert.match(src, /type="email"/);
    }
  });

  it("the client validator matches the database rule", () => {
    // Compared as text rather than by regex, so this cannot pass by accident.
    const sqlPattern = (m072.match(/lower\(trim\(p_email\)\) ~ '([^']+)'/) || [])[1];
    assert.ok(sqlPattern, "could not find the SQL email pattern in 072");
    assert.equal(EMAIL_RE.source, sqlPattern);
    // The SQL lowercases before matching; the JS /i flag does the same job.
    assert.ok(email.includes("/i;"), "EMAIL_RE must be case-insensitive to match SQL lower()");
    assert.match(migration, /v_email_clean := lower\(/);
  });

  it("accepts real addresses and rejects the shapes the database rejects", () => {
    for (const good of ["a@b.co", "first.last+tag@sub.domain.mv", "x_y-z%1@example.museum"]) {
      assert.ok(isValidEmail(good), `should accept ${good}`);
    }
    for (const bad of ["", "  ", "plain", "no-at.com", "a@b", "a b@c.com", "a@.com", `${"a".repeat(250)}@b.com`]) {
      assert.equal(isValidEmail(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
    assert.match(EMAIL_REQUIRED_MESSAGE, /invoice and safety waiver/);
  });
});

describe("booking form — the guest email can be added in place", () => {
  const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/bookings/BookingForm.tsx"), "utf-8");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");

  it("shows an email field prefilled from the selected customer", () => {
    assert.match(form, /const \[guestEmail, setGuestEmail\] = useState\(/);
    assert.match(form, /id="bf-guest-email"/);
    assert.match(form, /type="email"/);
    // Choosing a different customer reloads the address rather than keeping the old one.
    assert.match(form, /const chosen = customersList\.find\(\(c\) => String\(c\.id\) === id\)/);
    assert.match(form, /setGuestEmail\(chosen \? String\(chosen\.email \|\| ""\) : ""\)/);
  });

  it("flags customers with no address in the dropdown, before the save fails", () => {
    assert.match(form, /\(no email\)/);
    assert.match(form, /isValidEmail\(c\.email as string\) \? "" :/);
  });

  it("refuses to save without one, with the reason", () => {
    assert.match(form, /if \(!isValidEmail\(guestEmail\)\)/);
    assert.match(form, /EMAIL_REQUIRED_MESSAGE/);
  });

  it("sends it with both create and update", () => {
    assert.match(form, /guest_email: guestEmail\.trim\(\),/);
    assert.equal((form.match(/guest_email: guestEmail\.trim\(\),/g) || []).length, 2);
  });

  it("writes it to the customer record from both booking actions", () => {
    assert.match(actions, /async function saveCustomerEmail\(/);
    assert.match(actions, /await saveCustomerEmail\(supabase, clean\.customer_id, data\.guest_email\)/);
    assert.match(actions, /await saveCustomerEmail\(supabase, String\(data\.customer_id\), data\.guest_email\)/);
    assert.match(actions, /\.update\(\{ email: clean, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  });

  it("never blanks an address that is already there", () => {
    // An empty field means "untouched", not "delete the guest's email".
    assert.match(actions, /if \(!isValidEmail\(clean\) \|\| !customerId\) return;/);
  });
});

describe("expense ledger — costs deducted from net revenue (R8)", () => {
  const migration = readMigration("055_expenses.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const reports = fs.readFileSync(path.resolve(__dirname, "../lib/reports.ts"), "utf-8");
  const sanitize = fs.readFileSync(path.resolve(__dirname, "../lib/sanitize.ts"), "utf-8");
  const permissions = fs.readFileSync(path.resolve(__dirname, "../lib/permissions.ts"), "utf-8");
  const nav = fs.readFileSync(path.resolve(__dirname, "../app/admin/AdminNav.tsx"), "utf-8");
  const dashboard = fs.readFileSync(path.resolve(__dirname, "../app/admin/page.tsx"), "utf-8");
  const reportsPage = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/page.tsx"), "utf-8");
  const reportsClient = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/ReportsClient.tsx"), "utf-8");
  const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/expenses/ExpenseForm.tsx"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/expenses/ExpensePageClient.tsx"), "utf-8");

  it("migration creates the expenses table with MVR/USD amounts and RLS for owner/manager", () => {
    assert.match(migration, /create table if not exists public\.expenses/);
    assert.match(migration, /amount_cents int not null check \(amount_cents >= 0\)/);
    assert.match(migration, /currency text not null default 'MVR' check \(currency in \('USD', 'MVR'\)\)/);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /"expenses_select_owner_manager"/);
    assert.match(migration, /sp\.role in \('owner', 'manager'\)/);
  });

  it("reports.ts has expense aggregation + net profit = net revenue − expenses", () => {
    assert.match(reports, /export function expenseCents/);
    assert.match(reports, /export function sumExpensesByCurrency/);
    assert.match(reports, /export function expensesByCategory/);
    assert.match(reports, /export function profitTotals/);
    assert.match(reports, /net\.usdCents \+ otherIncome\.usdCents - expenses\.usdCents/);
  });

  it("sanitizeExpense validates title/amount/currency/date for the ledger", () => {
    assert.match(sanitize, /export function sanitizeExpense/);
    assert.match(sanitize, /safeCents\(data\.amount_cents\)/);
    assert.match(sanitize, /validCurrencyFallback\(data\.currency\)/);
  });

  it("actions expose expenses CRUD with required title and positive amount", () => {
    assert.match(actions, /export async function getExpenses/);
    assert.match(actions, /export async function createExpense/);
    assert.match(actions, /export async function updateExpense/);
    assert.match(actions, /export async function deleteExpense/);
    assert.match(actions, /Expense title is required/);
    assert.match(actions, /Amount must be greater than zero/);
  });

  it("expenses are an owner/manager-only module and appear in the nav", () => {
    assert.match(permissions, /expenses: ADMIN/);
    assert.match(nav, /Expenses/, 'nav has an Expenses entry');
  });

  it("dashboard and reports surface expenses + net profit", () => {
    assert.match(dashboard, /Expenses · this month/);
    assert.match(dashboard, /Net Profit \(received\) · this month/);
    assert.match(dashboard, /expensesByCategory\(expenseRows\)/);
    assert.match(reportsPage, /profitTotals\(collectedNet, expenses, otherIncomeTotal\)/);
    assert.match(reportsClient, /Net Profit \(Received \+ Other − Expenses\)/);
    assert.match(reportsClient, /Expenses by Category/);
  });

  it("the expenses page has a ledger table, add/edit/delete and a modal form", () => {
    assert.match(client, /\+ Add Expense/);
    assert.match(client, /deleteExpense/);
    assert.match(client, /Spent by Category/);
    // 086: the form's presets are the shared P&L lines, not a stale list.
    assert.match(form, /EXPENSE_CATEGORIES/);
    assert.match(form, /Fuel/);
    assert.match(form, /createExpense, updateExpense/);
  });
});

describe("ops revenue — net falls back to gross when no partner split (R9)", () => {
  const migration = readMigration("056_partner_split_net_gross_fallback.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const operations = fs.readFileSync(path.resolve(__dirname, "../lib/operations.ts"), "utf-8");

  function tripRow(bookings: unknown[]): TripRow {
    return {
      id: "t1", trip_ref: "TRP-TEST", activity_id: "a1", trip_date: "2026-09-22",
      capacity_pax: 6, seats_open: 5, status: "returned",
      trip_manifest: bookings.map((b, i) => ({
        id: `m${i}`, pax: 1, guest_name: "Guest", checked_in: true,
        bookings: b as NonNullable<TripRow["trip_manifest"]>[number]["bookings"],
      })),
    } as TripRow;
  }

  it("uses net when the partner split set it", () => {
    assert.equal(tripRevenueCents(tripRow([{ net_cents: 5500, estimated_total_cents: 15000 }])), 5500);
  });

  it("falls back to the final total when net is blank (admin booking without Net)", () => {
    assert.equal(tripRevenueCents(tripRow([{ net_cents: 0, total_cents: 5000, estimated_total_cents: 0 }])), 5000);
  });

  it("falls back to the estimate when only that is recorded (walk-in QR)", () => {
    assert.equal(tripRevenueCents(tripRow([{ net_cents: 0, total_cents: 0, estimated_total_cents: 3000 }])), 3000);
  });

  it("returns 0 only when nothing is recorded", () => {
    assert.equal(tripRevenueCents(tripRow([{ net_cents: 0, total_cents: 0, estimated_total_cents: 0 }])), 0);
  });

  it("getTrips selects total_cents so the ops fallback can see it", () => {
    assert.match(actions, /estimated_total_cents, total_cents, net_cents, commission_cents/);
  });

  it("migration 056 re-creates the trigger with a net=gross backfill branch", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.auto_partner_split_bookings/);
    assert.match(migration, /GREATEST\(COALESCE\(NEW\.total_cents, 0\),/);
    assert.match(migration, /AND \(NEW\.net_cents IS NULL OR NEW\.net_cents = 0\)/);
    assert.match(migration, /v_comm > 0 OR v_net > 0/);
  });
});

describe("full activity price list (R10)", () => {
  const migration = readMigration("057_price_list.sql");
  const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/activities/ActivityForm.tsx"), "utf-8");

  it("upserts into activities by slug (idempotent, no duplicates)", () => {
    assert.match(migration, /INSERT INTO public\.activities/);
    assert.match(migration, /ON CONFLICT \(slug\) DO UPDATE SET/);
  });

  it("has the canonical rate card items from the price list", () => {
    for (const slug of [
      "jet-ski", "funtube", "banana-ride", "water-skiing", "wakeboarding",
      "kayak", "stand-up-paddleboard", "sup-with-scooter",
      "drone-video-shoot", "gopro-rental",
      "turtle-reef-snorkeling", "manta-ray-snorkeling",
      "one-spot-snorkeling", "two-spot-snorkeling", "three-spot-snorkeling",
      "table-coral-garden-snorkeling", "nurse-shark-adventure", "manta-nurse-shark-combo",
      "sandbank-trip", "fish-feeding-blue-hole", "madivaru-trip",
      "ukulhas-half-day", "thoddoo-half-day",
      "sunset-cruise", "dolphin-cruise",
      "sunrise-fishing", "sunset-fishing", "night-fishing", "fishing-bbq-dinner",
      "tropical-paradise-retreat", "sports-fishing-half-day",
      "beach-sunset-dinner", "romantic-dinner", "beach-bbq-dinner",
    ]) {
      assert.match(migration, new RegExp(`'${slug}'`), `missing item ${slug}`);
    }
  });

  it("carries the published prices (manta $85, 5-round wakeboarding $160, etc.)", () => {
    assert.match(migration, /'manta-ray-snorkeling'.*?8500/s);
    assert.match(migration, /'15 minutes \(5 rounds\)', 16000/);
    assert.match(migration, /'1-hour Jet Adventure \+ Snorkeling', 15000/);
    assert.match(migration, /'Sports Fishing \(Half Day\)', 'sports-fishing-half-day'[\s\S]*?40000/);
    assert.match(migration, /'Tropical Paradise Day Retreat', 'tropical-paradise-retreat'[\s\S]*?18000/);
  });

  it("re-prices the water-skiing 5-round option away from the old 60.00", () => {
    assert.doesNotMatch(migration, /'15 minutes \(5 rounds\)', 6000(?![0-9])/);
  });

  it("rebuilds pricing options for option-bearing watersports", () => {
    assert.match(migration, /DELETE FROM public\.activity_pricing WHERE activity_id = act_id/);
    for (const slug of [
      "jet-ski", "funtube", "banana-ride", "water-skiing", "wakeboarding",
      "kayak",
    ]) {
      assert.match(migration, new RegExp(`slug = '${slug}'`), `missing pricing block for ${slug}`);
    }
  });

  it("the activity form suggests the new categories", () => {
    for (const cat of ["watersports", "snorkeling", "excursions", "cruises", "fishing", "island-trips", "resort-trips", "charters", "dining", "add-ons"]) {
      assert.match(form, new RegExp(`<option value="${cat}" />`), `missing category suggestion ${cat}`);
    }
  });
});

describe("cash register — open / close / collections (R11)", () => {
  const migration = readMigration("058_cash_register.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const sanitize = fs.readFileSync(path.resolve(__dirname, "../lib/sanitize.ts"), "utf-8");
  const cashreg = fs.readFileSync(path.resolve(__dirname, "../lib/cashreg.ts"), "utf-8");
  const permissions = fs.readFileSync(path.resolve(__dirname, "../lib/permissions.ts"), "utf-8");
  const nav = fs.readFileSync(path.resolve(__dirname, "../app/admin/AdminNav.tsx"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/cashreg/CashRegisterClient.tsx"), "utf-8");

  it("migration creates registers and entries with per-currency checks and RLS", () => {
    assert.match(migration, /create table if not exists public\.cash_registers/);
    assert.match(migration, /create table if not exists public\.cash_register_entries/);
    assert.match(migration, /status in \('open', 'closed'\)/);
    assert.match(migration, /method in \('cash', 'card', 'bank_transfer', 'bill', 'expense'\)/);
    assert.match(migration, /enable row level security/);
    assert.match(migration, /cash_register_select_owner_manager_reception/);
    assert.match(migration, /cash_register_entries_write_owner_manager_reception/);
  });

  it("migration enforces one open register per date", () => {
    assert.match(migration, /cash_registers_unique_open_date/);
    assert.match(migration, /where status = 'open'/);
  });

  it("cashreg.ts aggregates income / cash-in / cash-out and expected cash", () => {
    assert.match(cashreg, /export function cashRegisterTotals/);
    assert.match(cashreg, /expected = opening \+ cash in − cash out/);
    assert.match(cashreg, /export function cashRegisterOverShort/);
    assert.match(cashreg, /counted\.usdCents - expected\.usdCents/);
  });

  it("sanitizers validate register open / entry / close payloads", () => {
    assert.match(sanitize, /export function sanitizeCashRegisterOpen/);
    assert.match(sanitize, /export function sanitizeCashRegisterEntry/);
    assert.match(sanitize, /export function sanitizeCashRegisterClose/);
    assert.match(sanitize, /CASH_REGISTER_METHODS\.includes/);
  });

  it("actions expose open/close, add/delete entries and a live register query", () => {
    assert.match(actions, /export async function getCashRegisters/);
    assert.match(actions, /export async function getOpenCashRegister/);
    assert.match(actions, /export async function getCashRegisterEntries/);
    assert.match(actions, /export async function openCashRegister/);
    assert.match(actions, /export async function closeCashRegister/);
    assert.match(actions, /export async function addCashRegisterEntry/);
    assert.match(actions, /export async function deleteCashRegisterEntry/);
    assert.match(actions, /A cash register is already open/);
    assert.match(actions, /This cash register is closed/);
  });

  it("cash register is an owner/manager/reception module with a nav entry", () => {
    assert.match(permissions, /"cash-register": ADMIN_FINANCE/);
    assert.match(permissions, /cashreg: "cash-register"/);
    assert.match(nav, /Cash Register/);
  });

  it("the client records entries, opens and closes the till", () => {
    assert.match(client, /\+ Add Entry/);
    assert.match(client, /Open Register/);
    assert.match(client, /Close Register/);
    assert.match(client, /Expected Cash on Hand/);
    assert.match(client, /Over \/ Short/);
  });
});

describe("cash register — EUR + note & coin breakdown (R12)", () => {
  const migration = readMigration("059_cash_register_eur_denominations.sql");
  const cashreg = fs.readFileSync(path.resolve(__dirname, "../lib/cashreg.ts"), "utf-8");
  const sanitize = fs.readFileSync(path.resolve(__dirname, "../lib/sanitize.ts"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/cashreg/CashRegisterClient.tsx"), "utf-8");

  it("migration adds EUR columns, counts jsonb and an EUR-aware currency check", () => {
    assert.match(migration, /opening_cash_eur_cents int not null default 0/);
    assert.match(migration, /closing_cash_eur_cents int/);
    assert.match(migration, /opening_counts jsonb/);
    assert.match(migration, /closing_counts jsonb/);
    assert.match(migration, /cash_register_entries_currency_check/);
    assert.match(migration, /currency in \('USD', 'MVR', 'EUR'\)/);
  });

  it("cashreg.ts knows EUR, three-currency totals and per-currency denominations", () => {
    assert.match(cashreg, /CASH_REGISTER_CURRENCIES/);
    assert.match(cashreg, /eurCents/);
    assert.match(cashreg, /export const DENOMINATIONS/);
    assert.match(cashreg, /export function countTotal/);
    assert.match(cashreg, /counted\.eurCents - expected\.eurCents/);
  });

  it("sanitizers accept EUR and note/coin counts", () => {
    assert.match(sanitize, /export function sanitizeCashCounts/);
    assert.match(sanitize, /export function validCurrency3Fallback/);
    assert.match(sanitize, /opening_counts_eur/);
    assert.match(sanitize, /closing_counts_eur/);
  });

  it("client counts notes & coins and shows three currencies", () => {
    assert.match(client, /DenominationCounter/);
    assert.match(client, /EUR/);
    assert.match(client, /opening_counts_usd/);
    assert.match(client, /closing_counts_eur/);
  });

  it("denomination quantities persist by d.id and survive the sanitizer", () => {
    const counter = fs.readFileSync(path.resolve(__dirname, "../app/admin/cashreg/DenominationCounter.tsx"), "utf-8");
    // The counter stores AND reads by the denomination id (e.g. "n10000"),
    // matching countTotal — never by the raw minor value string.
    assert.match(counter, /counts\[d\.id\]/);
    assert.doesNotMatch(counter, /counts\[String\(d\.minor\)\]/);
    assert.match(sanitize, /\^\[nc\]\\d\+\$|\^\\d\+\$/);
  });

  it("the client lets staff add an edit till note and shows it on the till + history", () => {
    const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
    assert.match(client, /updateCashRegisterNotes/);
    assert.match(actions, /export async function updateCashRegisterNotes/);
    assert.match(client, /Till Note/);
    assert.match(client, /Edit Note/);
    assert.match(client, /METHOD_BADGE/);
  });

  it("admin can open WhatsApp Web from the admin nav and quick-send from busy pages", () => {
    const whatsapp = fs.readFileSync(path.resolve(__dirname, "../lib/whatsapp.ts"), "utf-8");
    const nav = fs.readFileSync(path.resolve(__dirname, "../app/admin/AdminNav.tsx"), "utf-8");
    const modal = fs.readFileSync(path.resolve(__dirname, "../app/admin/components/WhatsAppSendModal.tsx"), "utf-8");
    assert.match(whatsapp, /web\.whatsapp\.com\/send/);
    assert.match(nav, /adminWhatsAppBtn/);
    assert.match(nav, /WhatsApp Web/);
    assert.match(modal, /Open WhatsApp Web/);
    assert.match(modal, /WHATSAPP_TEMPLATES/);
  });
});

describe("whatsapp auto-send via OpenWA (opt-in, never throws)", () => {
  it("auto-send gateway is opt-in via env vars and a safe no-op otherwise", () => {
    const sender = fs.readFileSync(path.resolve(__dirname, "../lib/whatsappSend.ts"), "utf-8");
    assert.match(sender, /OPENWA_URL/);
    assert.match(sender, /OPENWA_API_KEY/);
    assert.match(sender, /OPENWA_SESSION/);
    assert.match(sender, /export function isWhatsAppAutoSendConfigured/);
    assert.match(sender, /skipped: "not_configured"/);
    assert.match(sender, /AbortSignal\.timeout/);
  });

  it("booking confirm and crew assign fire best-effort auto-send, never throwing", () => {
    const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
    assert.match(actions, /import \{ sendWhatsAppText \} from "@\/lib\/whatsappSend"/);
    assert.match(actions, /notifyBookingConfirmed\(bookingId\)/);
    assert.match(actions, /await notifyTripCrewAssigned\(tripId, guideId, captainId\)/);
    assert.match(actions, /\/\/ messaging is advisory; ignore any failure/);
  });
});

describe("resend transactional email (opt-in, never throws)", () => {
  it("mailer is opt-in via RESEND_API_KEY and a safe no-op otherwise", () => {
    const sender = fs.readFileSync(path.resolve(__dirname, "../lib/mail.ts"), "utf-8");
    assert.match(sender, /RESEND_API_KEY/);
    assert.match(sender, /export function isEmailAutoSendConfigured/);
    assert.match(sender, /skipped: "not_configured"/);
    assert.match(sender, /api\.resend\.com\/emails/);
    assert.match(sender, /AbortSignal\.timeout/);
    assert.match(sender, /no-reply@send\.thoddoomarineexcursion\.com/);
    assert.match(sender, /reply_to: replyTo/);
  });

  it("booking confirm fires best-effort email next to WhatsApp, never throwing", () => {
    const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
    assert.match(actions, /import \{ sendEmail \} from "@\/lib\/mail"/);
    assert.match(actions, /customers\(full_name, phone, email\)/);
    assert.match(actions, /await sendEmail\(/);
    assert.match(actions, /if \(!phone && !email\) return/);
  });
});

describe("cash register denomination totals", () => {
  it("countTotal sums notes and coins per currency", () => {
    assert.equal(countTotal("USD", { "n10000": 1, "n100": 1, "c1": 4 }), 10104);
    assert.equal(countTotal("EUR", { "n50000": 1, "n100": 1, "c100": 2, "c1": 5 }), 50205);
    assert.equal(countTotal("MVR", { "n50000": 1, "n100": 1, "c1": 1 }), 50101);
  });

  it("countTotal ignores negatives and unknown keys", () => {
    assert.equal(countTotal("USD", { "n10000": -2, "n99999": 3 }), 0);
    assert.equal(countTotal("EUR", {}), 0);
  });

  it("three-currency over/short includes EUR", () => {
    const base = { opening_cash_usd_cents: 0, opening_cash_mvr_laari: 0, opening_cash_eur_cents: 5000 };
    const t = cashRegisterTotals(base, []);
    assert.equal(t.expectedCash.eurCents, 5000);
    const closed: any = { ...base, status: "closed", closing_cash_usd_cents: 0, closing_cash_mvr_laari: 0, closing_cash_eur_cents: 5999, id: "r", register_date: "2026-09-23", opened_at: "", closed_at: "" };
    const os = cashRegisterOverShort(closed, []);
    assert.equal(os!.eurCents, 999);
  });
});

describe("cash register totals logic", () => {
  const base = { opening_cash_usd_cents: 10000, opening_cash_mvr_laari: 0, opening_cash_eur_cents: 0 };
  const rows: {
    id: string; register_id: string; method: CashRegisterMethod; amount_cents: number; currency: string;
    reference: null; notes: null; booking_id: null; recorded_by: null; created_at: string;
  }[] = [
    { id: "1", register_id: "r", method: "cash", amount_cents: 5000, currency: "USD", reference: null, notes: null, booking_id: null, recorded_by: null, created_at: "" },
    { id: "2", register_id: "r", method: "card", amount_cents: 2000, currency: "USD", reference: null, notes: null, booking_id: null, recorded_by: null, created_at: "" },
    { id: "3", register_id: "r", method: "bank_transfer", amount_cents: 3000, currency: "USD", reference: null, notes: null, booking_id: null, recorded_by: null, created_at: "" },
    { id: "4", register_id: "r", method: "bill", amount_cents: 4000, currency: "USD", reference: null, notes: null, booking_id: null, recorded_by: null, created_at: "" },
    { id: "5", register_id: "r", method: "expense", amount_cents: 1500, currency: "USD", reference: null, notes: null, booking_id: null, recorded_by: null, created_at: "" },
  ];

  it("income counts cash+card+bank+bill, cash-out is expenses", () => {
    const t = cashRegisterTotals(base, rows);
    assert.equal(t.income.usdCents, 5000 + 2000 + 3000 + 4000);
    assert.equal(t.cashIn.usdCents, 5000);
    assert.equal(t.cashOut.usdCents, 1500);
  });

  it("expected cash = float + cash in − cash out", () => {
    const t = cashRegisterTotals(base, rows);
    assert.equal(t.expectedCash.usdCents, 10000 + 5000 - 1500);
  });

  it("over/short = counted closing − expected, only when closed", () => {
    const t = cashRegisterTotals(base, rows).expectedCash;
    const closed: any = { ...base, status: "closed", closing_cash_usd_cents: t.usdCents + 750, closing_cash_mvr_laari: 0, id: "r", register_date: "2026-09-23", opened_at: "", closed_at: "" };
    const os = cashRegisterOverShort(closed, rows);
    assert.equal(os!.usdCents, 750);
    const open = { ...closed, status: "open" };
    assert.equal(cashRegisterOverShort(open, rows), null);
  });
});

describe("cash register reconciliation — till cash vs cash vs bookings", () => {
  it("flags a gap when cash was taken on a booking but never entered the till", () => {
    const rec = reconcileCashAgainstPayments(
      [{ amount_cents: 8500, currency: "USD" }],
      []
    );
    assert.equal(rec.perCurrency.USD.paymentsCents, 8500);
    assert.equal(rec.perCurrency.USD.tillCents, 0);
    assert.equal(rec.perCurrency.USD.gapCents, -8500);
    assert.deepEqual(rec.mismatchedCurrencies, ["USD"]);
    assert.equal(isCashReconciled(rec), false);
  });

  it("agrees when the till holds exactly the cash paid against bookings", () => {
    const rec = reconcileCashAgainstPayments(
      [{ amount_cents: 8500, currency: "USD" }, { amount_cents: 160000, currency: "MVR" }],
      [
        { method: "cash", amount_cents: 8500, currency: "USD", booking_id: "b1" },
        { method: "cash", amount_cents: 160000, currency: "MVR", booking_id: "b2" },
      ]
    );
    assert.deepEqual(rec.mismatchedCurrencies, []);
    assert.equal(isCashReconciled(rec), true);
    assert.equal(rec.linkedEntryCount, 2);
    assert.equal(rec.cashPaymentCount, 2);
    assert.equal(rec.tillCashEntryCount, 2);
  });

  it("ignores card, bank transfer, bill and cash-out entries", () => {
    const rec = reconcileCashAgainstPayments(
      [{ amount_cents: 5000, currency: "USD" }],
      [
        { method: "card", amount_cents: 5000, currency: "USD", booking_id: null },
        { method: "bank_transfer", amount_cents: 5000, currency: "USD", booking_id: null },
        { method: "bill", amount_cents: 5000, currency: "USD", booking_id: null },
        { method: "expense", amount_cents: 5000, currency: "USD", booking_id: null },
      ]
    );
    assert.equal(rec.perCurrency.USD.tillCents, 0);
    assert.equal(rec.tillCashEntryCount, 0);
    assert.deepEqual(rec.mismatchedCurrencies, ["USD"]);
  });

  it("keeps currencies separate and tolerates null amounts/currencies", () => {
    const rec = reconcileCashAgainstPayments(
      [{ amount_cents: null, currency: null }, { amount_cents: 4500, currency: "EUR" }],
      [{ method: "cash", amount_cents: 4500, currency: "EUR", booking_id: null }]
    );
    assert.equal(rec.perCurrency.EUR.gapCents, 0);
    assert.deepEqual(rec.mismatchedCurrencies, []);
  });
});

describe("till income — daily sales, not drawer entries", () => {
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const page = fs.readFileSync(path.resolve(__dirname, "../app/admin/cashreg/page.tsx"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/cashreg/CashRegisterClient.tsx"), "utf-8");

  it("splits received payments across USD, MVR and EUR", () => {
    const t = salesPerCurrency([
      { amount_cents: 2000, currency: "USD" },
      { amount_cents: 160000, currency: "MVR" },
      { amount_cents: 4500, currency: "EUR" },
    ]);
    assert.equal(t.usdCents, 2000);
    assert.equal(t.mvrLaari, 160000);
    assert.equal(t.eurCents, 4500);
  });

  it("an empty day is zero in all three currencies", () => {
    assert.deepEqual(salesPerCurrency([]), ZERO_CURRENCY);
    assert.deepEqual(salesPerCurrency([{ amount_cents: null, currency: null }]), ZERO_CURRENCY);
  });

  it("a day with sales and no typed-in entries still has income", () => {
    // The real production shape: float opened, no "+ Add Entry" ever used,
    // so the drawer's own income is zero while payments came in.
    const drawer = cashRegisterTotals(
      { opening_cash_usd_cents: 13000, opening_cash_mvr_laari: 32500, opening_cash_eur_cents: 4500 },
      []
    );
    assert.equal(drawer.income.usdCents, 0);
    assert.equal(salesPerCurrency([{ amount_cents: 2000, currency: "USD" }]).usdCents, 2000);
  });

  it("getDailySales counts every method of completed payments", () => {
    const at = actions.indexOf("export async function getDailySales");
    assert.ok(at > -1, "getDailySales must exist");
    const body = actions.slice(at, at + 2000);
    assert.match(body, /\.from\("payments"\)/);
    assert.match(body, /\.select\("amount_cents, currency, method, created_at"\)/);
    assert.match(body, /\.eq\("status", "completed"\)/);
    assert.doesNotMatch(body, /\.eq\("method"/);
    assert.match(body, /maldivesDateOf\(p\.created_at\)/);
    assert.match(body, /income: salesPerCurrency\(rows\), cash: cashPerCurrency\(rows\)/);
  });

  it("the cash register page and client read income from those sales", () => {
    assert.match(page, /getDailySales/);
    assert.match(client, /incomeFor\(String\(open\.register_date\)/);
    assert.match(client, /incomeFor\(r\.register_date/);
    // Falls back to the drawer's entries only when the sales query failed.
    assert.match(client, /if \(!dailySales\) return null/);
  });

  it("only cash payments reach the drawer", () => {
    const cash = cashPerCurrency([
      { amount_cents: 8500, currency: "USD", method: "cash" },
      { amount_cents: 5000, currency: "USD", method: "card" },
      { amount_cents: 160000, currency: "MVR", method: "cash" },
      { amount_cents: 3000, currency: "EUR", method: "bank_transfer" },
      { amount_cents: 9000, currency: "EUR", method: "bill" },
    ]);
    assert.equal(cash.usdCents, 8500);
    assert.equal(cash.mvrLaari, 160000);
    assert.equal(cash.eurCents, 0);
  });

  it("cash received and expected cash rise with the day's cash payments", () => {
    // Production shape: float 130/325/45, no drawer entries, one $20 cash sale.
    const base = { opening_cash_usd_cents: 13000, opening_cash_mvr_laari: 32500, opening_cash_eur_cents: 4500 };
    const empty = cashRegisterTotals(base, []);
    assert.equal(empty.cashIn.usdCents, 0);
    assert.equal(empty.expectedCash.usdCents, 13000);

    const withCash = cashRegisterTotals(base, [], { usdCents: 2000, mvrLaari: 0, eurCents: 0 });
    assert.equal(withCash.cashIn.usdCents, 2000);
    assert.equal(withCash.expectedCash.usdCents, 15000);
    assert.equal(withCash.expectedCash.mvrLaari, 32500);
    assert.equal(withCash.expectedCash.eurCents, 4500);
  });

  it("a booking-linked drawer entry is not counted on top of its payment", () => {
    const base = { opening_cash_usd_cents: 0, opening_cash_mvr_laari: 0, opening_cash_eur_cents: 0 };
    const linked = {
      id: "1", register_id: "r", method: "cash" as CashRegisterMethod, amount_cents: 5000,
      currency: "USD", reference: null, notes: null, booking_id: "b1", recorded_by: null, created_at: "",
    };
    const adhoc = { ...linked, id: "2", booking_id: null };
    const paymentCash = { usdCents: 5000, mvrLaari: 0, eurCents: 0 };
    // The payment and the linked entry are the same $50.
    assert.equal(cashRegisterTotals(base, [linked], paymentCash).cashIn.usdCents, 5000);
    // Ad-hoc drawer cash the books don't know about is extra.
    assert.equal(cashRegisterTotals(base, [adhoc], paymentCash).cashIn.usdCents, 10000);
    // And the closing over/short is judged against that same expected figure.
    const closed: any = { ...base, status: "closed", closing_cash_usd_cents: 5000, closing_cash_mvr_laari: 0, closing_cash_eur_cents: 0, id: "r", register_date: "2026-10-08", opened_at: "", closed_at: "" };
    assert.equal(cashRegisterOverShort(closed, [linked], paymentCash)!.usdCents, 0);
  });

  it("the till card feeds payments cash into Cash Received and Expected", () => {
    assert.match(client, /cashRegisterTotals\(open as never, openEntries as never, /);
    assert.match(client, /triple\(openTotals\.cashIn\)/);
    assert.match(client, /triple\(openTotals\.expectedCash\)/);
    assert.match(client, /cashRegisterOverShort\(r as never, entries, cashFromPayments\)/);
    assert.match(client, /expected=\{openTotals\.expectedCash\}/);
  });
});

describe("walk-in multi-activity group booking v2 (060)", () => {
  const migration = readMigration("060_walkin_multi_activity_group_v2.sql");

  it("v2 submit RPC writes per-item date/time onto each booking", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(migration, /p_items\s+JSONB/);
    assert.match(migration, /v_item->>'booking_date'/);
    assert.match(migration, /v_item->>'preferred_time'/);
    assert.match(migration, /COALESCE\(v_item->>'booking_date', p_booking_date\)/);
  });

  it("per-participant rows carry own identity, guardian and choice_token", () => {
    assert.match(migration, /INSERT INTO public\.booking_participants/);
    assert.match(migration, /booking_id/);
    assert.match(migration, /full_name/);
    assert.match(migration, /participant_type/);
    assert.match(migration, /guardian_name/);
    assert.match(migration, /choice_token/);
  });

  it("writes bookings against the real schema columns (guests / children_count / booking_currency)", () => {
    assert.match(migration, /INSERT INTO public\.bookings \(\n\s*customer_id, activity_id, source, status, guests,\n\s*adults, children_count,/);
    assert.match(migration, /children_count,/);
    assert.match(migration, /booking_currency/);
    assert.match(migration, /'guest_count', \(b\.adults \+ b\.children_count\),/);
    assert.doesNotMatch(migration, /, children,\n/);
    assert.doesNotMatch(migration, /currency, booking_ref, group_id/);
  });

  it("anon can read the participant list back for the signing step", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_walkin_group_participants/);
    assert.match(migration, /choice_token/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_walkin_group_participants\(TEXT\) TO anon/);
  });

  it("sanitize.ts exports the v2 items builder with shared pax/item caps", () => {
    const sanitize = fs.readFileSync(path.resolve(__dirname, "../lib/sanitize.ts"), "utf-8");
    assert.match(sanitize, /export function sanitizeWalkinItemsV2/);
    assert.match(sanitize, /slice\(0, 8\)/);
    assert.match(sanitize, /participant_type === "child"/);
    assert.match(sanitize, /guardian_name/);
    assert.match(sanitize, /participants\.slice\(0, 50\)/);
    assert.doesNotMatch(sanitize, /choice_token/); // choice_token is server-generated (060), never trusted from the client
  });

  it("keeps v1 capacity limits (8 items / 50 pax)", () => {
    assert.match(migration, /pax > 50|50 pax|jsonb_array_length\(v_items\) > 8|> 8/);
  });
});

describe("walk-in wizard — INCR-1 multi-activity client (v2 items state)", () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );

  it("calls submit_public_booking_group_v2 with a p_items array for multi-activity groups", () => {
    assert.match(client, /submit_public_booking_group_v2/);
    assert.match(client, /p_items:\s*sanitized\.items\.map/);
    assert.match(client, /items\.slice\(0, MAX_GROUP_ITEMS\)\.map/);
    assert.match(client, /activity_id: it\.activityId/);
  });

  it("carries each item's OWN booking_date + preferred_time into p_items", () => {
    assert.match(client, /booking_date: it\.bookingDate/);
    assert.match(client, /preferred_time: it\.preferredTime/);
  });

  it("collects multiple activities with per-item date/time in state (cap 8)", () => {
    assert.match(client, /const MAX_GROUP_ITEMS = 8;/);
    assert.match(client, /interface WalkinItemDraft/);
    assert.match(client, /bookingDate: string;/);
    assert.match(client, /preferredTime: string;/);
    assert.match(client, /items\.length >= MAX_GROUP_ITEMS/);
  });

  it("routes single-activity walk-ins through group_v2 so each participant signs (064)", () => {
    assert.match(client, /submit_public_booking_group_v2/);
    assert.match(client, /p_items:\s*sanitized\.items\.map/);
    assert.match(client, /participants: partyRows\(\)/);
    assert.doesNotMatch(client, /\.rpc\("submit_public_booking"/);
  });

  it("exposes a live activity catalogue so a guest can add more activities", () => {
    assert.match(client, /catalogue\?: WalkinCatalogItem\[\]/);
    assert.match(client, /availableActivities/);
    const page = fs.readFileSync(
      path.resolve(__dirname, "../app/walkin/[activitySlug]/page.tsx"),
      "utf-8"
    );
    assert.match(page, /getPublicAllActivities/);
    assert.match(page, /catalogue=\{catalogue\}/);
  });
});

describe("walk-in wizard + admin QR — staff multi-trip link pre-seed", () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );
  const modal = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/bookings/WalkinQRModal.tsx"),
    "utf-8"
  );
  const page = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/page.tsx"),
    "utf-8"
  );

  it("QR modal lets staff tick one or more trips instead of a single dropdown", () => {
    assert.match(modal, /type="checkbox"/);
    assert.match(modal, /tick one or more/);
    assert.match(modal, /chosen\.length === 1/);
    assert.match(modal, /chosen\.length}/);
    assert.doesNotMatch(modal, /<select[\s\S]*Choose activity/);
  });

  it("combining trips builds one pre-seeded link (?activities=)", () => {
    assert.match(modal, /activities=/);
    assert.match(modal, /encodeURIComponent\(rest\.join\(","\)\)/);
    assert.match(modal, /MAX_SELECTED = 8/);
    assert.match(modal, /selected\.length >= MAX_SELECTED/);
  });

  it("wizard reads the shared link and pre-fills the extra trips (cap 8)", () => {
    assert.match(client, /params\.get\("activities"\)/);
    assert.match(client, /MAX_GROUP_ITEMS/);
    assert.match(client, /merged\.length >= MAX_GROUP_ITEMS/);
    assert.match(client, /setItems\(merged\)/);
    assert.match(page, /slug: a\.slug,/);
  });
});

describe("walk-in wizard — INCR-2 party builder + per-participant rows (client sanitizer)", () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );

  it("invokes sanitizeWalkinItemsV2 on the client before submitting v2 items", () => {
    assert.match(client, /import \{ sanitizeWalkinItemsV2 \} from "@\/lib\/sanitize"/);
    assert.match(client, /sanitizeWalkinItemsV2\(\{ items: draftItems \}\)/);
    assert.match(client, /sanitized\.items\.map/);
  });

  it("builds a per-participant row editor (name + adult/child type + guardian)", () => {
    assert.match(client, /interface WalkinParticipantDraft/);
    assert.match(client, /participantType: "adult" \| "child"/);
    assert.match(client, /guardianName/);
    assert.match(client, /guardianRelationship/);
    assert.match(client, /<option value="child">Child<\/option>/);
  });

  it("requires guardian name + relationship for every child participant", () => {
    assert.match(client, /participantType === "child" && !p\.guardianName\.trim\(\)/);
    assert.match(client, /participantType === "child" && !p\.guardianRelationship\.trim\(\)/);
  });

  it("caps the party at 50 pax and ALWAYS books a lead participant row — even a solo guest is asked for consent", () => {
    assert.match(client, /const MAX_PARTY = 50;/);
    assert.match(client, /Math\.min\(MAX_PARTY, Math\.max\(1,/);
    assert.match(client, /partySize === 1/);
    assert.doesNotMatch(client, /if \(partySize <= 1\) return \[\];/);
    assert.match(client, /const rows: Array<\{/);
    assert.match(client, /full_name: guestName\.trim\(\),/);
    assert.match(client, /if \(partySize > 1\)/);
  });

  it("attaches the shared participant roster to every v2 item and omits blank lists", () => {
    assert.match(client, /participants: partyRows\(\)/);
    assert.match(client, /it\.participants\.length > 0/);
    assert.match(client, /participants: it\.participants,/);
  });

  it("derives the p_adults / p_children counts from the participant rows", () => {
    assert.match(client, /childrenCount = extraParticipants\.filter/);
    assert.match(client, /adultsCount = partySize - childrenCount/);
    assert.match(client, /p_adults: adultsCount,/);
    assert.match(client, /p_children: childrenCount,/);
  });
});

describe("walk-in wizard — INCR-3 per-participant consent (migration 061 + client)", () => {
  const migration = readMigration("061_walkin_participant_consent.sql");
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );
  const checkin = fs.readFileSync(
    path.resolve(__dirname, "../app/checkin/[token]/CheckinClient.tsx"),
    "utf-8"
  );

  it("adds an anon per-participant consent RPC keyed by choice_token", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.submit_walkin_participant_consent/);
    assert.match(migration, /p_choice_token\s+TEXT/);
    assert.match(migration, /p_phone\s+TEXT/);
    assert.match(migration, /WHERE bp\.choice_token = p_choice_token/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.submit_walkin_participant_consent/);
    assert.match(migration, /TO anon/);
  });

  it("records the consent as per-participant, not per-booking", () => {
    assert.match(migration, /v_booking\.booking_ref,\n\s*v_participant\.full_name,/);
    assert.match(migration, /SET consent_status = 'signed',\n\s*consent_form_id = v_consent_id/);
    assert.match(migration, /guest_name,\n/);
    assert.match(migration, /'guest_checkin'/);
    // signing one participant cascades to their other rows in the same group
    assert.match(migration, /cascade to the same person's other rows in the group/i);
    assert.match(migration, /full_name = v_participant\.full_name/);
    assert.match(migration, /b2\.group_id = v_booking\.group_id/);
  });

  it("requires parent/guardian name + relationship + signature for children", () => {
    assert.match(migration, /v_participant\.participant_type = 'child'/);
    assert.match(migration, /Parent\/guardian name is required for minors/);
    assert.match(migration, /Guardian relationship is required for minors/);
    assert.match(migration, /Parent\/guardian signature is required for minors/);
  });

  it("mirrors the check-in consent step's choice_token usage on the client", () => {
    const checkinUsesChoice = /p_choice_token:\s*selectedParticipant\.choice_token/;
    assert.match(checkin, checkinUsesChoice);
    // the walk-in client fetches its own roster by group ref, then signs ONE
    // participant per choice_token — same opaque-token pattern as check-in.
    assert.match(client, /get_walkin_group_participants/);
    assert.match(client, /p_group_ref:\s*groupResult\.group_ref/);
    assert.match(client, /p_choice_token:\s*p\.choice_token/);
    assert.match(client, /submit_walkin_participant_consent/);
  });

  it("iterates every participant (one signing call per choice_token) and gates the success screen", () => {
    assert.match(client, /groupParticipants\.map\(\(p\) =>/);
    assert.match(client, /key=\{p\.choice_token\}/);
    assert.match(client, /signedTokens/);
    assert.match(client, /groupConsentDone/);
  });

  it("dedupes the roster per person so 2 guests + N trips never re-signs per booking", () => {
    assert.match(client, /\.filter\(\(p\) => !!p\.choice_token\)/);
    assert.match(client, /full_name\}\\u0000/);
    assert.match(client, /Consent is per PERSON, not per booking/);
  });

  it("reuses the consent-step signature canvas for each participant", () => {
    assert.match(client, /import SignCanvas from "@\/app\/rental\/\[token\]\/SignCanvas"/);
    assert.match(client, /<SignCanvas/);
    assert.match(client, /get_active_consent_template/);
  });

  it("requires a guardian + signature block for child participants client-side", () => {
    assert.match(client, /p\.participant_type === "child"/);
    assert.match(client, /guardianSignature/);
  });
});

describe("walk-in wizard — INCR-4 success screen (group_ref + pay at counter)", () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );

  it("shows the success card only after every participant signed", () => {
    assert.match(client, /if \(groupResult && groupConsentDone\)/);
  });

  it("renders the group reference on the success screen", () => {
    assert.match(client, /Group reference:/);
    assert.match(client, /<strong>\{groupResult\.group_ref\}<\/strong>/);
  });

  it("renders the group_ref from the v2 submit response, not a single booking ref", () => {
    assert.match(client, /group_ref: \(r\.group_ref as string\) \|\| ""/);
    assert.match(client, /it\.booking_ref/);
  });

  it("tells the guest to pay at the counter, driven by needs_per_participant_details", () => {
    assert.match(client, /Pay at the counter on arrival/);
    assert.match(client, /\{groupResult\.needs_per_participant_details/);
    assert.match(
      client,
      /every participant&apos;s consent has been signed/
    );
  });

  it("lists every booked activity with its own ref/date/time", () => {
    assert.match(client, /groupResult\.items\.map\(\(it\) =>/);
    assert.match(client, /it\.booking_ref/);
    assert.match(client, /it\.booking_date/);
    assert.match(client, /it\.preferred_time/);
  });

  it("single-activity walk-ins share the group success screen (per-participant signing)", () => {
    assert.match(client, /if \(groupResult && groupConsentDone\)/);
    assert.match(client, /Group reference:/);
    assert.doesNotMatch(client, /result\.booking_ref/);
    assert.doesNotMatch(client, /consentDone/);
  });
});

describe("walk-in wizard — INCR-5 full integration (client flow + backend wiring)", () => {
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"),
    "utf-8"
  );
  const v2 = readMigration("060_walkin_multi_activity_group_v2.sql");
  const consent = readMigration("061_walkin_participant_consent.sql");

  it("validates items client-side before the group submit RPC, in order", () => {
    const sanitizer = client.indexOf("sanitizeWalkinItemsV2({");
    const groupSubmit = client.indexOf('.rpc("submit_public_booking_group_v2"');
    assert.ok(sanitizer > -1, "sanitizeWalkinItemsV2 must be called");
    assert.ok(groupSubmit > -1, "group submit RPC must be called");
    assert.ok(sanitizer < groupSubmit, "sanitizer runs before the group submit");
    assert.match(
      client,
      /sanitized\.items\.length === 0\) \{\n\s*setFormError\("Please check the selected activities and try again\."\)/
    );
  });

  it("roster fetch is gated on the group result and runs one consent call per choice_token", () => {
    assert.match(client, /if \(!groupResult \|\| groupConsentDone\) return;/);
    assert.match(client, /\[groupResult\?\.group_ref, groupConsentDone\]/);
    assert.match(client, /\.rpc\("get_walkin_group_participants"/);
    assert.match(client, /\.rpc\("submit_walkin_participant_consent"/);
    assert.match(client, /p_choice_token:\s*p\.choice_token/);
    assert.match(client, /for \(const p of groupParticipants\)/);
    assert.match(client, /await signParticipant\(p\)/);
  });

  it("signs the consent with the lead phone as the auth key (matches migration 061)", () => {
    assert.match(client, /p_phone:\s*guestPhone\.trim\(\)/);
    assert.match(consent, /plpgsql SECURITY DEFINER\n\s*SET search_path = public/);
    assert.match(consent, /regexp_replace\(trim\(p_phone\)/);
    assert.match(consent, /right\(regexp_replace\(v_customer\.phone/);
  });

  it("success screen is gated on all consents signed and shows group_ref + pay at counter", () => {
    assert.match(client, /if \(groupResult && groupConsentDone\)/);
    const gate = client.indexOf("if (groupResult && groupConsentDone)");
    const pay = client.indexOf("Pay at the counter on arrival");
    assert.ok(gate > -1 && pay > gate, "pay-at-counter copy lives after the success gate");
  });

  it("backend grants line up with the three anon entrypoints the client calls", () => {
    assert.match(v2, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(v2, /GRANT EXECUTE ON FUNCTION public\.get_walkin_group_participants\(TEXT\) TO anon/);
    assert.match(v2, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2[\s\S]*TO authenticated/);
    assert.match(v2, /GRANT EXECUTE ON FUNCTION public\.get_walkin_group_participants\(TEXT\) TO authenticated/);
    assert.match(consent, /GRANT EXECUTE ON FUNCTION public\.submit_walkin_participant_consent/);
    assert.match(consent, /TO anon/);
    assert.match(consent, /TO authenticated/);
    // both walk-in RPC migrations landed AFTER the base schema that defines
    // booking_participants (010) — the FK column the wizard writes is booking_id.
    assert.match(v2, /INSERT INTO public\.booking_participants \(\n\s*booking_id/);
  });

  it("single-activity submissions always use submit_public_booking_group_v2 (no v1 fallback)", () => {
    assert.match(client, /const isGroup = items\.length > 1/);
    assert.doesNotMatch(client, /\.rpc\("submit_public_booking"/);
    assert.doesNotMatch(client, /idempotencyKey\.current/);
  });
});

describe("migration 062 — consent & liability gates + booking integrity", () => {
  const sql = readMigration("062_consent_gates_and_booking_integrity.sql");

  it("requires every booking to record guest agreement (before insert)", () => {
    assert.match(sql, /enforce_booking_agreement/);
    assert.match(sql, /NEW\.guest_agreed IS NOT TRUE/);
    assert.match(sql, /RAISE EXCEPTION/);
    assert.match(sql, /BEFORE INSERT ON public\.bookings/);
    assert.match(sql, /guest_agreed_at := COALESCE\(NEW\.guest_agreed_at, now\(\)\)/);
    assert.match(sql, /agreement_version := COALESCE/);
  });

  it("recreates submit_public_booking_group_v2 with the agreement gate and stored terms", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(sql, /IF p_guest_agreed IS NOT TRUE THEN/);
    assert.match(sql, /guest_agreed,\s*guest_agreed_at,\s*agreement_version/);
    assert.match(sql, /true, now\(\), 'booking-enquiry-v1'/);
  });

  it("blocks confirmation of participant bookings until every participant signed", () => {
    assert.match(sql, /enforce_booking_confirm_consent/);
    assert.match(sql, /NEW\.status = 'confirmed' AND OLD\.status IS DISTINCT FROM 'confirmed'/);
    assert.match(sql, /bp\.consent_status <> 'signed'/);
    assert.match(sql, /BEFORE UPDATE OF status ON public\.bookings/);
  });

  it("migration 063 relaxes the confirm gate to group bookings only", () => {
    const fix = readMigration("063_fix_confirm_gate_group_only.sql");
    assert.match(fix, /CREATE OR REPLACE FUNCTION public\.enforce_booking_confirm_consent/);
    assert.match(fix, /IF NEW\.group_id IS NOT NULL THEN/);
    // single-activity consents must never be blocked by placeholder participants
    assert.match(fix, /NEW\.group_id IS NOT NULL/);
  });

  it("voids all linked consent & liability forms on cancel (records kept)", () => {
    assert.match(sql, /void_consent_on_booking_cancel/);
    assert.match(sql, /NEW\.status = 'cancelled' AND OLD\.status IS DISTINCT FROM 'cancelled'/);
    assert.match(sql, /UPDATE public\.consent_forms/);
    assert.match(sql, /status = 'voided'/);
    assert.match(sql, /void_reason/);
    assert.match(sql, /voided_at = now\(\)/);
    assert.match(sql, /status IN \('pending', 'signed'\)/);
    assert.match(sql, /current_staff_id/);
  });

  it("staff createBooking requires the guest agreement before insert", () => {
    const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
    assert.match(actions, /if \(!clean\.guest_agreed\)/);
    assert.match(actions, /consent & liability/i);
    assert.match(actions, /guest_agreed_at: new Date\(\)\.toISOString\(\)/);
    assert.match(actions, /agreement_version: "booking-enquiry-v1"/);
  });

  it("the admin booking form surfaces a required consent tick", () => {
    const form = fs.readFileSync(path.resolve(__dirname, "../app/admin/bookings/BookingForm.tsx"), "utf-8");
    assert.match(form, /guestAgreed/);
    assert.match(form, /Confirm the guest agreed to the Consent & Liability/i);
    assert.match(form, /guest_agreed: guestAgreed/);
  });
});

describe("migration 064 — cash-register-open gate + unified walk-in single consent", () => {
  const sql = readMigration("064_cash_register_gate_and_walkin_single_consent.sql");
  const groupRef = readMigration("062_consent_gates_and_booking_integrity.sql");

  it("adds a SECURITY DEFINER is_cash_register_open() keyed to UTC today + status open", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_cash_register_open\(\)/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /register_date = \(now\(\) AT TIME ZONE 'UTC'\)::DATE/);
    assert.match(sql, /status = 'open'/);
  });

  it("blocks walk-in booking creation while the register is closed (BEFORE INSERT)", () => {
    assert.match(sql, /enforce_walkin_register_open_on_create/);
    assert.match(sql, /NEW\.source = 'walk_in' AND NOT public\.is_cash_register_open\(\)/);
    assert.match(sql, /BEFORE INSERT ON public\.bookings/);
    assert.match(sql, /RAISE EXCEPTION/);
  });

  it("requires an open register for ANY transition to confirmed (all sources)", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_booking_confirm_consent/);
    assert.match(sql, /IF NOT public\.is_cash_register_open\(\) THEN/);
    assert.match(sql, /NEW\.status = 'confirmed' AND OLD\.status IS DISTINCT FROM 'confirmed'/);
    // 063's group-only per-participant gate is preserved
    assert.match(sql, /IF NEW\.group_id IS NOT NULL THEN/);
    assert.match(sql, /bp\.consent_status <> 'signed'/);
  });

  it("recreates submit_public_booking_group_v2 with a friendly walk_in register gate", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(sql, /v_src = 'walk_in' AND NOT public\.is_cash_register_open\(\)/);
    assert.match(sql, /'register_closed'/);
    // the 062 agreement gate + participant insert are carried over verbatim
    assert.match(sql, /IF p_guest_agreed IS NOT TRUE THEN/);
    assert.match(sql, /INSERT INTO public\.booking_participants \(\n\s*booking_id/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2/);
  });

  it("online (website) submissions are never blocked at creation — gate keys on walk_in only", () => {
    assert.match(sql, /NEW\.source = 'walk_in'/);
    assert.match(sql, /v_src = 'walk_in' AND NOT public\.is_cash_register_open\(\)/);
    assert.doesNotMatch(sql, /NEW\.source = 'online'/);
  });
});

describe("migration 065 — auto-complete bookings on trip return + backfill", () => {
  const sql = readMigration("065_auto_complete_on_return.sql");

  it("adds an internal SECURITY DEFINER auto_complete_trip_bookings helper", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.auto_complete_trip_bookings/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /WHERE trip_id = p_trip_id[\s\S]*AND status = 'confirmed'/);
    assert.match(sql, /SET status = 'completed'/);
  });

  it("ops board 'Returned' (update_trip_status) auto-completes confirmed bookings", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_trip_status/);
    assert.match(sql, /IF p_status = 'returned' THEN/);
    assert.match(sql, /v_closed := public\.auto_complete_trip_bookings\(p_trip_id\)/);
    assert.match(sql, /'completed', COALESCE\(v_closed, 0\)/);
  });

  it("reception last-guest return (set_manifest_return) auto-completes the trip", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_manifest_return/);
    assert.match(sql, /IF v_outstanding = 0 THEN/);
    assert.match(sql, /v_closed := public\.auto_complete_trip_bookings\(v_manifest\.trip_id\)/);
  });

  it("backfills confirmed bookings on trips already marked returned", () => {
    assert.match(sql, /UPDATE public\.bookings b/);
    assert.match(sql, /t\.status = 'returned'/);
    assert.match(sql, /b\.status = 'confirmed'/);
    assert.match(sql, /SET status = 'completed'/);
  });
});

describe("role-based access — approved matrix (owner = super admin)", () => {
  const permissions = fs.readFileSync(path.resolve(__dirname, "../lib/permissions.ts"), "utf-8");
  const middleware = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/middleware.ts"), "utf-8");

  it("owner sees every module (A–Z)", () => {
    const ownerGrants = ["dashboard", "operations", "trips", "manifests", "reception", "boats",
      "crew", "equipment", "bookings", "reports", "report", "activities", "customers",
      "consents", "rentals", "payments", "invoices", "expenses", "cash-register",
      "incidents", "staff", "tasks", "content", "orientation"];
    for (const m of ownerGrants) {
      const re = new RegExp(`["']?${m}["']?: (ALL_STAFF|FIELD_OPS|ADMIN_FINANCE|ADMIN|OPS_WRITE|OWNER_ONLY)`);
      assert.ok(re.test(permissions), `${m} module listed`);
    }
  });

  it("manager keeps everything except staff + content", () => {
    assert.match(permissions, /staff: OWNER_ONLY/);
    assert.match(permissions, /content: OWNER_ONLY/);
    assert.doesNotMatch(permissions, /staff: FIELD_OPS/);
    assert.doesNotMatch(permissions, /content: \["owner", "manager"\]/);
  });

  it("boat_crew is restricted to operations/trips/manifests/tasks/incidents only", () => {
    assert.match(permissions, /dashboard: ALL_STAFF/);
    assert.match(permissions, /operations: ALL_STAFF/);
    assert.match(permissions, /trips: ALL_STAFF/);
    assert.match(permissions, /manifests: ALL_STAFF/);
    assert.match(permissions, /reception: FIELD_OPS/);
    assert.match(permissions, /boats: FIELD_OPS/);
    assert.match(permissions, /bookings: FIELD_OPS/);
    assert.match(permissions, /payments: ADMIN_FINANCE/);
    assert.match(permissions, /customers: ADMIN_FINANCE/);
    assert.match(permissions, /cash-register": ADMIN_FINANCE/);
  });

  it("watersports staff keeps ops + fleet + rentals + bookings, not finance", () => {
    assert.match(permissions, /reception: FIELD_OPS/);
    assert.match(permissions, /boats: FIELD_OPS/);
    assert.match(permissions, /crew: FIELD_OPS/);
    assert.match(permissions, /bookings: FIELD_OPS/);
    assert.match(permissions, /rentals: OPS_WRITE/);
    assert.match(permissions, /equipment: OPS_WRITE/);
    assert.doesNotMatch(permissions, /payments: ALL_STAFF/);
    assert.doesNotMatch(permissions, /customers: ALL_STAFF/);
  });

  it("the middleware still enforces per-module route access", () => {
    assert.match(middleware, /canAccess\(role, module\)/);
    assert.match(middleware, /current_staff_role/);
  });
});

describe("edit forms remount per edited row (blank-edit fix)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf-8");
  const staff = read("../app/admin/staff/StaffPageClient.tsx");
  const equipment = read("../app/admin/equipment/EquipmentPageClient.tsx");
  const activities = read("../app/admin/activities/ActivityPageClient.tsx");
  const customers = read("../app/admin/customers/CustomerPageClient.tsx");
  const expenses = read("../app/admin/expenses/ExpensePageClient.tsx");

  it("each edit form is keyed on the edited row id so fields populate", () => {
    assert.match(staff, /key=\{editingStaff \? String\(editingStaff\.id\) : "new"\}/);
    assert.match(equipment, /key=\{editingEquipment \? String\(editingEquipment\.id\) : "new"\}/);
    assert.match(activities, /key=\{editingActivity \? String\(editingActivity\.id\) : "new"\}/);
    assert.match(customers, /key=\{editingCustomer \? String\(editingCustomer\.id\) : "new"\}/);
    assert.match(expenses, /key=\{editing \? String\(editing\.id\) : "new"\}/);
  });
});

describe("migration 066 — online enquiry consent gate (drop legacy RPCs)", () => {
  const sql = readMigration("066_online_enquiry_consent_gate.sql");

  it("cancels the booking that slipped through the legacy online path and releases it from trips", () => {
    assert.match(sql, /booking_ref = 'OB-260928-E90D'/);
    assert.match(sql, /DELETE FROM public\.trip_manifest WHERE booking_id = v_id/);
    assert.match(sql, /SET status = 'cancelled'/);
    assert.match(sql, /trip_id = NULL/);
    assert.match(sql, /status <> 'cancelled'/);
  });

  it("drops the legacy single-activity submit_public_booking (15-arg signature)", () => {
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.submit_public_booking\(/);
    assert.match(sql, /UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT/);
  });

  it("drops the legacy group submit_public_booking_group (14-arg signature)", () => {
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.submit_public_booking_group\(/);
    assert.match(sql, /JSONB, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT/);
  });

  it("recreates submit_public_booking_group_v2 with a HARD per-participant requirement on every item", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(sql, /v_participants := v_item->'participants'/);
    assert.match(sql, /jsonb_typeof\(v_participants\) <> 'array'/);
    assert.match(sql, /v_part_count < 1/);
    assert.match(sql, /Every guest must be listed as a participant/);
    assert.match(sql, /v_part_count > 25/);
    assert.match(sql, /Every participant needs a name\./);
  });

  it("carries the 062 agreement gate and the 064 walk-in register gate into the rebuilt v2", () => {
    assert.match(sql, /IF p_guest_agreed IS NOT TRUE THEN/);
    assert.match(sql, /v_src = 'walk_in' AND NOT public\.is_cash_register_open\(\)/);
    assert.match(sql, /'register_closed'/);
  });

  it("re-affirms anon/authenticated grants on the rebuilt v2", () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_public_booking_group_v2/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2[\s\S]*TO anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_public_booking_group_v2[\s\S]*TO authenticated/);
  });
});

describe("online enquiry form (BookingForm) — per-participant consent via group_v2", () => {
  const form = fs.readFileSync(path.resolve(__dirname, "../app/components/BookingForm.tsx"), "utf-8");

  it("routes every online submission through submit_public_booking_group_v2 with p_source online", () => {
    assert.match(form, /submit_public_booking_group_v2/);
    assert.match(form, /p_source:\s*"online"/);
    assert.doesNotMatch(form, /\.rpc\("submit_public_booking"/);
    assert.doesNotMatch(form, /submit_public_booking_group"/);
  });

  it("carries a full per-participant roster on the main item and every add-on item", () => {
    assert.match(form, /participants: partyRows\(\)/);
    assert.match(form, /participants: it\.participants/);
    assert.match(form, /participants:\s*partyRows\(\)/);
    assert.match(form, /participant_type: "adult"/);
    assert.match(form, /guardian_name/);
  });

  it("shows the same signing step as the walk-in wizard (roster + consent template + sign RPCs)", () => {
    assert.match(form, /get_walkin_group_participants/);
    assert.match(form, /get_active_consent_template/);
    assert.match(form, /submit_walkin_participant_consent/);
    assert.match(form, /SignCanvas/);
    assert.match(form, /Sign consent for all/);
  });

  it("shows a success screen only after every participant has signed", () => {
    assert.match(form, /groupResult && groupConsentDone/);
    assert.match(form, /every participant&apos;s/);
    assert.match(form, /consent &amp; liability waiver has been signed/);
  });

  it("declares addonSelections before it is read (no temporal-dead-zone crash)", () => {
    const decl = form.indexOf("const [addonSelections, setAddonSelections]");
    const read = form.indexOf("addonSelections[a.id] !== undefined");
    assert.ok(decl > -1 && read > -1 && decl < read);
  });

  it("keeps useEffect and the addon ref above the early modal-closed return (no conditional hooks)", () => {
    const effect = form.indexOf("useEffect(");
    const earlyReturn = form.indexOf("if (!open) return null;");
    const addonRef = form.indexOf("useRef(selectedAddonActivities)");
    assert.ok(effect > -1 && earlyReturn > -1 && effect < earlyReturn);
    assert.ok(addonRef > -1 && addonRef < earlyReturn);
  });
});

describe("migration 067 — Google Sheet finance sync (other income ledger)", () => {
  const sql = readMigration("067_finance_sheet_sync.sql");

  it("creates the other_income table with the same ledger shape as expenses", () => {
    assert.match(sql, /create table if not exists public\.other_income/);
    assert.match(sql, /amount_cents int not null check \(amount_cents >= 0\)/);
    assert.match(sql, /currency text not null default 'MVR' check \(currency in \('USD', 'MVR'\)\)/);
    assert.match(sql, /income_date date not null/);
    assert.match(sql, /external_id text/);
    assert.match(sql, /archived_at timestamptz/);
  });

  it("enables RLS and restricts other_income to owner & manager", () => {
    assert.match(sql, /alter table public\.other_income enable row level security/);
    assert.match(sql, /"other_income_select_owner_manager"/);
    assert.match(sql, /"other_income_write_owner_manager"/);
    assert.match(sql, /sp\.role in \('owner', 'manager'\)/);
  });

  it("adds external_id + archived_at to expenses with a unique partial index", () => {
    assert.match(sql, /alter table public\.expenses\s*add column if not exists external_id text/);
    assert.match(sql, /add column if not exists archived_at timestamptz/);
    assert.match(sql, /create unique index expenses_external_id_idx/);
    assert.match(sql, /where external_id is not null/);
  });
});

describe("migration 068 — staff login NULL-token fix", () => {
  const sql = readMigration("068_staff_login_null_tokens.sql");

  it("create_staff_login supplies empty token strings so GoTrue can scan the row", () => {
    assert.match(sql, /confirmation_token, recovery_token, email_change, email_change_token_new/);
    assert.match(sql, /now\(\), '', '', '', '', '', '', 0\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_staff_login/);
  });
});

describe("zoho sheet sync — folder wiring", () => {
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const nav = fs.readFileSync(path.resolve(__dirname, "../app/admin/AdminNav.tsx"), "utf-8");
  const permissions = fs.readFileSync(path.resolve(__dirname, "../lib/permissions.ts"), "utf-8");
  const incomeClient = fs.readFileSync(path.resolve(__dirname, "../app/admin/income/IncomePageClient.tsx"), "utf-8");
  const expensesClient = fs.readFileSync(path.resolve(__dirname, "../app/admin/expenses/ExpensePageClient.tsx"), "utf-8");
  const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf-8"));
  const cronRoute = fs.readFileSync(path.resolve(__dirname, "../app/api/sync/finance/route.ts"), "utf-8");

  it("server action is role guarded and wires the sync + revalidates pages", () => {
    assert.match(actions, /export async function syncFinanceFromSheetAction/);
    assert.match(actions, /staff_profiles/);
    assert.match(actions, /role !== "owner" && profile\.role !== "manager"/);
    assert.match(actions, /syncFinanceSheets\(\)/);
    assert.match(actions, /revalidatePath\("\/admin\/income"\)/);
    assert.match(actions, /revalidatePath\("\/admin\/expenses"\)/);
  });

  it("getExpenses/queries hide archived rows", () => {
    assert.match(actions, /\.is\("archived_at", null\)/);
  });

  it("adds Other Income management actions", () => {
    assert.match(actions, /export async function getOtherIncome/);
    assert.match(actions, /export async function createOtherIncome/);
    assert.match(actions, /export async function updateOtherIncome/);
    assert.match(actions, /export async function deleteOtherIncome/);
  });

  it("nav shows Other Income under the expenses module and middleware maps the route", () => {
    assert.match(nav, /\{ label: "Other Income", href: "\/admin\/income", icon: "\+", module: "expenses" \}/);
    assert.match(permissions, /income: "expenses"/);
  });

  it("expenses and income pages both offer the manual Sync button", () => {
    assert.match(expensesClient, /FinanceSyncButton/);
    assert.match(incomeClient, /FinanceSyncButton/);
  });

  it("vercel.json schedules the finance sync daily with a cron secret guard", () => {
    assert.ok(Array.isArray(vercel.crons), "crons configured");
    const cron = vercel.crons.find((c: { path: string }) => c.path === "/api/sync/finance");
    assert.ok(cron, "sync cron exists");
    assert.equal(cron.schedule, "0 1 * * *");
    assert.match(cronRoute, /Authorization: Bearer \$\{CRON_SECRET\}/);
    assert.match(cronRoute, /syncFinanceSheets\(\)/);
  });

  it("the cron respects the Vercel Hobby daily limit (manual Sync button covers everything else)", () => {
    assert.equal(vercel.crons[0].schedule, "0 1 * * *");
  });
});

describe("other income — reports integration", () => {
  it("profitTotals adds other income before subtracting expenses, per currency", () => {
    const net = { usdCents: 10000, mvrLaari: 20000 };
    const exp = { usdCents: 3000, mvrLaari: 5000 };
    const inc = { usdCents: 1500, mvrLaari: 4000 };
    const out = profitTotals(net, exp, inc);
    assert.equal(out.usdCents, 10000 + 1500 - 3000);
    assert.equal(out.mvrLaari, 20000 + 4000 - 5000);
  });

  it("sumOtherIncomeByCurrency groups by currency", () => {
    const rows = [
      { id: "a", title: "T", category: "Other", amount_cents: 500, currency: "USD", income_date: "2026-09-27", vendor: null, notes: null },
      { id: "b", title: "T", category: "Other", amount_cents: 50_000, currency: "MVR", income_date: "2026-09-27", vendor: null, notes: null },
      { id: "c", title: "T", category: "Other", amount_cents: 250, currency: "USD", income_date: "2026-09-27", vendor: null, notes: null },
    ];
    const sums = sumOtherIncomeByCurrency(rows);
    assert.equal(sums.USD, 750);
    assert.equal(sums.MVR, 50_000);
  });

  it("reports page queries other_income only when allowed, excluding archived", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/page.tsx"), "utf-8");
    assert.match(page, /from\("other_income"\)/);
    assert.match(page, /canExpenses\s*\n\s*\? supabase\.from\("other_income"\)/);
    // Profit is built from money received, not from what was booked.
    assert.match(page, /profitTotals\(collectedNet, expenses, otherIncomeTotal\)/);
    assert.match(page, /collectedNetCents\(b, paidOf\(b\)\)/);
  });

  it("reports exclude payment-mirrored income and voided payments", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../app/admin/reports/page.tsx"), "utf-8");
    // Migration 083 mirrors guest payments into other_income for the Income
    // page; counting them again here would book every trip twice.
    assert.match(page, /filter\(\(r\) => !r\.payment_id\)/);
    assert.match(page, /payments\.status", "completed"/);
    const dayEnd = fs.readFileSync(path.resolve(__dirname, "../lib/dayend-report.ts"), "utf-8");
    assert.match(dayEnd, /is\("payment_id", null\)/);
    assert.match(dayEnd, /\.eq\("payments\.status", "completed"\)/);
    assert.match(dayEnd, /filter\(isCompletedPayment\)/);
    const dash = fs.readFileSync(path.resolve(__dirname, "../app/admin/page.tsx"), "utf-8");
    assert.match(dash, /profitTotals\(collectedNetMonth, expensesMonth, otherIncomeMonth\)/);
    assert.match(dash, /filter\(\(r\) => !r\.payment_id\)/);
  });
});

describe("migration 069 — equipment rental consent & liability", () => {
  const sql = readMigration("069_rental_consent.sql");

  it("links consents to rentals and relaxes the activity requirement", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public\.equipment_rentals\(id\)/);
    assert.match(sql, /ALTER COLUMN activity_id DROP NOT NULL/);
  });

  it("keeps one active equipment_rental template with a liability-focused text", () => {
    assert.match(sql, /equipment-rental-consent-v1/);
    assert.match(sql, /VALUES[\s\S]{0,400}'equipment_rental',/);
    assert.match(sql, /EQUIPMENT RENTAL LIABILITY CONSENT/);
    assert.match(sql, /NOTICE: This form should be reviewed under applicable Maldivian law/);
  });

  it("dedupes active consents per rental, preserving booking behavior", () => {
    assert.match(sql, /COALESCE\(rental_id, '00000000-0000-0000-0000-000000000000'::uuid\)/);
    assert.match(sql, /WHERE status IN \('pending', 'signed'\)/);
  });

  it("defines the staff checkout RPC and the guest legacy fallback", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_rental_consent/);
    assert.match(sql, /current_staff_id\(\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ensure_rental_consent_by_token/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ensure_rental_consent_by_token\(text\) TO anon/);
  });

  it("lets the guest record minor status / DOB before signing", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_rental_consent_guest_info/);
    assert.match(sql, /Date of birth is required for a minor renter/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_rental_consent_guest_info\(text, boolean, date\) TO anon/);
  });

  it("gates returns on a signed consent in complete_rental_return", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.complete_rental_return/);
    assert.match(sql, /'error', 'consent_required'/);
    assert.match(sql, /cf\.status = 'signed'/);
  });

  it("surfaces consent_type to both PDF renderers", () => {
    assert.match(sql, /'consent_type', v_row\.consent_type/);
    assert.match(sql, /get_consent_for_pdf/);
  });

  it("allows watersports staff to read rental consent PDFs", () => {
    assert.match(sql, /ELSIF v_row\.consent_type = 'equipment_rental' THEN/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_consent_for_pdf\(UUID\) TO authenticated/);
  });
});

describe("migration 070 — rental walk-in QR compulsory guest details", () => {
  const sql = readMigration("070_rental_consent_guest_details.sql");

  it("replaces the legacy pre-sign RPC with the full-details RPC", () => {
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.set_rental_consent_guest_info\(text, boolean, date\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_rental_consent_details/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.update_rental_consent_details\(/);
    assert.match(sql, /TO anon/);
  });

  it("writes every compulsory guest detail and derives minor status from DOB", () => {
    assert.match(sql, /p_guest_name text DEFAULT NULL/);
    assert.match(sql, /p_nationality text DEFAULT NULL/);
    assert.match(sql, /p_date_of_birth date DEFAULT NULL/);
    assert.match(sql, /p_passport_number text DEFAULT NULL/);
    assert.match(sql, /p_phone text DEFAULT NULL/);
    assert.match(sql, /p_hotel text DEFAULT NULL/);
    assert.match(sql, /p_room_number text DEFAULT NULL/);
    assert.match(sql, /p_emergency_contact_phone text DEFAULT NULL/);
    assert.match(sql, /is_minor = \(date_part\('year', age\(now\(\), p_date_of_birth\)\) < 18\)/);
  });

  it("requires the compulsory identification, stay and emergency details", () => {
    assert.match(sql, /All compulsory guest details must be completed: full name, nationality, date of birth, phone, hotel, and emergency contact\./);
    assert.match(sql, /Date of birth cannot be in the future\./);
  });

  it("syncs the customers record with COALESCE updates (mirroring walk-in 061)", () => {
    assert.match(sql, /UPDATE customers SET[\s\S]{0,600}COALESCE\(NULLIF\(trim\(p_phone\), ''\), phone\)/);
  });

  it("hard-blocks signing an equipment_rental waiver until compulsory details exist", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.sign_consent_form\(/);
    assert.match(sql, /IF v_row\.consent_type = 'equipment_rental' THEN/);
    assert.match(sql, /All compulsory guest details must be completed before signing\./);
  });

  it("keeps the sign RPC chained grants for anon and authenticated", () => {
    const grantBlock = sql.split("GRANT EXECUTE ON FUNCTION public.sign_consent_form(");
    assert.ok(grantBlock.length > 2, "sign_consent_form grants should be chained");
    assert.match(sql, /TO anon;/);
    assert.match(sql, /TO authenticated;/);
  });
});

describe("migration 072 — compulsory email + guest copies", () => {
  const sql = readMigration("072_compulsory_email_guest_copies.sql");

  it("adds an email column plus a shared validator", () => {
    assert.match(sql, /ALTER TABLE public\.consent_forms\s*\n\s*ADD COLUMN IF NOT EXISTS email TEXT/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_valid_email\(p_email text\)/);
    assert.match(sql, /CHECK \(email IS NULL OR public\.is_valid_email\(email\)\) NOT VALID/);
  });

  it("exposes set_consent_email for pending consents (token-gated)", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_consent_email\(\s*p_token text,\s*p_email text\s*\)/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_consent_email\(text, text\) TO anon/);
    assert.match(sql, /A valid email is required\./);
  });

  it("requires the email in update_rental_consent_details and syncs customers", () => {
    assert.match(sql, /p_email text DEFAULT NULL/);
    assert.match(sql, /email = lower\(trim\(p_email\)\)/);
    assert.match(sql, /email = COALESCE\(lower\(trim\(p_email\)\), email\)/);
  });

  it("gates EVERY consent type on a valid email before signing", () => {
    assert.match(sql, /IF v_row\.email IS NULL OR NOT public\.is_valid_email\(v_row\.email\) THEN/);
    assert.match(sql, /A valid email is required before signing\./);
  });

  it("requires a valid customer email on every booking insert", () => {
    assert.match(sql, /CREATE TRIGGER require_customer_email_before_booking/);
    assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.bookings/);
    assert.match(sql, /A valid email is required for every booking\./);
  });

  it("surfaces email on both consent readers", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_consent_form_by_token\(p_token text\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_consent_pdf_by_token\(p_token text\)/);
    assert.match(sql, /'email', v_row\.email/);
  });

  it("exposes the rental receipt by token only after return", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_rental_receipt_by_token\(p_token text\)/);
    assert.match(sql, /IF v_rental\.status != 'returned' THEN/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_rental_receipt_by_token\(text\) TO anon/);
  });
});

describe("guest email copies + receipts", () => {
  function read(file: string): string {
    return fs.readFileSync(path.resolve(__dirname, file), "utf-8");
  }

  it("mail supports PDF attachments", () => {
    const mail = read("../lib/mail.ts");
    assert.match(mail, /attachments\?: EmailAttachment\[\]/);
    assert.match(mail, /content: a\.contentBase64/);
  });

  it("guest-copies emails the consent PDF and the rental receipt", () => {
    const copies = read("../lib/guest-copies.ts");
    assert.match(copies, /sendConsentCopyEmail/);
    assert.match(copies, /generateConsentPdf/);
    assert.match(copies, /sendRentalReceiptEmail/);
    assert.match(copies, /generateRentalReceiptPdf/);
    assert.match(copies, /get_rental_receipt_by_token/);
    assert.match(copies, /contentBase64: pdfBuffer\.toString\("base64"\)/);
  });

  it("exposes token-gated advisory POST routes", () => {
    for (const route of [
      "../app/api/mail/consent-copy/route.ts",
      "../app/api/mail/rental-receipt/route.ts",
    ]) {
      const src = read(route);
      assert.match(src, /export async function POST/, route);
      assert.match(src, /\^\[A-Za-z0-9-\]\{8,200\}\$/, route);
    }
  });

  it("both guest flows collect a required email and fire the copies", () => {
    const consent = read("../app/consent/[token]/ConsentFormClient.tsx");
    assert.match(consent, /"set_consent_email"/);
    assert.match(consent, /p_email: email\.trim\(\)/);
    assert.match(consent, /EMAIL_RE\.test\(email\.trim\(\)\)/);
    assert.match(consent, /fireMailPost\("\/api\/mail\/consent-copy", token\)/);

    const rental = read("../app/rental/[token]/RentalAgreementClient.tsx");
    assert.match(rental, /p_email: email\.trim\(\)/);
    assert.match(rental, /fireMailPost\("\/api\/mail\/consent-copy", token\)/);
    assert.match(rental, /fireMailPost\("\/api\/mail\/rental-receipt", token\)/);
  });

  it("admin requires a valid email to save a customer or booking", () => {
    const actions = read("../lib/supabase/actions.ts");
    assert.match(actions, /A valid email is required/);
    assert.match(actions, /This customer needs a valid email before a booking can be saved\./);
  });
});

describe("migration 071 — wind-surf-lesson image placeholder", () => {
  const sql = readMigration("071_windsurf_image_fix.sql");

  it("assigns a real Thoddoo shoot photo where the card was broken", () => {
    assert.match(sql, /UPDATE public\.activities/);
    assert.match(sql, /slug = 'wind-surf-lesson'/);
    assert.match(sql, /'\/images\/thoddoo\/fun-ride\.jpg'/);
    assert.match(sql, /image IS NULL OR image = ''/);
  });
});

describe("migration 076 — agent booking QR (rate never shown to the guest)", () => {
  const sql = readMigration("076_agent_booking_qr.sql");
  const submit = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.submit_agent_booking"));
  const readLink = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.get_agent_booking_link"),
    sql.indexOf("CREATE OR REPLACE FUNCTION public.submit_agent_booking")
  );
  // Line comments are stripped for the negative assertions: both files EXPLAIN at
  // length why a price must never cross the wire, and that prose names the very
  // columns the code must not touch.
  const code = (s: string) =>
    s
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");

  it("adds the agent source and a per-issued-QR link table", () => {
    assert.match(sql, /ALTER TYPE public\.booking_source ADD VALUE IF NOT EXISTS 'agent'/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.agent_booking_links/);
    assert.match(sql, /token TEXT NOT NULL UNIQUE DEFAULT encode\(public\._gen_random_bytes\(32\), 'hex'\)/);
    assert.match(sql, /agent_id UUID REFERENCES public\.staff_profiles\(id\) ON DELETE SET NULL/);
    assert.match(sql, /agent_name TEXT NOT NULL/);
    assert.match(sql, /activity_ids UUID\[\] NOT NULL DEFAULT '\{\}'/);
    assert.match(sql, /quoted_option_labels JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    assert.match(sql, /uses_count INT NOT NULL DEFAULT 0/);
  });

  it("keeps the link table staff-only (anon goes through the RPCs)", () => {
    assert.match(sql, /ALTER TABLE public\.agent_booking_links ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON public\.agent_booking_links FROM anon/);
    assert.match(sql, /CREATE POLICY agent_links_staff_select[\s\S]*?TO authenticated/);
    assert.match(sql, /CREATE POLICY agent_links_staff_write[\s\S]*?WITH CHECK \(public\.current_staff_role\(\) IS NOT NULL\)/);
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.agent_booking_links TO authenticated/);
  });

  it("denormalises the agent onto both the booking and its group", () => {
    assert.match(sql, /ALTER TABLE public\.bookings\n\s*ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public\.staff_profiles\(id\) ON DELETE SET NULL,\n\s*ADD COLUMN IF NOT EXISTS agent_name TEXT/);
    assert.match(sql, /ALTER TABLE public\.booking_groups\n\s*ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public\.staff_profiles\(id\) ON DELETE SET NULL,\n\s*ADD COLUMN IF NOT EXISTS agent_name TEXT/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_bookings_agent ON public\.bookings \(agent_id\)/);
    assert.match(
      submit,
      /INSERT INTO public\.booking_groups \(group_ref, customer_id, source, agent_id, agent_name\)/
    );
  });

  it("the guest-facing read selects NO price column", () => {
    assert.match(readLink, /CREATE OR REPLACE FUNCTION public\.get_agent_booking_link\(p_token TEXT\)/);
    // The whole point: not one price field crosses the wire to the guest page.
    assert.doesNotMatch(code(readLink), /base_price_cents/);
    assert.doesNotMatch(code(readLink), /price_cents/);
    assert.doesNotMatch(code(readLink), /activity_pricing/);
    assert.doesNotMatch(code(readLink), /total_cents/);
    // Even the option LABEL can encode a tier, so it is withheld too.
    assert.doesNotMatch(code(readLink), /quoted_option_labels/);
    assert.match(readLink, /'agent_name', v_link\.agent_name/);
    // ...and the reason is written down next to the payload.
    assert.match(readLink, /quoted_option_labels is intentionally absent from this payload/);
  });

  it("the guest-facing read rejects unknown, closed and expired links", () => {
    assert.match(readLink, /'error', 'not_found'/);
    assert.match(readLink, /IF NOT v_link\.active THEN/);
    assert.match(readLink, /IF v_link\.expires_at <= now\(\) THEN/);
    assert.match(readLink, /'error', 'expired'/);
  });

  it("only offers activities the link is scoped to, and only active ones", () => {
    assert.match(
      readLink,
      /WHERE a\.active = true\n\s*AND \(cardinality\(v_link\.activity_ids\) = 0 OR a\.id = ANY\(v_link\.activity_ids\)\)/
    );
  });

  it("the submit RPC re-checks the token, expiry and agreement", () => {
    assert.match(submit, /WHERE token = trim\(p_token\)/);
    assert.match(submit, /IF v_link\.id IS NULL OR NOT v_link\.active THEN/);
    assert.match(submit, /IF v_link\.expires_at <= now\(\) THEN/);
    assert.match(submit, /IF NOT COALESCE\(p_guest_agreed, false\) THEN/);
  });

  it("refuses an activity the agent never quoted, even on a hand-crafted request", () => {
    assert.match(
      submit,
      /IF cardinality\(v_link\.activity_ids\) > 0 AND NOT \(v_act_id = ANY\(v_link\.activity_ids\)\) THEN/
    );
  });

  it("takes the price from the link, never from the guest request", () => {
    assert.match(
      submit,
      /v_link\.quoted_option_labels ->> v_act_id::TEXT/
    );
    // p_items must not be able to name a priced option.
    assert.doesNotMatch(submit, /p_items->>'pricing_option_label'/);
    assert.doesNotMatch(submit, /v_item->>'pricing_option_label'/);
  });

  it("never returns a price to the caller", () => {
    const returned = submit.slice(submit.indexOf("RETURN json_build_object(\n    'group_ref'"));
    assert.doesNotMatch(returned, /total_cents/);
    assert.doesNotMatch(returned, /price/);
  });

  it("stamps each booking with its OWN cost, not the running group total", () => {
    assert.match(submit, /v_item_cents := v_unit_cents \* v_total_guests/);
    assert.match(submit, /v_total_cents := v_total_cents \+ v_item_cents/);
    // The booking row must carry the per-item figure.
    assert.match(
      submit,
      /v_hotel_clean, v_room_clean, v_pickup_clean, v_special_clean,\n\s*v_item_cents,/
    );
  });

  it("persists guest_agreed so the 062 insert trigger does not reject the row", () => {
    const agreement = readMigration("062_consent_gates_and_booking_integrity.sql");
    assert.match(agreement, /IF NEW\.guest_agreed IS NOT TRUE THEN/);
    assert.match(
      submit,
      /guest_agreed, guest_agreed_at, agreement_version,/
    );
    assert.match(submit, /true, now\(\), 'booking-enquiry-v1',/);
  });

  it("writes the agent's special request through to the booking", () => {
    assert.match(submit, /v_special_clean := NULLIF\(trim\(COALESCE\(p_special_requests, ''\)\), ''\)/);
    assert.match(submit, /pickup_location, special_requests, total_cents/);
  });

  it("validates every item BEFORE writing the customer, group or bookings", () => {
    // plpgsql does not roll back on RETURN, so the whole item set is proved first.
    const validatePass = submit.indexOf("validate EVERY item BEFORE writing anything");
    const customerInsert = submit.indexOf("-- ---------- unified customer row ----------");
    const groupInsert = submit.indexOf("INSERT INTO public.booking_groups");
    assert.ok(validatePass > -1, "an up-front validation pass must exist");
    assert.ok(customerInsert > validatePass, "validation must precede the customer row");
    assert.ok(groupInsert > validatePass, "validation must precede the group insert");
  });

  it("requires a usable participant list per item up front", () => {
    assert.match(submit, /OR jsonb_array_length\(v_participants\) < 1 THEN/);
    assert.match(submit, /IF jsonb_array_length\(v_participants\) > 25 THEN/);
    assert.match(
      submit,
      /IF NULLIF\(trim\(COALESCE\(v_participant->>'full_name', ''\)\), ''\) IS NULL THEN/
    );
    assert.match(
      submit,
      /IF \(v_participant->>'participant_type'\) = 'child'\n\s*AND NULLIF\(trim\(COALESCE\(v_participant->>'guardian_name', ''\)\), ''\) IS NULL THEN/
    );
  });

  it("writes a participant row for every person, including a solo guest", () => {
    assert.match(
      submit,
      /INSERT INTO public\.booking_participants \(\n\s*booking_id, full_name, participant_type, guardian_name, guardian_relationship/
    );
  });

  it("keeps the consent gate intact by reusing the 060/061 participant path", () => {
    // Same RPC, keyed by the server-generated choice_token — no bypass.
    assert.match(submit, /needs_per_participant_details', true/);
    const consent = readMigration("061_walkin_participant_consent.sql");
    assert.match(consent, /CREATE OR REPLACE FUNCTION public\.submit_walkin_participant_consent/);
  });

  it("counts link usage and echoes the group ref, never the amount", () => {
    assert.match(
      submit,
      /SET uses_count = uses_count \+ 1, last_used_at = now\(\)\n\s*WHERE id = v_link_id/
    );
    assert.match(submit, /'group_ref', v_group_ref/);
    assert.match(submit, /'agent_name', v_link\.agent_name/);
  });

  it("expires links with plain now() + interval on a timestamptz", () => {
    assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) \+ INTERVAL '7 days'\)/);
    // A Maldives-local default would store a naive timestamp.
    assert.doesNotMatch(sql, /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) AT TIME ZONE/);
  });

  it("leaves 'agent' out of the walk-in cash-register creation gate (064)", () => {
    const gate = readMigration("064_cash_register_gate_and_walkin_single_consent.sql");
    assert.match(gate, /IF NEW\.source = 'walk_in' AND NOT public\.is_cash_register_open\(\) THEN/);
    // An agent sells ahead of time: lands 'pending', confirmed by staff later.
    assert.doesNotMatch(sql, /is_cash_register_open/);
    assert.match(submit, /'agent'::public\.booking_source, 'pending'/);
  });

  it("both RPCs are SECURITY DEFINER with a pinned search_path, granted to anon", () => {
    assert.match(sql, /FUNCTION public\.get_agent_booking_link\(p_token TEXT\)[\s\S]*?SECURITY DEFINER SET search_path = public/);
    assert.match(sql, /FUNCTION public\.submit_agent_booking\([\s\S]*?SECURITY DEFINER SET search_path = public/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_agent_booking_link\(TEXT\) FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_agent_booking_link\(TEXT\) TO anon/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_agent_booking\(TEXT, JSONB, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN\) TO anon/);
    assert.match(sql, /TO authenticated/);
  });

  it("uses an AG group ref prefix so agent folios are recognisable at a glance", () => {
    assert.match(submit, /'AG' \|\| nextval\('public\.booking_group_ref_seq'\)/);
  });
});

describe("agent booking QR — guest page renders no price anywhere", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf-8");
  const page = read("../app/agent/[token]/page.tsx");
  const client = read("../app/agent/[token]/AgentBookingClient.tsx");
  const code = (s: string) =>
    s
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  const pageCode = code(page);
  const clientCode = code(client);

  it("reads the link through the price-free RPC only", () => {
    const pageCode = page
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.match(page, /\.rpc\("get_agent_booking_link"/);
    assert.match(page, /p_token: token/);
    // No price-bearing helper may be imported into either file.
    assert.doesNotMatch(pageCode, /getPublicActivityBySlug|getPublicAllActivities|formatUsdOnly|basePriceCents|pricingOptions/);
    assert.doesNotMatch(clientCode, /formatUsdOnly|basePriceCents|pricingOptions|currency/);
  });

  it("never renders or imports money formatting", () => {
    assert.doesNotMatch(client, /from "@\/lib\/money"/);
    assert.doesNotMatch(page, /from "@\/lib\/money"/);
  });

  it("tells the guest the rate is already quoted instead of showing one", () => {
    assert.match(page, /Rate confirmed/);
    assert.match(page, /Your agent has already quoted this trip/);
    assert.match(client, /As quoted by \{agentName\}/);
  });

  it("never sends a pricing option label to the submit RPC", () => {
    assert.doesNotMatch(clientCode, /pricing_option_label/);
    assert.match(client, /\.rpc\("submit_agent_booking"/);
    assert.match(client, /p_token: token/);
    assert.match(client, /p_guest_agreed: agreed/);
  });

  it("reuses the shared item validator and the capped party/item limits", () => {
    assert.match(client, /import \{ sanitizeWalkinItemsV2 \} from "@\/lib\/sanitize"/);
    assert.match(client, /sanitizeWalkinItemsV2\(\{ items: draftItems \}\)/);
    assert.match(client, /const MAX_PARTY = 50;/);
    assert.match(client, /const MAX_GROUP_ITEMS = 8;/);
  });

  it("sanitizes before the submit RPC", () => {
    const sanitizer = client.indexOf("sanitizeWalkinItemsV2({");
    const submitCall = client.indexOf('.rpc("submit_agent_booking"');
    assert.ok(sanitizer > -1 && submitCall > -1);
    assert.ok(sanitizer < submitCall, "sanitizer runs before the submit");
  });

  it("always books a lead participant row so a solo guest still signs", () => {
    assert.match(client, /full_name: guestName\.trim\(\),/);
    assert.match(client, /if \(partySize > 1\)/);
    assert.match(client, /participantType: "adult" \| "child"/);
  });

  it("signs the waiver per participant through the existing 061 RPC", () => {
    assert.match(client, /\.rpc\("get_walkin_group_participants"/);
    assert.match(client, /p_group_ref:\s*groupResult\.group_ref/);
    assert.match(client, /\.rpc\("submit_walkin_participant_consent"/);
    assert.match(client, /p_choice_token:\s*p\.choice_token/);
    assert.match(client, /p_phone:\s*guestPhone\.trim\(\)/);
    assert.match(client, /get_active_consent_template/);
  });

  it("gates the success screen on every participant having signed", () => {
    assert.match(client, /if \(groupResult && groupConsentDone\)/);
    assert.match(client, /for \(const p of groupParticipants\)/);
    assert.match(client, /key=\{p\.choice_token\}/);
    const gate = client.indexOf("if (groupResult && groupConsentDone)");
    const pay = client.indexOf("Pay {groupResult.agent_name} on arrival");
    assert.ok(pay > gate, "pay-at-arrival copy lives after the success gate");
  });

  it("shows the group reference and names the agent on the success card", () => {
    assert.match(client, /Group reference:/);
    assert.match(client, /<strong>\{groupResult\.group_ref\}<\/strong>/);
    assert.match(client, /Pay \{groupResult\.agent_name\} on arrival/);
  });

  it("explains the rate in the terms instead of pricing the page", () => {
    assert.match(client, /Your rate is the one \{agentName\} quoted you — it is not shown on this page\./);
    assert.doesNotMatch(client, /Prices are shown in USD/);
  });

  it("is not indexable", () => {
    assert.match(page, /robots: \{ index: false, follow: false \}/);
  });
});

describe("agent booking QR — admin issuing modal", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf-8");
  const modal = read("../app/admin/bookings/AgentQRModal.tsx");
  const actions = read("../lib/supabase/actions.ts");
  const pageClient = read("../app/admin/bookings/BookingPageClient.tsx");

  it("issues the QR from the bookings page", () => {
    assert.match(pageClient, /import AgentQRModal from "\.\/AgentQRModal"/);
    assert.match(pageClient, /onClick=\{\(\) => setAgentOpen\(true\)\}/);
    assert.match(pageClient, /\{agentOpen && \(\s*<AgentQRModal/);
  });

  it("picks the agent from real staff and keeps the name editable", () => {
    assert.match(modal, /getAgentsForBookingQr/);
    assert.match(modal, /chooseAgent/);
    assert.match(modal, /if \(found\) setAgentName\(found\.name\)/);
  });

  it("scopes the link to the trips the agent quoted", () => {
    assert.match(modal, /getActivitiesWithPricingForAgentQr/);
    assert.match(modal, /type="checkbox"/);
    assert.match(modal, /const MAX_TRIPS = 8/);
    assert.match(modal, /prev\.length >= MAX_TRIPS/);
  });

  it("chooses the quoted option per trip and shows the price to STAFF only", () => {
    assert.match(modal, /quotedOptions/);
    assert.match(modal, /staff only/);
    // The modal is an authenticated admin screen, so prices are fine here.
    assert.match(modal, /formatUsdOnly\(act\.basePriceCents, act\.currency\)/);
    assert.match(modal, /Base price — \{formatUsdOnly\(act\.basePriceCents, act\.currency\)\}/);
  });

  it("builds the QR for the /agent route and offers copy / download / WhatsApp", () => {
    assert.match(modal, /`\$\{siteUrl\}\/agent\/\$\{token\}`/);
    assert.match(modal, /QRCode\.toDataURL/);
    assert.match(modal, /Copy link/);
    assert.match(modal, /Download/);
    assert.match(modal, /Send via WhatsApp/);
  });

  it("bounds the expiry to the 1-30 day range the action accepts", () => {
    assert.match(modal, /const EXPIRY_CHOICES = \[1, 3, 7, 14, 30\]/);
    assert.match(actions, /Math\.min\(Math\.max\(Math\.trunc\(input\.expiresInDays \?\? 7\), 1\), 30\)/);
  });

  it("lists recent links with their booking count and can close one", () => {
    assert.match(modal, /getAgentBookingLinks/);
    assert.match(modal, /uses_count/);
    assert.match(modal, /revokeAgentBookingLink/);
    assert.match(modal, /\{l\.uses_count \|\| 0\} booking/);
  });

  it("gates issuing and revoking to the roles that may work bookings", () => {
    assert.match(
      actions,
      /const AGENT_LINK_ROLES = \["owner", "manager", "reception", "watersports_staff"\]/
    );
    assert.match(actions, /You do not have permission to create agent booking links\./);
    assert.match(actions, /You do not have permission to revoke agent booking links\./);
    // Mirrors MODULE_ACCESS.bookings so the server and the nav cannot drift.
    const permissions = read("../lib/permissions.ts");
    assert.match(permissions, /bookings: FIELD_OPS/);
    assert.match(permissions, /const FIELD_OPS: StaffRole\[\] = \["owner", "manager", "reception", "watersports_staff"\]/);
  });

  it("refuses a forged agent id and a stale quoted label server-side", () => {
    assert.match(actions, /That agent could not be found\./);
    assert.match(actions, /One of the selected trips is no longer available\. Refresh and try again\./);
    assert.match(actions, /from\("activity_pricing"\)[\s\S]*?\.select\("activity_id, label"\)/);
    assert.match(actions, /if \(clean && valid\.has\(`\$\{id\}\\u0000\$\{clean\}`\)\) quotedOptions\[id\] = clean;/);
  });

  it("snapshots the agent name on the link so attribution survives a rename", () => {
    assert.match(actions, /attribution survives a staff rename/);
    assert.match(actions, /agent_name: agentName/);
  });

  it("labels the new source and shows who sold it on the ledger", () => {
    assert.match(pageClient, /if \(s === "agent"\) return "Agent";/);
    assert.match(pageClient, /function agentCell/);
    assert.match(pageClient, /\{agentCell\(rows\)\}/);
    const css = read("../app/admin/admin.css");
    assert.match(css, /\.badge-source-agent \{/);
  });
});

describe("day-end report — 23:00 Maldives email", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const lib = read("lib/dayend-report.ts");
  const route = read("app/api/cron/day-end/route.ts");
  const vercel = read("vercel.json");

  const report: DayEndReport = {
    date: "2026-10-02",
    tomorrow: "2026-10-03",
    taken: {
      bookings: 2,
      pax: 5,
      gross: { usdCents: 46000, mvrLaari: 828000 },
      bySource: [
        { key: "Agent", name: "Agent", bookings: 1, pax: 3, gross: { usdCents: 24000, mvrLaari: 432000 }, net: { usdCents: 0, mvrLaari: 0 }, commission: { usdCents: 0, mvrLaari: 0 }, collected: { usdCents: 24000, mvrLaari: 432000 } },
        { key: "Walk-in", name: "Walk-in", bookings: 1, pax: 2, gross: { usdCents: 22000, mvrLaari: 396000 }, net: { usdCents: 0, mvrLaari: 0 }, commission: { usdCents: 0, mvrLaari: 0 }, collected: { usdCents: 22000, mvrLaari: 396000 } },
      ],
      agents: [{ name: "Ali", bookings: 1, gross: { usdCents: 24000, mvrLaari: 432000 } }],
    },
    ran: {
      bookings: 1,
      pax: 2,
      gross: { usdCents: 22000, mvrLaari: 396000 },
      net: { usdCents: 18000, mvrLaari: 324000 },
      commission: { usdCents: 4000, mvrLaari: 72000 },
      byActivity: [
        { key: "Kayak", name: "Kayak", bookings: 1, pax: 2, gross: { usdCents: 22000, mvrLaari: 396000 }, net: { usdCents: 18000, mvrLaari: 324000 }, commission: { usdCents: 4000, mvrLaari: 72000 }, collected: { usdCents: 22000, mvrLaari: 396000 } },
      ],
    },
    cash: {
      payments: 1,
      collected: { usdCents: 18000, mvrLaari: 324000 },
      expenses: { usdCents: 5000, mvrLaari: 90000 },
      otherIncome: { usdCents: 0, mvrLaari: 0 },
      rentals: { usdCents: 3000, mvrLaari: 54000 },
      profit: { usdCents: 13000, mvrLaari: 234000 },
    },
    outstanding: {
      rows: [{ ref: "OB-101", name: "Aisha", activity: "Kayak", due: { usdCents: 4000, mvrLaari: 72000 } }],
      hidden: 3,
      total: { usdCents: 12000, mvrLaari: 216000 },
    },
    tomorrowTrips: {
      bookings: 1,
      pax: 3,
      consentPending: 1,
      byActivity: [
        {
          activity: "Dolphin Cruise",
          bookings: 1,
          pax: 3,
          consentPending: 1,
          hidden: 0,
          lines: [
            { ref: "OB-102", time: "09:30", guests: 3, names: "Aisha, Mariyam, Zaid", status: "confirmed", payment: "unpaid", source: "Agent", agent: "Ali", consentPending: 1 },
          ],
        },
      ],
    },
    failures: [],
    generatedAt: "2026-10-02T18:00:00.000Z",
  };

  const empty: DayEndReport = {
    date: "2026-10-02",
    tomorrow: "2026-10-03",
    taken: { bookings: 0, pax: 0, gross: { usdCents: 0, mvrLaari: 0 }, bySource: [], agents: [] },
    ran: { bookings: 0, pax: 0, gross: { usdCents: 0, mvrLaari: 0 }, net: { usdCents: 0, mvrLaari: 0 }, commission: { usdCents: 0, mvrLaari: 0 }, byActivity: [] },
    cash: { payments: 0, collected: { usdCents: 0, mvrLaari: 0 }, expenses: { usdCents: 0, mvrLaari: 0 }, otherIncome: { usdCents: 0, mvrLaari: 0 }, rentals: { usdCents: 0, mvrLaari: 0 }, profit: { usdCents: 0, mvrLaari: 0 } },
    outstanding: { rows: [], hidden: 0, total: { usdCents: 0, mvrLaari: 0 } },
    tomorrowTrips: { bookings: 0, pax: 0, consentPending: 0, byActivity: [] },
    failures: [],
    generatedAt: "2026-10-02T18:00:00.000Z",
  };

  it("fires at 18:00 UTC, which is 23:00 in the Maldives", () => {
    const parsed = JSON.parse(vercel);
    const dayEnd = parsed.crons.find((c: { path: string }) => c.path === "/api/cron/day-end");
    assert.ok(dayEnd, "/api/cron/day-end is not registered in vercel.json");
    assert.equal(dayEnd.schedule, "0 18 * * *");
    assert.equal(MALDIVES_UTC_OFFSET, "+05:00");
    // 18:00 UTC + 5h = 23:00, asserted rather than assumed.
    const utcHour = Number(dayEnd.schedule.split(" ")[1]);
    assert.equal((utcHour + 5) % 24, 23);
  });

  it("bounds the day in Maldives time, not the server's zone", () => {
    assert.equal(dayStartIso("2026-10-02"), "2026-10-02T00:00:00+05:00");
    assert.equal(dayEndIso("2026-10-02"), "2026-10-02T23:59:59+05:00");
    // No bare local-time construction, which would shift the day on UTC hosts.
    assert.doesNotMatch(lib, /new Date\(\)\.toLocaleDateString|toISOString\(\)\.split\("T"\)\[0\]\s*\)/);
    assert.match(lib, /maldivesToday\(\)/);
  });

  it("rejects a malformed date instead of reporting on nothing", () => {
    assert.equal(isDateStr("2026-10-02"), true);
    assert.equal(isDateStr("02-10-2026"), false);
    assert.equal(isDateStr("yesterday"), false);
    assert.match(lib, /reason: "bad_date"/);
  });

  it("reads with the service role, since the cron has no staff session", () => {
    assert.match(lib, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(lib, /reason: "missing_service_key"/);
    // get_tomorrow_bookings() is role-gated, so the report queries the tables.
    assert.doesNotMatch(lib, /rpc\("get_tomorrow_bookings"\)/);
    assert.match(lib, /from\("bookings"\)\.select\(TOMORROW_QUERY\)\.eq\("booking_date", tomorrow\)/);
  });

  it("guards the route with CRON_SECRET and supports a non-sending preview", () => {
    assert.match(route, /auth !== `Bearer \$\{secret\}`/);
    assert.match(route, /status: 401/);
    assert.match(route, /params\.get\("preview"\) === "1"/);
    assert.match(route, /params\.get\("date"\)/);
    // Preview must return before sendEmail so it cannot send.
    assert.ok(route.indexOf('params.get("preview")') < route.indexOf("await sendEmail"));
    assert.match(lib, /DAYEND_REPORT_TO[\s\S]*?RESEND_REPLY_TO[\s\S]*?booking@thoddoomarineexcursion\.com/);
  });

  it("keeps a failed section visible instead of losing the report", () => {
    assert.match(lib, /failures\.push/);
    assert.match(lib, /INCOMPLETE SECTIONS/);
    assert.match(lib, /Incomplete sections/);
  });

  it("subject carries the date, booking count and profit estimate", () => {
    const { subject } = renderDayEndMail(report);
    assert.match(subject, /2026-10-02/);
    assert.match(subject, /2 bookings/);
    assert.match(subject, /5 guests/);
    assert.match(subject, /\$130\.00/);
  });

  it("text body has the finance half and tomorrow's manifest", () => {
    const { text } = renderDayEndMail(report);
    for (const heading of ["SALES TAKEN TODAY", "TRIPS BY ACTIVITY TODAY", "CASH & LEDGER", "OUTSTANDING BALANCES", "TOMORROW"]) {
      assert.ok(text.includes(heading), `missing heading ${heading}`);
    }
    assert.match(text, /agent: Ali — 1 booking/);
    assert.match(text, /\+3 more · total outstanding/);
    assert.match(text, /1 waiver outstanding/);
    assert.match(text, /Aisha, Mariyam, Zaid — 09:30 · OB-102 · 3 guests · agent Ali · 1 waiver pending · unpaid/);
    assert.match(text, /\$180\.00 \/ MVR 3,240\.00/);
  });

  it("says so plainly when a day is empty", () => {
    const { text, html } = renderDayEndMail(empty);
    assert.match(text, /No bookings were taken today\./);
    assert.match(text, /No trips were scheduled to run today\./);
    assert.match(text, /Nothing outstanding\./);
    assert.match(text, /Nothing booked for tomorrow\./);
    assert.match(html, /Nothing booked for tomorrow\./);
  });

  it("escapes guest-supplied names in the HTML half", () => {
    const hostile: DayEndReport = {
      ...report,
      tomorrowTrips: {
        bookings: 1,
        pax: 1,
        consentPending: 0,
        byActivity: [
          {
            activity: '<img src=x onerror="alert(1)">',
            bookings: 1,
            pax: 1,
            consentPending: 0,
            hidden: 0,
            lines: [
              { ref: "OB-1", time: "10:00", guests: 1, names: "<b>Bold</b> & Co", status: "confirmed", payment: "paid", source: "Walk-in", agent: null, consentPending: 0 },
            ],
          },
        ],
      },
    };
    const { html, text } = renderDayEndMail(hostile);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /&lt;b&gt;Bold&lt;\/b&gt; &amp; Co/);
    // The plain-text half is not HTML-escaped, it simply stays plain text.
    assert.match(text, /<b>Bold<\/b> & Co/);
  });

  it("keeps the count grammar right for a single booking or guest", () => {
    const one: DayEndReport = {
      ...empty,
      taken: { ...empty.taken, bookings: 1, pax: 1 },
      tomorrowTrips: { bookings: 1, pax: 1, consentPending: 1, byActivity: [] },
    };
    const { text, subject } = renderDayEndMail(one);
    assert.match(subject, /1 booking, 1 guest/);
    assert.match(text, /1 booking · 1 guest/);
    assert.match(text, /1 waiver outstanding/);
  });

  it("caps long lists and says how many were left out", () => {
    assert.equal(OUTSTANDING_LIMIT, 10);
    assert.equal(TOMORROW_LINES_PER_ACTIVITY, 12);
    assert.match(lib, /slice\(0, OUTSTANDING_LIMIT\)/);
    assert.match(lib, /slice\(0, TOMORROW_LINES_PER_ACTIVITY\)/);
    assert.match(lib, /\+\$\{a\.hidden\} more booking\(s\)/);
  });

  it("labels every booking source, agent included", () => {
    assert.equal(sourceLabel("walk_in"), "Walk-in");
    assert.equal(sourceLabel("agent"), "Agent");
    assert.equal(sourceLabel("online"), "Website");
    assert.equal(sourceLabel("whatsapp"), "WhatsApp");
    assert.equal(sourceLabel(null), "Walk-in");
    assert.equal(sourceLabel("mystery"), "mystery");
    // The agent's name is a selling detail, so tomorrow's line carries it.
    assert.match(lib, /if \(line\.source === "Agent"\) bits\.push/);
  });
});

// ---------------------------------------------------------------------------
// migration 079 — agent QR token generation + party-sized public pricing
// ---------------------------------------------------------------------------
describe("migration 079 — agent QR token default", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const migration = read("supabase/migrations/079_agent_qr_token_and_party_pricing.sql");
  const agentMigration = read("supabase/migrations/076_agent_booking_qr.sql");

  it("moves the token default off the revoked _gen_random_bytes helper", () => {
    // 012-015 revoke EXECUTE on public._gen_random_bytes from PUBLIC/anon/
    // authenticated, so a DEFAULT calling it makes every staff insert fail.
    assert.match(agentMigration, /token TEXT NOT NULL UNIQUE DEFAULT encode\(public\._gen_random_bytes\(32\), 'hex'\)/);
    assert.match(migration, /ALTER COLUMN token SET DEFAULT public\.gen_agent_link_token\(\)/);
  });

  it("generates the token through a SECURITY DEFINER helper that only staff can call", () => {
    assert.match(migration, /FUNCTION public\.gen_agent_link_token\(\)[\s\S]*?SECURITY DEFINER/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.gen_agent_link_token\(\) FROM PUBLIC/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.gen_agent_link_token\(\) FROM anon/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.gen_agent_link_token\(\) TO authenticated/);
  });
});

describe("party-sized pricing — resolvePricingUnit", () => {
  it("keeps a declared option unit", () => {
    assert.equal(resolvePricingUnit([{ label: "10 minutes", pricingUnit: "per_unit" }], "10 minutes"), "per_unit");
    assert.equal(resolvePricingUnit([{ label: "Double kayak", pricingUnit: "per_hour" }], "Double kayak"), "per_hour");
  });

  it("treats an activity with options but no unit as flat, not per person", () => {
    assert.equal(resolvePricingUnit([{ label: "10 minutes" }], "10 minutes", "/ person"), "per_unit");
  });

  it("falls back to the price note when the activity has no options", () => {
    // The reported bug: dolphin cruise has no pricing rows and is "/ person".
    assert.equal(resolvePricingUnit(undefined, "Dolphin Cruise", "/ person"), "per_person");
    assert.equal(resolvePricingUnit([], "Stand-up paddleboard", "/ hour"), "per_unit");
    assert.equal(resolvePricingUnit([], "Private boat hire", null), "per_unit");
  });

  it("multiplies per-person rates by the party and leaves flat rates alone", () => {
    assert.equal(partyAdjustedCents(4500, undefined, "Dolphin Cruise", "/ person", 2), 9000);
    assert.equal(partyAdjustedCents(4500, undefined, "Dolphin Cruise", "/ person", 1), 4500);
    assert.equal(partyAdjustedCents(4500, undefined, "Dolphin Cruise", "/ person", 4), 18000);
    assert.equal(partyAdjustedCents(3000, undefined, "SUP with scooter", "/ hour", 4), 3000);
    assert.equal(partyAdjustedCents(1500, [{ label: "Double kayak", pricingUnit: "per_hour" }], "Double kayak", "/ hour", 2), 1500);
    assert.equal(partyAdjustedCents(5500, [{ label: "2 persons", pricingUnit: "per_person" }], "2 persons", "/ unit", 3), 16500);
  });
});

describe("booking unit pricing — unitPriceTotalCents", () => {
  it("multiplies a per-person price by the party", () => {
    assert.equal(unitPriceTotalCents(2500, "per_person", 1), 2500);
    assert.equal(unitPriceTotalCents(2500, "per_person", 2), 5000);
    assert.equal(unitPriceTotalCents(2500, "per_person", 4), 10000);
  });

  it("does not multiply a flat or hourly price by the party", () => {
    assert.equal(unitPriceTotalCents(2500, "per_unit", 4), 2500);
    assert.equal(unitPriceTotalCents(2500, "per_hour", 3), 2500);
  });

  it("treats a missing or nonsensical party size as one guest", () => {
    // Clearing the guests box must not wipe the operator's unit price.
    assert.equal(unitPriceTotalCents(2500, "per_person", 0), 2500);
    assert.equal(unitPriceTotalCents(2500, "per_person", NaN), 2500);
    assert.equal(unitPriceTotalCents(2500, "per_person", -3), 2500);
  });

  it("returns zero when no unit price is set, so the form keeps the typed total", () => {
    assert.equal(unitPriceTotalCents(0, "per_person", 4), 0);
  });

  it("never returns a fractional cent count", () => {
    assert.equal(unitPriceTotalCents(3333, "per_person", 3), 9999);
    assert.ok(Number.isInteger(unitPriceTotalCents(1250, "per_person", 3)));
  });
});

describe("booking unit pricing — normalizePricingUnit", () => {
  it("keeps every supported unit", () => {
    for (const unit of PRICING_UNITS) {
      assert.equal(normalizePricingUnit(unit), unit);
    }
  });

  it("reads the historical 'per person' wording as per_person", () => {
    // Older rows store the label rather than the unit, e.g. 'Per person'.
    assert.equal(normalizePricingUnit("Per person"), "per_person");
    assert.equal(normalizePricingUnit("per hour"), "per_hour");
  });

  it("reads hyphenated or mixed-case wording as the same unit", () => {
    assert.equal(normalizePricingUnit("PER-PERSON"), "per_person");
    assert.equal(normalizePricingUnit("per person "), "per_person");
    assert.equal(normalizePricingUnit("Per_Hour"), "per_hour");
  });

  it("falls back to per_unit for anything unrecognised or absent", () => {
    assert.equal(normalizePricingUnit(undefined), "per_unit");
    assert.equal(normalizePricingUnit(null), "per_unit");
    assert.equal(normalizePricingUnit(""), "per_unit");
    assert.equal(normalizePricingUnit("each kayak maybe"), "per_unit");
  });
});

describe("booking unit pricing — persisted on the booking", () => {
  it("keeps the unit price and basis when supplied on update", () => {
    const patch = sanitizeBookingPatch({
      pricing_option_cents: 2500,
      pricing_unit: "per_person",
      guests: 2,
    });
    assert.equal(patch.pricing_option_cents, 2500);
    assert.equal(patch.pricing_unit, "per_person");
    assert.equal(patch.guests, 2);
  });

  it("clears the basis when it is emptied", () => {
    const patch = sanitizeBookingPatch({ pricing_unit: "" });
    assert.equal(patch.pricing_unit, null);
  });

  it("rejects an unknown basis rather than defaulting it", () => {
    // Defaulting a typo'd unit would silently store a per-person price as a
    // flat one, or worse, leave a per-person booking unmultiplied.
    assert.throws(
      () => sanitizeBookingPatch({ pricing_unit: "per-person" }),
      /pricing_unit must be one of per_person, per_unit, per_hour/
    );
    assert.throws(
      () => sanitizeBookingCreate({ booking_currency: "USD", pricing_unit: "each" }),
      /pricing_unit must be one of/
    );
  });

  it("stores the basis and unit price on create too", () => {
    const clean = sanitizeBookingCreate({
      customer_id: "11111111-1111-4111-8111-111111111111",
      activity_id: "22222222-2222-4222-8222-222222222222",
      booking_currency: "MVR",
      pricing_option_cents: 1900,
      pricing_unit: "per_person",
    });
    assert.equal(clean.pricing_option_cents, 1900);
    assert.equal(clean.pricing_unit, "per_person");
  });

  it("defaults a new booking's unit price to zero rather than null", () => {
    const clean = sanitizeBookingCreate({ booking_currency: "USD" });
    assert.equal(clean.pricing_option_cents, 0);
    assert.equal(clean.pricing_unit, null);
  });
});

describe("booking unit pricing — admin form wiring", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const form = read("app/admin/bookings/BookingForm.tsx");

  it("converts the money when the currency changes", () => {
    // Switching USD to MVR must not relabel 100.00 as MVR 100.00.
    assert.match(form, /function changeCurrency\(/);
    assert.match(form, /convertToBasisCurrency\(c, from, to\)/);
  });

  it("drives the total from the unit price and party size", () => {
    assert.match(form, /function applyUnitPrice\(/);
    assert.match(form, /unitPriceTotalCents\(cents\(price\), unit, Number\(pax\)\)/);
  });

  it("shows the full calculation and both currencies", () => {
    assert.match(form, /className="bookingCalc"/);
    assert.match(form, /per person = /);
    assert.match(form, /At \{EXCHANGE_RATE_MVR_PER_USD\} MVR\/USD/);
  });

  it("saves the unit price and basis with the booking", () => {
    assert.match(form, /pricing_option_cents: form\.pricing_option_cents \? parseMajorInput/);
    assert.match(form, /pricing_unit: hasUnitPrice \? form\.pricing_unit/);
  });

  it("warns when net does not match total minus commission", () => {
    assert.match(form, /netMatchesTotal/);
    assert.match(form, /bookingCalcWarn/);
  });

  it("labels each new pricing control exactly once", () => {
    // The guests box already existed above; wiring the unit price to it must
    // not add a second box with the same id, which would break the label.
    for (const id of ["bf-admin-unit-price", "bf-admin-unit", "bf-guests", "bf-admin-currency"]) {
      const count = [...form.matchAll(new RegExp(`id="${id}"`, "g"))].length;
      assert.equal(count, 1, `Expected exactly one element with id="${id}", found ${count}`);
      const labelled = [...form.matchAll(new RegExp(`htmlFor="${id}"`, "g"))].length;
      assert.equal(labelled, 1, `Expected exactly one label for "${id}", found ${labelled}`);
    }
  });
});

describe("signature pad — device pixel ratio", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const guest = read("app/rental/[token]/SignCanvas.tsx");
  const staff = read("app/admin/components/SignaturePad.tsx");

  it("scales the context once, not twice", () => {
    // getPos returns CSS pixels, so dividing them by the ratio again on top of
    // ctx.scale multiplied every coordinate by dpr and collapsed the signature
    // into the top-left corner. Neither pad may divide by dpr.
    assert.doesNotMatch(guest, /\/\s*\(window\.devicePixelRatio \|\| 1\)/);
    assert.match(guest, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
    assert.match(staff, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
  });

  it("uses setTransform rather than scale so a resize cannot compound it", () => {
    assert.doesNotMatch(guest, /ctx\.scale\(/);
  });

  it("sizes the staff pad's backing store to the screen", () => {
    assert.match(staff, /canvas\.width = Math\.round\(width \* dpr\)/);
    assert.match(staff, /canvas\.height = Math\.round\(height \* dpr\)/);
  });

  it("keeps drawing when a finger slides off the box", () => {
    assert.match(guest, /setPointerCapture/);
    // pointerleave used to end the stroke mid-signature.
    assert.doesNotMatch(guest, /"pointerleave"/);
  });

  it("re-measures the canvas when the box resizes", () => {
    assert.match(guest, /new ResizeObserver/);
  });

  it("interpolates between reported points so a fast stroke is not a chord", () => {
    assert.match(guest, /getCoalescedEvents/);
  });

  it("clears the whole backing store", () => {
    assert.match(guest, /ctx\.setTransform\(1, 0, 0, 1, 0, 0\)/);
  });

  it("crops the exported signature to the ink", () => {
    // A wide mostly-blank canvas forced into the PDF's fixed 70x20mm frame is what
    // made a real signature read as a single line.
    assert.match(guest, /cropToInk\(canvas\)/);
    assert.match(staff, /cropToInk\(canvas\)/);
  });

  it("refuses to store a blank staff signature", () => {
    assert.match(staff, /canvasHasInk\(canvas\)/);
  });

  it("fits the signature into the PDF box without stretching it", () => {
    const pdf = read("lib/consent-pdf.ts");
    assert.match(pdf, /getImageProperties\(dataUrl\)/);
    assert.doesNotMatch(pdf, /doc\.addImage\(dataUrl, fmt, x, y, w, h\)/);
  });
});

describe("guest email — agent QR flow", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const agent = read("app/agent/[token]/AgentBookingClient.tsx");
  const sql = readMigration("082_agent_booking_email.sql");

  it("collects and validates an email like the other guest flows", () => {
    assert.match(agent, /const \[guestEmail, setGuestEmail\] = useState\(""\)/);
    assert.match(agent, /isValidEmail\(guestEmail\)/);
    assert.match(agent, /type="email"/);
  });

  it("sends it to the rpc", () => {
    assert.match(agent, /p_guest_email: guestEmail\.trim\(\)/);
  });

  it("rejects a missing or invalid email server-side", () => {
    assert.match(sql, /NOT public\.is_valid_email\(v_email_clean\)/);
    assert.match(sql, /lower\(NULLIF\(trim\(COALESCE\(p_guest_email, ''\)\), ''\)\)/);
  });

  it("stores it on the customer and backfills a blank one", () => {
    assert.match(sql, /INSERT INTO public\.customers \(full_name, phone, email\)/);
    assert.match(sql, /UPDATE public\.customers SET email = v_email_clean/);
  });

  it("drops the old overload so no caller can skip the email", () => {
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.submit_agent_booking\(TEXT, JSONB, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN\)/);
  });

  it("regrants execute on the new signature", () => {
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_agent_booking\(TEXT, JSONB, TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN\) TO anon/);
    assert.match(sql, /TO authenticated/);
  });

  it("runs as one transaction", () => {
    assert.match(sql, /BEGIN;/);
    assert.match(sql, /COMMIT;/);
  });

  it("shows the stored email in the admin bookings list", () => {
    // The select omitted customers.email, so staff could not see whose booking it
    // was without opening each one.
    assert.match(read("lib/supabase/actions.ts"), /customers\(full_name, phone, hotel, email\)/);
    assert.match(read("app/admin/bookings/BookingPageClient.tsx"), /mailto:\$\{guestEmail\}/);
  });
});

describe("migration 081 — booking pricing basis and the 19 rate", () => {
  const sql = readMigration("081_booking_pricing_unit_and_rate_19.sql");

  it("adds a pricing_unit column on bookings", () => {
    assert.match(sql, /ALTER TABLE public\.bookings[\s\S]*ADD COLUMN IF NOT EXISTS pricing_unit TEXT/);
  });

  it("constrains the basis to the three real units, or null", () => {
    assert.match(sql, /CHECK \(pricing_unit IS NULL OR pricing_unit IN \('per_person', 'per_unit', 'per_hour'\)\)/);
  });

  it("names the constraint so a rerun cannot add a second one", () => {
    assert.match(sql, /pg_constraint WHERE conname = 'bookings_pricing_unit_check'/);
  });

  it("documents the column as a snapshot rather than a live price setting", () => {
    assert.match(sql, /COMMENT ON COLUMN public\.bookings\.pricing_unit/);
  });

  it("defaults the unit price to zero and the new-booking rate to 19", () => {
    assert.match(sql, /ALTER COLUMN pricing_option_cents SET DEFAULT 0/);
    assert.match(sql, /ALTER COLUMN exchange_rate_mvr_per_usd SET DEFAULT 19/);
  });

  it("redefines the live booking RPC so new bookings snapshot 19", () => {
    // The walk-in form and the public wizard both call this RPC, and it passes
    // its own rate, so a column default alone would not reach them.
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_public_booking_group_v2\(/);
    assert.match(sql, /v_exchange_rate\s+NUMERIC\(10,4\) := 19;/);
    assert.doesNotMatch(sql, /v_exchange_rate\s+NUMERIC\(10,4\) := 18;/);
  });

  it("redefines the partner-split trigger with the same rate", () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.auto_partner_split_bookings\(\)/);
    assert.match(sql, /COALESCE\(NEW\.exchange_rate_mvr_per_usd, 19\)/);
  });

  it("keeps the RPC signature and security settings", () => {
    assert.match(sql, /\$\$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;/);
  });

  it("does not rewrite the rate on existing bookings", () => {
    // That column is a per-booking snapshot; backfilling 19 over 18 would
    // restate revenue that has already been reported.
    assert.doesNotMatch(sql, /UPDATE\s+public\.bookings/i);
  });

  it("runs as one transaction", () => {
    assert.match(sql, /begin;/i);
    assert.match(sql, /commit;/i);
  });
});

describe("party-sized pricing — forms and RPC agree", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
  const walkin = read("app/walkin/[activitySlug]/WalkinBookingClient.tsx");
  const form = read("app/components/BookingForm.tsx");
  const migration = read("supabase/migrations/079_agent_qr_token_and_party_pricing.sql");

  it("both forms bill by party size through the shared helper", () => {
    assert.match(walkin, /partyAdjustedCents\(\s*it\.selectedPriceCents,\s*it\.pricingOptions,\s*it\.selectedOption,\s*it\.priceNote,\s*partySize/);
    assert.match(form, /partyAdjustedCents\(\s*selectedPriceCents,\s*pricingOptions,\s*selectedOption,\s*priceNote,\s*totalGuests/);
    assert.match(form, /partyAdjustedCents\(addonUnitPrice\(a, label\), a\.pricingOptions, label, a\.priceNote, totalGuests\)/);
  });

  it("the page hands each trip's price note to the walk-in form", () => {
    const page = read("app/walkin/[activitySlug]/page.tsx");
    assert.match(page, /priceNote=\{activity\.priceNote\}/);
    assert.match(page, /priceNote: a\.priceNote/);
  });

  it("the RPC charges the resolved price x guests only for per-person rates", () => {
    // No hardcoded guest multiplier anywhere in the resolver.
    assert.doesNotMatch(migration, /v_opt_price \* \d/);
    assert.match(migration, /v_act_base := COALESCE\(v_act_base, 0\) \* v_total_guests/);
    assert.match(migration, /WHEN v_has_pricing THEN 'per_unit'/);
    assert.match(migration, /lower\(v_note\) LIKE '%person%' THEN 'per_person'/);
    // A guest-supplied label is never trusted for money: it must match a row.
    assert.match(migration, /WHERE activity_id = v_act_id AND label = v_opt_label/);
  });
});

// ---------------------------------------------------------------------------
// Zoho Sheet adapter — response shapes that silently emptied the ledger
// ---------------------------------------------------------------------------
describe("zoho sheet adapter — api domain + sparse range payload", () => {
  it("maps the generic token api_domain onto the region's sheet host", () => {
    // Data API v2 is only served from sheet.<region>; posting to
    // www.zohoapis.com answers 404 "API endpoint not found".
    assert.equal(sheetApiDomain("https://www.zohoapis.com", "https://sheet.zoho.com"), "https://sheet.zoho.com");
    assert.equal(sheetApiDomain("https://www.zohoapis.in", "https://sheet.zoho.com"), "https://sheet.zoho.in");
    assert.equal(sheetApiDomain("https://www.zohoapis.eu", "https://sheet.zoho.com"), "https://sheet.zoho.eu");
    assert.equal(sheetApiDomain("https://www.zohoapis.com.au", "https://sheet.zoho.com"), "https://sheet.zoho.com.au");
    assert.equal(sheetApiDomain(undefined, "https://sheet.zoho.com"), "https://sheet.zoho.com");
    assert.equal(sheetApiDomain("not a url", "https://sheet.zoho.com"), "https://sheet.zoho.com");
  });

  it("reads the v2 range_details payload instead of the absent content array", () => {
    const v2 = {
      range_details: [
        {
          row_index: 1,
          row_details: [
            { column_index: 1, content: "Date" },
            { column_index: 2, content: "Title" },
            { column_index: 3, content: "Amount" },
          ],
        },
        {
          row_index: 2,
          row_details: [
            { column_index: 1, content: "2026-09-21" },
            { column_index: 3, content: "2050.00" },
          ],
        },
      ],
    };
    assert.deepEqual(flattenRangeContent(v2), [
      ["Date", "Title", "Amount"],
      ["2026-09-21", "", "2050.00"],
    ]);
  });

  it("still understands the dense content array", () => {
    assert.deepEqual(
      flattenRangeContent({
        content: [[{ display_value: "Date" }, { display_value: "Title" }], [{}, {}]],
      }),
      [["Date", "Title"], ["", ""]],
    );
  });

  it("feeds those rows into the ledger parser", () => {
    const rows = flattenRangeContent({
      range_details: [
        { row_details: [{ column_index: 1, content: "Date" }, { column_index: 2, content: "Title" }, { column_index: 3, content: "Amount" }, { column_index: 4, content: "Currency" }] },
        { row_details: [{ column_index: 1, content: "2026-09-21" }, { column_index: 2, content: "petrol refill 100L" }, { column_index: 3, content: "2050.00" }, { column_index: 4, content: "MVR" }] },
      ],
    });
    const parsed = parseSheetRows("expense", rows, "2026-10-02");
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "petrol refill 100L");
    assert.equal(parsed[0].amountCents, 205000);
    assert.equal(parsed[0].currency, "MVR");
    assert.equal(parsed[0].ledgerDate, "2026-09-21");
  });
});

describe("zoho sheet adapter — id write-back column", () => {
  it("stamps the id into the Id column, not column A", () => {
    assert.equal(idHeaderColumn(["Date", "Title", "Amount", "Id"]), 4);
    assert.equal(idHeaderColumn(["id", "Date", "Title", "Amount"]), 1);
    assert.equal(idHeaderColumn(["Date", "Title", "Amount"]), 1);
  });

  it("converts column numbers to sheet letters", () => {
    assert.equal(columnLetter(1), "A");
    assert.equal(columnLetter(8), "H");
    assert.equal(columnLetter(26), "Z");
    assert.equal(columnLetter(27), "AA");
  });
});

describe("finance sync — ledger write failures are never silent", () => {
  it("throws instead of reporting success when a write fails", () => {
    assert.throws(
      () => assertWriteOk({ error: { message: "connection reset" } }, 'import "Expenses" row 2'),
      /Could not import "Expenses" row 2: connection reset/,
    );
    assert.doesNotThrow(() => assertWriteOk({ error: null }, "import"));
    assert.doesNotThrow(() => assertWriteOk(null, "import"));
  });
});


describe("received money drives the reports", () => {
  function row(over: Partial<RangeBooking>): RangeBooking {
    return {
      id: "b1", booking_ref: "OB-TEST", booking_date: null, status: "confirmed",
      payment_status: "partial", booking_currency: "USD", guests: 2,
      adults: 2, children_count: 0, source: "walk_in",
      total_cents: 10000, estimated_total_cents: 10000, net_cents: 8000, commission_cents: 2000,
      ...over,
    } as RangeBooking;
  }

  it("counts a partial payment in proportion instead of all-or-nothing", () => {
    const b = row({});
    assert.equal(grossCents(b), 10000);
    assert.equal(collectedGrossCents(b, 9000), 9000);
    assert.equal(collectedGrossCents(b, 4000), 4000);
    assert.equal(collectedGrossCents(b, 0), 0);
  });

  it("never counts more than the booking is worth", () => {
    const b = row({});
    assert.equal(collectedGrossCents(b, 50000), 10000);
    assert.equal(paidRatio(10000, 50000), 1);
  });

  it("brings the operator's share of received money into profit", () => {
    const b = row({});
    assert.equal(collectedNetCents(b, 4000), Math.round(8000 * 0.4));
    assert.equal(collectedNetCents(b, 0), 0);
    const fullyPaid = collectedNetCents(b, 10000);
    assert.equal(fullyPaid, netCents(b));
  });

  it("ignores voided, refunded and pending payments", () => {
    const payments = [
      { booking_id: "b1", status: "completed", amount_cents: 3000, converted_amount_cents: 3000, currency: "USD", booking_currency: "USD" },
      { booking_id: "b1", status: "voided", amount_cents: 9000, converted_amount_cents: 9000, currency: "USD", booking_currency: "USD" },
      { booking_id: "b1", status: "pending", amount_cents: 500, currency: "USD", booking_currency: "USD" },
      { booking_id: "b1", status: "refunded", amount_cents: 700, currency: "USD", booking_currency: "USD" },
    ];
    assert.equal(isCompletedPayment(payments[0]), true);
    assert.equal(isCompletedPayment(payments[1]), false);
    const map = paidByBooking(payments);
    assert.equal(map.get("b1"), 3000);
  });

  it("reads a legacy payment in the booking currency only when they agree", () => {
    assert.equal(
      paymentAmountInBookingCurrency({ amount_cents: 5000, converted_amount_cents: 0, currency: "USD", booking_currency: "USD" }),
      5000,
    );
    assert.equal(
      paymentAmountInBookingCurrency({ amount_cents: 5000, converted_amount_cents: 0, currency: "MVR", booking_currency: "USD" }),
      0,
      "an unconverted cross-currency payment must not be read as dollars",
    );
    assert.equal(
      paymentAmountInBookingCurrency({ amount_cents: 5000, converted_amount_cents: 12000, currency: "MVR", booking_currency: "USD" }),
      12000,
    );
  });

  it("books cash-in in the currency the money was actually received in", () => {
    const usdBookingPaidInMvr = { booking_currency: "USD", currency: "MVR", amount_cents: 150000, converted_amount_cents: 5000 };
    assert.equal(cashInCurrency(usdBookingPaidInMvr), "USD");
    assert.equal(cashInCents(usdBookingPaidInMvr), 5000);

    const rental = { booking_currency: null, currency: "MVR", amount_cents: 150000, converted_amount_cents: 150000 };
    assert.equal(cashInCurrency(rental), "MVR");
    assert.equal(cashInCents(rental), 150000);
  });

  it("groups payments by booking, skipping the ones with no booking", () => {
    const map = paidByBooking([
      { booking_id: "a", status: "completed", amount_cents: 100, converted_amount_cents: 100, currency: "USD", booking_currency: "USD" },
      { booking_id: "a", status: "completed", amount_cents: 250, currency: "USD", booking_currency: "USD" },
      { booking_id: null, status: "completed", amount_cents: 999, converted_amount_cents: 999, currency: "USD", booking_currency: "USD" },
    ]);
    assert.equal(map.get("a"), 350);
    assert.equal(map.size, 1);
  });
});

describe("migration 083 — payments mirrored into the income ledger", () => {
  const sql = readMigration("083_payment_income_ledger.sql");

  it("links a ledger row 1:1 to the payment it came from", () => {
    assert.match(sql, /add column if not exists payment_id uuid references public\.payments \(id\) on delete cascade/);
    assert.match(sql, /create unique index if not exists other_income_payment_id_idx/);
    assert.match(sql, /where payment_id is not null/);
  });

  it("keeps the ledger in step on payment, void and re-issue", () => {
    assert.match(sql, /create or replace function public\.sync_payment_to_income/);
    assert.match(sql, /after insert or update on public\.payments/);
    assert.match(sql, /if new\.status = 'completed' then/);
    assert.match(sql, /elsif old\.status = 'completed' then/);
    assert.match(sql, /set archived_at = coalesce\(archived_at, now\(\)\)/);
    assert.match(sql, /archived_at   = null/);
    assert.match(sql, /category      = v_kind/);
  });

  it("backfills only completed payments that have no row yet", () => {
    assert.match(sql, /where p\.status = 'completed'/);
    assert.match(sql, /and not exists \(select 1 from public\.other_income oi where oi\.payment_id = p\.id\)/);
    assert.match(sql, /commit;/);
  });

  it("runs as a definer for the roles that write payments, and nobody else", () => {
    assert.match(sql, /security definer/);
    assert.match(sql, /revoke execute on function public\.sync_payment_to_income\(\) from public/);
    assert.match(sql, /grant  execute on function public\.sync_payment_to_income\(\) to authenticated/);
    assert.match(sql, /grant  execute on function public\.sync_payment_to_income\(\) to service_role/);
  });
});

describe("invoice delivery — emailed invoice equals the downloaded one", () => {
  const delivery = fs.readFileSync(path.resolve(__dirname, "../lib/invoice-delivery.ts"), "utf-8");
  const bookingSend = fs.readFileSync(path.resolve(__dirname, "../app/api/admin/invoices/booking/[id]/send/route.ts"), "utf-8");
  const rentalSend = fs.readFileSync(path.resolve(__dirname, "../app/api/admin/invoices/rental/[id]/send/route.ts"), "utf-8");
  const bookingPage = fs.readFileSync(path.resolve(__dirname, "../app/admin/bookings/BookingPageClient.tsx"), "utf-8");
  const rentalPage = fs.readFileSync(path.resolve(__dirname, "../app/admin/rentals/RentalPageClient.tsx"), "utf-8");

  it("renders through the same GET handlers staff use for the Download button", () => {
    assert.match(delivery, /GET as bookingInvoicePdf/);
    assert.match(delivery, /GET as rentalReceiptPdf/);
    assert.match(delivery, /kind === "booking" \? bookingInvoicePdf : rentalReceiptPdf/);
  });

  it("sends the PDF as an attachment", () => {
    assert.match(delivery, /attachments: \[/);
    assert.match(delivery, /contentType: "application\/pdf"/);
    assert.match(delivery, /Buffer\.from\(input\.pdf\.bytes\)\.toString\("base64"\)/);
  });

  it("both send routes are staff-only and ask for an address when none is on file", () => {
    for (const src of [bookingSend, rentalSend]) {
      assert.match(src, /export async function POST/);
      assert.match(src, /isFinanceRole\(role\)/);
      assert.match(src, /error: "missing_recipient"/);
      assert.match(src, /sendInvoiceEmail\(/);
    }
  });

  it("staff get a send button on both the booking and the rental rows", () => {
    assert.match(bookingPage, /<SendInvoiceButton[\s\S]*?kind="booking"/);
    assert.match(rentalPage, /<SendInvoiceButton[\s\S]*?kind="rental"/);
    const button = fs.readFileSync(path.resolve(__dirname, "../app/admin/components/SendInvoiceButton.tsx"), "utf-8");
    assert.match(button, /fetch\(`\/api\/invoices|\/api\/admin\/invoices\/\$\{kind\}\/\$\{id\}\/send`/);
    assert.match(button, /window\.prompt/);
  });
});

describe("rental receipt — deposit is a hold, not a debt", () => {
  const rentalRoute = fs.readFileSync(path.resolve(__dirname, "../app/api/admin/invoices/rental/[id]/pdf/route.ts"), "utf-8");
  const guestCopies = fs.readFileSync(path.resolve(__dirname, "../lib/guest-copies.ts"), "utf-8");
  const pdf = fs.readFileSync(path.resolve(__dirname, "../lib/invoice-pdf.ts"), "utf-8");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");

  it("leaves the deposit out of what the guest owes, as create_rental_payment does", () => {
    assert.match(rentalRoute, /payableTotal = Math\.round\([\s\S]*?rental_charge_cents\) \|\| 0\) \+\s*\(Number\(rental\.additional_charges_cents\) \|\| 0\),/);
    assert.doesNotMatch(rentalRoute, /deposit_cents\) \|\| 0\) \+\s*\(Number\(rental\.additional_charges_cents/);
    assert.match(guestCopies, /rental_charge_cents\) \|\| 0\) \+\s*\(Number\(receipt\.additional_charges_cents\)/);
    assert.doesNotMatch(guestCopies, /receipt\.deposit_cents\) \|\| 0\) \+\s*\(Number\(receipt\.additional_charges_cents/);
  });

  it("prints the deposit after the total, labelled as refundable", () => {
    assert.match(pdf, /Deposit held \(refundable, not part of total\)/);
    const chargesBlock = pdf.slice(pdf.indexOf('doc.text(`Rental charge`'), pdf.indexOf("Deposit held (refundable"));
    assert.doesNotMatch(chargesBlock, /Deposit/);
  });

  it("quotes the newest completed payment, in a stable order", () => {
    assert.match(rentalRoute, /\.sort\(\(a, b\) =>\s*String\(b\.created_at \|\| ""\)\.localeCompare\(String\(a\.created_at \|\| ""\)\)/);
    assert.match(guestCopies, /\.sort\(\(a, b\) =>\s*String\(b\.created_at \|\| ""\)\.localeCompare\(String\(a\.created_at \|\| ""\)\)/);
  });

  it("recomputes the rental payment status when extra charges are added on return", () => {
    assert.match(actions, /export async function returnEquipment/);
    assert.match(actions, /additional_charges_cents: addedCharges,[\s\S]*?payment_status: paymentStatus,/);
  });
});

describe("quick invoice — raise it, send it, mark it paid", () => {
  const migration = readMigration("084_quick_invoice_email_optional.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const client = fs.readFileSync(path.resolve(__dirname, "../app/admin/invoices/InvoicesClient.tsx"), "utf-8");
  const modal = fs.readFileSync(path.resolve(__dirname, "../app/admin/invoices/QuickInvoiceModal.tsx"), "utf-8");

  it("waives the 072 email gate only for the rows that asked for it", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS email_optional BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migration, /IF NEW\.email_optional IS TRUE THEN\s+RETURN NEW;/);
    // Everyone else still needs a usable address on the customer record.
    assert.match(migration, /A valid email is required for every booking/);
  });

  it("stores the invoice as a booking so number, PDF and payments come for free", () => {
    assert.match(actions, /export async function createQuickInvoice/);
    assert.match(actions, /const bookingRef = `OB-\$\{Date\.now\(\)\.toString\(36\)\.toUpperCase\(\)\}`/);
    assert.match(actions, /email_optional: emailOptional/);
    assert.match(actions, /payment_status: "unpaid"/);
    assert.match(actions, /revalidatePath\("\/admin\/bookings"\)/);
  });

  it("refuses an invoice with no bill-to, no trip, no amount or no consent", () => {
    assert.match(actions, /Enter the person or company the invoice is for\./);
    assert.match(actions, /Choose what the invoice is for\./);
    assert.match(actions, /if \(amountCents <= 0\) throw new Error\("Invoice amount must be greater than 0\."\)/);
    assert.match(actions, /Confirm the guest agreed to the Consent & Liability before raising the invoice\./);
  });

  it("email stays optional, but a typed address must be valid", () => {
    assert.match(actions, /if \(email && !VALID_EMAIL_RE\.test\(email\)\)/);
    assert.match(actions, /const emailOptional = !VALID_EMAIL_RE\.test/);
    assert.match(modal, /leave blank and share the PDF on WhatsApp/);
    assert.match(modal, /type="email"/);
  });

  it("finds a repeat bill-to instead of splitting them across two customers", () => {
    assert.match(actions, /\.ilike\("email", email\)/);
    assert.match(actions, /\.ilike\("full_name", escapeLikePattern\(billTo\)\)/);
    assert.match(actions, /function escapeLikePattern\(value: string\)/);
  });

  it("mark paid clears exactly the outstanding balance, through the payment path", () => {
    assert.match(actions, /export async function markInvoicePaid/);
    assert.match(actions, /const due = invoiceBalanceCents\(payable,/);
    assert.match(actions, /if \(due <= 0\) throw new Error\("This invoice is already fully paid\."\)/);
    assert.match(actions, /if \(String\(booking\.status\) === "cancelled"\) throw new Error/);
    // Same RPC as every other payment: status, Collected, profit and the
    // income-ledger mirror all move together.
    assert.match(actions, /return await createPayment\(\{[\s\S]*?notes: "Marked paid from the Invoices page",\s*\}\);/);
  });

  it("the page offers + New invoice, the PDF, the email and the paid switch", () => {
    assert.match(client, /\+ New invoice/);
    assert.match(client, /invoices\/booking\/\$\{[^}]+\}\/pdf\?download=1/);
    assert.match(client, /<SendInvoiceButton[\s\S]*?kind="booking"/);
    assert.match(client, /function handleMarkPaid/);
    assert.match(client, /markInvoicePaid\(invoice\.id, "cash"\)/);
    assert.match(modal, /form="quick-invoice-form"/);
  });
});

describe("invoice balance — the number Mark paid clears", () => {
  it("owes the full amount until money arrives", () => {
    assert.equal(invoiceBalanceCents(25000, []), 25000);
    assert.equal(invoiceBalanceCents(25000, []), invoiceBalanceCents(25000, []));
  });

  it("subtracts money actually received", () => {
    const paid = [
      { status: "completed", amount_cents: 10000, converted_amount_cents: 10000, currency: "USD", booking_currency: "USD" },
      { status: "completed", amount_cents: 5000, converted_amount_cents: 5000, currency: "USD", booking_currency: "USD" },
    ];
    assert.equal(invoiceBalanceCents(25000, paid), 10000);
  });

  it("ignores voided, refunded and pending payments", () => {
    const payments = [
      { status: "voided", amount_cents: 25000, converted_amount_cents: 25000, currency: "USD", booking_currency: "USD" },
      { status: "refunded", amount_cents: 4000, converted_amount_cents: 4000, currency: "USD", booking_currency: "USD" },
      { status: "pending", amount_cents: 6000, converted_amount_cents: 6000, currency: "USD", booking_currency: "USD" },
    ];
    assert.equal(invoiceBalanceCents(25000, payments), 25000);
  });

  it("reads cross-currency payments in the invoice's own currency", () => {
    const converted = [
      { status: "completed", amount_cents: 150000, converted_amount_cents: 5000, currency: "MVR", booking_currency: "USD" },
    ];
    assert.equal(invoiceBalanceCents(25000, converted), 20000);
    const unconverted = [
      { status: "completed", amount_cents: 150000, converted_amount_cents: 0, currency: "MVR", booking_currency: "USD" },
    ];
    assert.equal(invoiceBalanceCents(25000, unconverted), 25000);
  });

  it("never reports a negative balance on an overpaid invoice", () => {
    const over = [{ status: "completed", amount_cents: 40000, converted_amount_cents: 40000, currency: "USD", booking_currency: "USD" }];
    assert.equal(invoiceBalanceCents(25000, over), 0);
    assert.equal(invoiceBalanceCents(0, []), 0);
    assert.equal(invoiceBalanceCents(-100, []), 0);
  });
});

describe("walk-in rental requests — QR self-service (migration 085)", () => {
  const migration = readMigration("085_rental_walkin_requests.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const client = fs.readFileSync(
    path.resolve(__dirname, "../app/walkin/rental/WalkinRentalClient.tsx"),
    "utf-8"
  );
  const page = fs.readFileSync(path.resolve(__dirname, "../app/walkin/rental/page.tsx"), "utf-8");
  const panel = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/rentals/RentalRequestsPanel.tsx"),
    "utf-8"
  );
  const issueModal = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/rentals/IssueRentalRequestModal.tsx"),
    "utf-8"
  );
  const rentalsClient = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/rentals/RentalPageClient.tsx"),
    "utf-8"
  );

  it("the basket exists before any unit is assigned", () => {
    assert.match(migration, /create table if not exists public\.rental_requests/);
    assert.match(migration, /items\s+jsonb not null default '\[\]'::jsonb/);
    assert.match(migration, /status\s+text not null default 'open'\s+check \(status in \('open', 'issued', 'cancelled'\)\)/);
    assert.match(migration, /add column if not exists rental_request_id uuid references public\.rental_requests \(id\)/);
  });

  it("relaxes the 069 check so a rental waiver can hang off the request", () => {
    assert.match(migration, /drop constraint if exists consent_forms_rental_or_activity_check/);
    assert.match(migration, /consent_type = 'equipment_rental'\s+and activity_id is null\s+and \(rental_id is not null or rental_request_id is not null\)/);
    // Booking consents still require an activity.
    assert.match(migration, /\(consent_type <> 'equipment_rental' and activity_id is not null\)/);
  });

  it("the guest only ever sees what is actually free", () => {
    assert.match(migration, /create or replace function public\.get_rental_catalog\(\)/);
    assert.match(migration, /count\(\*\) filter \(where u\.is_free\)/);
    assert.match(migration, /r\.status in \('checked_out', 'overdue'\)/);
    assert.match(client, /rpc\("get_rental_catalog"\)/);
    assert.match(client, /Math\.min\(next, max\)/);
    assert.match(client, /free_units/);
  });

  it("raising a request validates the guest and the basket in one call", () => {
    assert.match(migration, /create or replace function public\.submit_rental_request/);
    assert.match(migration, /if v_email is null or not public\.is_valid_email\(v_email\) then/);
    assert.match(migration, /'Only ' \|\| v_free \|\| ' × ' \|\| v_name_i \|\| ' available right now\.'/);
    assert.match(migration, /'Choose at least one item to rent\.'|Choose at least one item/);
    assert.match(migration, /grant\s+execute on function public\.submit_rental_request[^;]+ to anon/);
  });

  it("refuses a request that could never be signed (070 guest details)", () => {
    // sign_consent_form will not sign an equipment_rental waiver until these
    // are on the row, so they are compulsory at REQUEST time too.
    assert.match(migration, /Migration 070 refuses to sign a rental waiver until these are on the row/);
    assert.match(migration, /nullif\(trim\(p_nationality\), ''\) is null/);
    assert.match(migration, /p_date_of_birth is null/);
    assert.match(migration, /nullif\(trim\(p_hotel\), ''\) is null/);
    assert.match(migration, /nullif\(trim\(p_emergency_contact_name\), ''\) is null/);
    assert.match(migration, /nullif\(trim\(p_emergency_contact_phone\), ''\) is null/);
    assert.match(client, /Nationality is required\./);
    assert.match(client, /Date of birth is required\./);
    assert.match(client, /Resort \/ hotel is required\./);
    assert.match(client, /Emergency contact name is required\./);
    assert.match(client, /Enter a valid emergency contact number\./);
  });

  it("a re-submission supersedes the last UNISSUED waiver only", () => {
    assert.match(migration, /cf\.rental_id is null/);
    assert.match(migration, /cf\.status in \('pending', 'signed'\)/);
    assert.match(migration, /update public\.rental_requests\s+set status = 'cancelled', cancelled_at = now\(\)/);
    // A signed waiver needs 080's transaction-local flag, or the immutability
    // trigger rejects the void outright.
    assert.match(migration, /perform set_config\('app\.consent_void_from_cancel', '1', true\)/);
    assert.match(migration, /Walk-in rental request superseded/);
    // An issued waiver is parked on its first unit instead, so it is never voided.
    assert.match(actions, /update\(\{ rental_id: createdRows\[0\].id \}\)/);
    assert.match(actions, /\.eq\("status", "pending"\)/);
  });

  it("the guest signs through the same token path every other consent uses", () => {
    assert.match(client, /rpc\("submit_rental_request"/);
    assert.match(client, /rpc\("sign_consent_form"/);
    assert.match(client, /p_consent_type: "equipment_rental"/);
    assert.match(client, /p_expected_consent_version: consentVersion/);
    assert.match(client, /p_parent_guardian_name: isMinor\(\)/);
    assert.match(client, /sessionStorage/);
    assert.match(page, /robots: \{ index: false, follow: true \}/);
  });

  it("issuing hands over whole units, all or nothing", () => {
    assert.match(actions, /export async function issueRentalRequest/);
    assert.match(actions, /Select exactly \$\{totalQty\} unit/);
    assert.match(actions, /Assign exactly \$\{qty\} × \$\{name\}/);
    assert.match(actions, /is already checked out\./);
    assert.match(actions, /new Set\(unitIds\)\.size !== unitIds\.length/);
    assert.match(actions, /rental_request_id: requestId/);
    assert.match(actions, /export async function getFreeEquipmentForIssue/);
    assert.match(actions, /\.in\("status", \["checked_out", "overdue"\]\)/);
  });

  it("the signed waiver rides along with every unit in the basket", () => {
    assert.match(actions, /guest_signature_data_url: consent\?\.signature_data_url \|\| null/);
    assert.match(actions, /guest_signed_at: consent\?\.signed_at \|\| null/);
    // Return: one waiver covers the request, so every row can come back.
    assert.match(actions, /consentQuery = consentQuery\.eq\("rental_request_id", String\(rentalRow\.rental_request_id\)\)/);
    assert.match(actions, /Guest consent & liability form must be signed before this rental can be returned\./);
    // The table shows the request-level waiver instead of a blank dash.
    assert.match(actions, /byRequest\.get\(String\(r\.rental_request_id\)\)/);
  });

  it("money taken at issue is split across the units that carry a charge", () => {
    assert.match(actions, /Payment is more than the total rental charges/);
    assert.match(actions, /rpc\("create_rental_payment", \{/);
    assert.match(actions, /Collected when the walk-in request was issued/);
    assert.match(actions, /status: "issued", issued_at/);
    assert.match(actions, /revalidatePath\("\/admin\/rentals"\)/);
  });

  it("staff see the queue, the QR and the issue dialog", () => {
    assert.match(actions, /export async function getRentalRequests/);
    assert.match(actions, /export async function cancelRentalRequest/);
    assert.match(panel, /Awaiting signature/);
    assert.match(panel, /Waiver signed/);
    assert.match(panel, /\/consent\/\$\{token\}/);
    assert.match(issueModal, /issueRentalRequest\(request\.id/);
    assert.match(issueModal, /Take payment now/);
    assert.match(rentalsClient, /Walk-in QR/);
    assert.match(rentalsClient, /RentalRequestsPanel/);
    assert.match(rentalsClient, /const isWalkinBasket = Boolean\(r\.rental_request_id\)/);
  });

  it("the queue's waiver embed is not ambiguous (PGRST201 blanked the page)", () => {
    // 085 gave rental_requests two routes to consent_forms — its own
    // consent_form_id and consent_forms.rental_request_id — so an unhinted
    // embed is rejected and getRentalRequests throws, taking the whole
    // rentals page down with it.
    const migration = readMigration("085_rental_walkin_requests.sql");
    assert.match(migration, /add column if not exists rental_request_id uuid references public\.rental_requests/);
    assert.match(actions, /consent_forms!consent_forms_rental_request_id_fkey/);
    const at = actions.indexOf("export async function getRentalRequests");
    const body = actions.slice(at, at + 700);
    assert.match(body, /consent_forms!consent_forms_rental_request_id_fkey/);
    assert.doesNotMatch(body, /consent_forms\(id, status/);
  });
});

describe("expenses — monthly sheet grid + paste import (migration 086)", () => {
  const migration = readMigration("086_expense_grid_and_categories.sql");
  const actions = fs.readFileSync(path.resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");
  const form = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/expenses/ExpenseForm.tsx"),
    "utf-8"
  );
  const pageClient = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/expenses/ExpensePageClient.tsx"),
    "utf-8"
  );
  const gridModal = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/expenses/ExpenseGridModal.tsx"),
    "utf-8"
  );
  const importModal = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/expenses/ExpenseImportModal.tsx"),
    "utf-8"
  );

  it("a grid cell is keyed so re-saving a month upserts, never duplicates", () => {
    assert.match(migration, /add column if not exists entry_key text/);
    assert.match(migration, /create unique index expenses_entry_key_idx/);
    assert.match(migration, /where entry_key is not null/);
    assert.equal(expenseEntryKey("2023-11-10", "petrol"), "2023-11-10:petrol");
  });

  it("categories become the P&L lines the sheet rolls into", () => {
    // Existing free-form names are mapped across, not left behind.
    assert.match(migration, /set category = 'Fuel'/);
    assert.match(migration, /'Boat Fuel'/);
    assert.match(migration, /set category = 'Repair & Maintenance'/);
    assert.match(migration, /'Maintenance'/);
    assert.match(migration, /set category = 'Hire Equipment'/);
    assert.match(migration, /set category = 'Commissions'/);
    assert.match(migration, /set category = 'Salary'/);
    assert.match(migration, /set category = 'Other Services'/);
    assert.equal(normalizeExpenseCategory("Boat Fuel"), "Fuel");
    assert.equal(normalizeExpenseCategory("Maintenance"), "Repair & Maintenance");
    assert.equal(normalizeExpenseCategory("Crew"), "Salary");
    assert.equal(normalizeExpenseCategory("Equipment"), "Hire Equipment");
    assert.equal(normalizeExpenseCategory("Commission"), "Commissions");
    assert.equal(normalizeExpenseCategory("Repair & Maintance"), "Repair & Maintenance");
    assert.equal(normalizeExpenseCategory("nonsense"), "Other");
    assert.equal(normalizeExpenseCategory(""), "Other");
  });

  it("the grid's columns are the sheet's money columns, each on its P&L line", () => {
    const keys = EXPENSE_GRID_COLUMNS.map((c) => c.key);
    assert.deepEqual(keys, [
      "petrol", "engine_oil", "spark_plug", "oil_filter", "hire_equipment",
      "other_services", "asset_small", "electricity", "salary", "commission",
    ]);
    const byKey = Object.fromEntries(EXPENSE_GRID_COLUMNS.map((c) => [c.key, c.category]));
    assert.equal(byKey.petrol, "Fuel");
    assert.equal(byKey.engine_oil, "Repair & Maintenance");
    assert.equal(byKey.spark_plug, "Repair & Maintenance");
    assert.equal(byKey.oil_filter, "Repair & Maintenance");
    assert.equal(byKey.hire_equipment, "Hire Equipment");
    assert.equal(byKey.other_services, "Other Services");
    assert.equal(byKey.asset_small, "Asset-Small");
    assert.equal(byKey.electricity, "Electricity");
    assert.equal(byKey.salary, "Salary");
    assert.equal(byKey.commission, "Commissions");
    assert.ok(!EXPENSE_CATEGORIES.includes("Petrol" as never));
    assert.ok(EXPENSE_CATEGORIES.includes("Salary" as never));
  });

  it("a petrol cell comes from its own amount or litres × rate", () => {
    const petrol = EXPENSE_GRID_COLUMNS.find((c) => c.key === "petrol")!;
    const fromCell = gridCellExpense({ date: "2023-11-10", column: petrol, amount: 692.4 });
    assert.equal(fromCell?.amount_cents, 69240);
    const fromLitres = gridCellExpense({
      date: "2023-11-10", column: petrol, amount: 0, litres: 40, rate: 17.31,
    });
    assert.equal(fromLitres?.amount_cents, 69240);
    assert.equal(fromLitres?.entry_key, "2023-11-10:petrol");
    assert.match(fromLitres?.notes || "", /40 L × 17\.31 MVR\/L/);
    // An empty cell is not a row.
    assert.equal(gridCellExpense({ date: "2023-11-10", column: petrol, amount: 0 }), null);
    // The detail names the row; the column names it when the cell is bare.
    const named = gridCellExpense({ date: "2023-11-10", column: petrol, amount: 100, detail: "Yamalub 4T" });
    assert.equal(named?.title, "Yamalub 4T");
    const bare = gridCellExpense({ date: "2023-11-10", column: petrol, amount: 100 });
    assert.equal(bare?.title, "Petrol");
  });

  it("month helpers line up with the calendar", () => {
    assert.equal(daysInMonth("2023-11"), 30);
    assert.equal(daysInMonth("2024-02"), 29);
    assert.equal(monthDates("2024-02").length, 29);
    assert.equal(monthDates("2024-02")[0], "2024-02-01");
    assert.equal(nextMonthStart("2023-12"), "2024-01-01");
    assert.equal(nextMonthStart("2024-11"), "2024-12-01");
  });

  it("import reads the sheet's dates, amounts and day-first format", () => {
    assert.equal(parseImportDate("2023-11-10"), "2023-11-10");
    assert.equal(parseImportDate("10/11/2023"), "2023-11-10");
    assert.equal(parseImportDate("10/11/2023.."), "2023-11-10");
    assert.equal(parseImportDate("5/3/24"), "2024-03-05");
    assert.equal(parseImportDate("nonsense"), null);
    assert.equal(parseMajorAmount("MVR 700"), 700);
    assert.equal(parseMajorAmount("1,234.50"), 1234.5);
    assert.equal(parseMajorAmount(""), 0);
  });

  it("a pasted sheet month expands each line into its rows", () => {
    // Cells joined explicitly — leading tabs are the column positions.
    const sheet = [
      ["Date", "Detail", "Liter petrol", "Rate", "Petrol", "Engine Oil", "Sparking Plug", "Oil Filter", "Hire Equipment", "Other Services", "Asset_Small", "Electricity", "Commission"].join("\t"),
      ["10/11/2023", "Fuel", "40", "17.31", "692.40", "", "", "", "", "", "", "", ""].join("\t"),
      ["", "", "", "", "", "", "", "", "", "", "", "128.97", ""].join("\t"),
      ["", "WD 40", "", "", "", "", "", "", "", "110", "", "", ""].join("\t"),
      ["12/11/2023", "", "", "", "", "", "", "", "", "", "", "", ""].join("\t"),
      ["", "Salary", "", "", "", "", "", "", "", "", "", "", ""].join("\t"),
    ].join("\n");
    const { rows, errors } = parseExpenseImport(sheet);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 3);
    const fuel = rows.find((r) => r.category === "Fuel")!;
    assert.equal(fuel.expense_date, "2023-11-10");
    assert.equal(fuel.amount_cents, 69240);
    assert.equal(fuel.title, "Fuel");
    // The blank date above carries down, exactly as the sheet reads.
    const elec = rows.find((r) => r.category === "Electricity")!;
    assert.equal(elec.expense_date, "2023-11-10");
    assert.equal(elec.amount_cents, 12897);
    const services = rows.find((r) => r.category === "Other Services")!;
    assert.equal(services.title, "WD 40");
    assert.equal(services.amount_cents, 11000);
  });

  it("a headerless sheet paste is still read positionally", () => {
    const paste = ["10/11/2023", "Fuel", "40", "17.31", "692.4", "", "", "", "", "", "", "", ""].join("\t");
    const { rows, errors } = parseExpenseImport(paste);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, "Fuel");
    assert.equal(rows[0].amount_cents, 69240);
  });

  it("the live sheet's SALARY column imports as the Salary line", () => {
    const header = ["Date", "Detail", "Liter petrol", "Rate", "Petrol", "Engine Oil", "Sparking Plug", "Oil Filter", "Hire Equipment", "Other Services", "Asset_Small", "Electricity", "SALARY", "Commission"].join("\t");
    const row = ["30/09/2024", "", "", "", "", "", "", "", "", "", "", "", "7000", ""].join("\t");
    const { rows, errors } = parseExpenseImport(`${header}\n${row}`);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, "Salary");
    assert.equal(rows[0].amount_cents, 700000);
    assert.equal(rows[0].expense_date, "2024-09-30");
    assert.equal(rows[0].title, "Salary");
  });

  it("a simple ledger paste lands too, and bad rows are reported not guessed", () => {
    const paste = [
      "date,title,category,amount,currency",
      "2026-09-21,petrol refill 100L,Boat Fuel,2050,MVR",
      "2026-09-22,shop supplies,Supplies,12.50,USD",
      "25/13/2026,broken date,Fuel,10,MVR",
      "2026-09-23,,Fuel,10,MVR",
      "2026-09-24,freebie,Fuel,0,MVR",
    ].join("\n");
    const { rows, errors } = parseExpenseImport(paste);
    assert.equal(rows.length, 2);
    assert.equal(errors.length, 3);
    assert.match(errors.join(" "), /25\/13\/2026|unreadable date/);
    assert.match(errors.join(" "), /missing title/);
    assert.match(errors.join(" "), /above zero/);
    assert.equal(rows[0].category, "Fuel");
    assert.equal(rows[0].amount_cents, 205000);
    assert.equal(rows[1].currency, "USD");
    assert.equal(rows[1].category, "Other");
  });

  it("the grid action upserts by entry_key and clears emptied cells", () => {
    assert.match(actions, /export async function getExpenseGrid/);
    assert.match(actions, /export async function saveExpenseGrid/);
    assert.match(actions, /export async function importExpenseRows/);
    const at = actions.indexOf("export async function saveExpenseGrid");
    const body = actions.slice(at, at + 3400);
    assert.match(body, /\.not\("entry_key", "is", null\)/);
    assert.match(body, /Duplicate grid cell/);
    assert.match(body, /byKey\.delete/);
    assert.match(body, /\.delete\(\)\.in\("id", cleared\)/);
    const gridAt = actions.indexOf("export async function getExpenseGrid");
    const gridBody = actions.slice(gridAt, gridAt + 700);
    assert.match(gridBody, /\.not\("entry_key", "is", null\)/);
  });

  it("an import lands what it can and reports the rest", () => {
    const at = actions.indexOf("export async function importExpenseRows");
    const body = actions.slice(at, at + 2400);
    assert.match(body, /imported: out\.length/);
    assert.match(body, /skipped: errors\.length/);
    // Bad rows never block the good ones.
    assert.doesNotMatch(body, /if \(errors\.length\) throw/);
  });

  it("staff get the grid, the importer and the P&L categories in the form", () => {
    assert.match(pageClient, /▦ Monthly Grid/);
    assert.match(pageClient, /⇪ Import/);
    assert.match(pageClient, /ExpenseGridModal/);
    assert.match(pageClient, /ExpenseImportModal/);
    assert.match(gridModal, /getExpenseGrid\(month\)/);
    assert.match(gridModal, /saveExpenseGrid\(month, drafts\)/);
    assert.match(gridModal, /entry_key: `\$\{date\}:\$\{col\.key\}`/);
    assert.match(gridModal, /fuelTotal/);
    assert.match(importModal, /parseExpenseImport\(text\)/);
    assert.match(importModal, /importExpenseRows\(preview\.rows\)/);
    assert.match(importModal, /accept="\.csv/);
    // The form's presets come from the shared P&L list, not a stale copy.
    assert.match(form, /EXPENSE_CATEGORIES/);
    assert.doesNotMatch(form, /Boat Fuel/);
    assert.doesNotMatch(form, /"Crew"/);
    // Only that format: a fixed dropdown of the sheet's P&L lines, never free text.
    assert.match(form, /<select/);
    assert.doesNotMatch(form, /list="expense-categories"/);
    assert.match(form, /normalizeExpenseCategory\(form\.category\)/);
  });
});

describe("zoho push — expenses back into the accountant's grid", () => {
  const actions = fs.readFileSync(
    path.resolve(__dirname, "../lib/supabase/actions.ts"),
    "utf-8"
  );
  const sheets = fs.readFileSync(path.resolve(__dirname, "../lib/sheets.ts"), "utf-8");
  const financeSync = fs.readFileSync(
    path.resolve(__dirname, "../lib/finance-sync.ts"),
    "utf-8"
  );
  const pageClient = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/expenses/ExpensePageClient.tsx"),
    "utf-8"
  );
  const pushButton = fs.readFileSync(
    path.resolve(__dirname, "../app/admin/components/PushToZohoButton.tsx"),
    "utf-8"
  );

  it("the push grid wears the live sheet's exact 14-column header, SALARY included", () => {
    assert.deepEqual([...ZOHO_GRID_HEADERS], [
      "Date", "Detail", "Liter petrol", "Rate", "Petrol", "Engine Oil",
      "Sparking Plug", "Oil Filter", "Hire Equipment", "Other Services",
      "Asset_Small", "Electricity", "SALARY", "Commission",
    ]);
    const { values } = buildZohoMonthlyGrid([]);
    assert.deepEqual(values[0], [...ZOHO_GRID_HEADERS]);
  });

  it("a grid row lands in its exact column, with litres and rate restored from notes", () => {
    const { values, nonEmpty } = buildZohoMonthlyGrid([
      {
        expense_date: "2026-09-21",
        title: "petrol refill 100L",
        category: "Fuel",
        amount_cents: 205000,
        currency: "MVR",
        entry_key: "2026-09-21:petrol",
        notes: "100 L × 20.5 MVR/L",
      },
    ]);
    assert.deepEqual(values[1], [
      "2026-09-21", "petrol refill 100L", "100", "20.5", "2050.00",
      "", "", "", "", "", "", "", "", "",
    ]);
    // 1-based coordinates for every non-empty cell.
    assert.ok(nonEmpty.some((c) => c.row === 2 && c.col === 5 && c.value === "2050.00"));
    assert.ok(nonEmpty.some((c) => c.row === 2 && c.col === 3 && c.value === "100"));
  });

  it("the salary entry_key column maps to SALARY, not the old P&L position", () => {
    const { values } = buildZohoMonthlyGrid([
      {
        expense_date: "2026-09-30",
        title: "Staff pay September",
        category: "Salary",
        amount_cents: 700000,
        currency: "MVR",
        entry_key: "2026-09-30:salary",
      },
    ]);
    assert.equal(values[1][12], "7000.00");
    assert.equal(values[1][13], "");
  });

  it("hand-entered rows fall back by category, keeping the P&L line visible", () => {
    const { values } = buildZohoMonthlyGrid([
      {
        expense_date: "2026-09-15",
        title: "Oil filter Yamaha",
        category: "Repair & Maintenance",
        amount_cents: 1500,
        currency: "MVR",
      },
      {
        expense_date: "2026-09-16",
        title: "",
        category: "Fuel",
        amount_cents: 10000,
        currency: "USD",
      },
      {
        expense_date: "2026-09-17",
        title: "Generator service",
        category: "Other",
        amount_cents: 500,
        currency: "MVR",
      },
    ]);
    // Repair & Maintenance has no unambiguous column — Other Services, labelled.
    assert.equal(values[1][9], "15.00");
    assert.equal(values[1][1], "Oil filter Yamaha (Repair & Maintenance)");
    // Fuel falls into Petrol; the USD amount says so in the detail.
    assert.equal(values[2][4], "100.00");
    assert.equal(values[2][1], "Fuel (USD)");
    // Other lands in Other Services, category kept visible.
    assert.equal(values[3][9], "5.00");
    assert.equal(values[3][1], "Generator service (Other)");
  });

  it("months stack date-sorted, each followed by a column-totals row", () => {
    const { values } = buildZohoMonthlyGrid([
      {
        expense_date: "2026-10-02",
        title: "Oct fuel",
        category: "Fuel",
        amount_cents: 30000,
        currency: "MVR",
        entry_key: "2026-10-02:petrol",
      },
      {
        expense_date: "2026-09-30",
        title: "Staff pay",
        category: "Salary",
        amount_cents: 700000,
        currency: "MVR",
        entry_key: "2026-09-30:salary",
      },
      {
        expense_date: "2026-09-21",
        title: "petrol refill 100L",
        category: "Fuel",
        amount_cents: 205000,
        currency: "MVR",
        entry_key: "2026-09-21:petrol",
        notes: "100 L × 20.5 MVR/L",
      },
    ]);
    // header, Sept rows (sorted), totals, blank line, Oct row, totals.
    assert.equal(values.length, 7);
    assert.equal(values[1][0], "2026-09-21");
    assert.equal(values[2][0], "2026-09-30");
    assert.equal(values[3][1], "Total September 2026");
    assert.equal(values[3][4], "2050.00"); // petrol column
    assert.equal(values[3][2], "100.00"); // litres column
    assert.equal(values[3][3], ""); // a sum of rates is meaningless
    assert.equal(values[3][12], "7000.00"); // SALARY
    assert.ok(values[4].every((c) => c === "")); // blank line between months
    assert.equal(values[5][0], "2026-10-02");
    assert.equal(values[6][1], "Total October 2026");
    assert.equal(values[6][4], "300.00");
  });

  it("junk rows never reach the sheet", () => {
    const { values } = buildZohoMonthlyGrid([
      { expense_date: "not a date", title: "x", category: "Fuel", amount_cents: 100 },
      { expense_date: "2026-09-01", title: "zero", category: "Fuel", amount_cents: 0 },
      { expense_date: "2026-09-01", title: "ok", category: "Fuel", amount_cents: 100, currency: "MVR" },
    ]);
    assert.equal(values.length, 3); // header + one row + totals
  });

  it("the push writes sparsely, diffs against the tab and clears vanished cells", () => {
    assert.match(sheets, /method: "worksheet\.list"/);
    // Zoho's create method is worksheet.create + new_sheet_name — worksheet.add
    // answers 400 "Specified method is not supported" (error 2867).
    assert.match(sheets, /method: "worksheet\.create"/);
    assert.match(sheets, /new_sheet_name: name/);
    assert.doesNotMatch(sheets, /worksheet\.add/);
    // worksheet.list answers with worksheet_names, not worksheets.
    assert.match(sheets, /json\.worksheet_names/);
    assert.match(sheets, /export async function ensureWorksheet/);
    assert.match(sheets, /export async function setCells/);
    assert.match(financeSync, /export const PUSH_TAB = "App Expenses"/);
    assert.match(actions, /export async function pushExpensesToZoho/);
    assert.match(actions, /buildZohoMonthlyGrid\(/);
    assert.match(actions, /ensureWorksheet\(workbookId, PUSH_TAB\)/);
    assert.match(actions, /\.is\("archived_at", null\)/);
    assert.match(actions, /Only the owner or manager can push expenses/);
    // Changed-or-new cells are written; leftovers on the tab are cleared.
    assert.match(actions, /currentMap\.get/);
    assert.match(actions, /toWrite/);
    assert.match(actions, /toClear/);
    assert.match(actions, /await setCells\(workbookId, PUSH_TAB, toWrite\)/);
    assert.match(actions, /await setCells\(workbookId, PUSH_TAB, toClear\)/);
    // A Zoho failure returns { ok: false } — the page never crashes.
    assert.match(actions, /A Zoho failure is a toast, never a crashed page/);
  });

  it("staff get the push button next to the pull, behind a confirm", () => {
    assert.match(pageClient, /import PushToZohoButton/);
    assert.match(pageClient, /<PushToZohoButton \/>/);
    assert.match(pushButton, /pushExpensesToZoho\(\)/);
    assert.match(pushButton, /window\.confirm/);
    assert.match(pushButton, /r\.written/);
    assert.match(pushButton, /r\.cleared/);
  });
});
