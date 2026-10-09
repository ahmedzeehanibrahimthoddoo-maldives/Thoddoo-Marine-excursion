/**
 * Verification for Migration 070: Rental walk-in QR — full compulsory guest details.
 * Checks the wiring end-to-end:
 *   - Guest page (RentalAgreementClient): full details form → update_rental_consent_details
 *     → sign_consent_form (with health/photo fields) → sign_rental_agreement
 *   - Admin page (RentalPageClient): QR modal + consent-status column
 *   - QR modal (RentalQRModal): points at /rental/<signing_token>
 *   - Return flow (RentalReturnForm): consent banner
 *   - getRentals embeds consent_forms
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const migration = readFileSync(resolve(__dirname, "../supabase/migrations/070_rental_consent_guest_details.sql"), "utf-8");
const client = readFileSync(resolve(__dirname, "../app/rental/[token]/RentalAgreementClient.tsx"), "utf-8");
const page = readFileSync(resolve(__dirname, "../app/admin/rentals/RentalPageClient.tsx"), "utf-8");
const qrModal = readFileSync(resolve(__dirname, "../app/admin/rentals/RentalQRModal.tsx"), "utf-8");
const returnForm = readFileSync(resolve(__dirname, "../app/admin/rentals/RentalReturnForm.tsx"), "utf-8");
const actions = readFileSync(resolve(__dirname, "../lib/supabase/actions.ts"), "utf-8");

const checks: Array<[string, boolean]> = [
  ["Migration drops the superseded RPC", migration.includes("DROP FUNCTION IF EXISTS public.set_rental_consent_guest_info")],
  ["Migration defines update_rental_consent_details (anon)", migration.includes("CREATE OR REPLACE FUNCTION public.update_rental_consent_details(") && migration.includes("GRANT EXECUTE ON FUNCTION public.update_rental_consent_details(") && migration.includes("TO anon")],
  ["Guest page calls update_rental_consent_details with all fields", client.includes('"update_rental_consent_details"') && client.includes("p_guest_name: guestName.trim()") && client.includes("p_nationality: nationality.trim()") && client.includes("p_emergency_contact_phone: emergencyPhone.trim()")],
  ["Guest page requires all compulsory details before signing", client.includes("detailsReady =") && client.includes('nationality.trim() !== ""') && client.includes('emergencyPhone.trim() !== ""') && client.includes("swimmingAbility !== \"\"")],
  ["Minor status derived from DOB on the guest page", client.includes("ageFromDate(dateOfBirth)") && client.includes("minorRenter")],
  ["Guest page passes health + photo consent into sign_consent_form", client.includes("p_swimming_ability: swimmingAbility") && client.includes("p_photo_consent: photoConsent") && client.includes("p_is_pregnant: isPregnant")],
  ["Admin page renders a consent-status column + badge", page.includes("<th>Consent</th>") && page.includes('"badge-signed"') && page.includes('"badge-pending"')],
  ["Admin page has a QR action button", page.includes('title="Show consent QR code"') && page.includes("setQrRental(r)")],
  ["QR modal links to /rental/<signing_token>", qrModal.includes("`${siteUrl}/rental/${token}`")],
  ["QR modal gates handover on consent status", qrModal.includes("do not hand over equipment until signed")],
  ["Return form shows consent status banner", returnForm.includes("consentRow") && returnForm.includes("Guest consent &amp; liability form signed") && returnForm.includes("blocked until the guest signs")],
  ["getRentals embeds consent_forms status fields", actions.includes("consent_forms(status, guest_name, is_minor, signed_at)")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exit(1);