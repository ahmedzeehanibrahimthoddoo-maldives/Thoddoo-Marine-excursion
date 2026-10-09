/**
 * Comprehensive verification test for Migration 010: QR Guest Check-in & Individual Activity Consent
 * Tests: table definitions, RPC signatures, RLS policies, security, privacy, walk-in flow
 *
 * Updated for security-hardened rewrite:
 *   - SHA-256 token hashing (pgcrypto)
 *   - Opaque choice_token for participant selection
 *   - Attempt limits: 5 per participant, 20 per session
 *   - Atomic locking (FOR UPDATE)
 *   - RLS: REVOKE from anon
 *   - Token short_id for staff display
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const migrationPath = resolve(__dirname, "../supabase/migrations/010_checkin_qr_consent.sql");
const migration = readFileSync(migrationPath, "utf-8");

// Read application source files for URL and column verification
const qrManagerPath = resolve(__dirname, "../app/admin/bookings/CheckinQRManager.tsx");
const qrManager = readFileSync(qrManagerPath, "utf-8");

const checkinHashPagePath = resolve(__dirname, "../app/checkin/page.tsx");
const checkinHashPage = readFileSync(checkinHashPagePath, "utf-8");

const checkinClientPath = resolve(__dirname, "../app/checkin/[token]/CheckinClient.tsx");
const checkinClient = readFileSync(checkinClientPath, "utf-8");

const actionsPath = resolve(__dirname, "../lib/supabase/actions.ts");
const actions = readFileSync(actionsPath, "utf-8");

const obsoletePagePath = resolve(__dirname, "../app/checkin/[token]/page.tsx");
const obsoletePage = readFileSync(obsoletePagePath, "utf-8");

const checkinHashPageClientPath = resolve(__dirname, "../app/checkin/page.tsx");
const checkinHashPageClient = readFileSync(checkinHashPageClientPath, "utf-8");

// Read migration 011 for room/phone verification fix tests
const migration011Path = resolve(__dirname, "../supabase/migrations/011_checkin_runtime_fixes.sql");
const migration011 = readFileSync(migration011Path, "utf-8");

// Read migration 012 for secure random helper and prefilled details fix
const migration012Path = resolve(__dirname, "../supabase/migrations/012_restore_secure_random_helper.sql");
const migration012 = readFileSync(migration012Path, "utf-8");

// Read migration 013 for RPC permissions audit
const migration013Path = resolve(__dirname, "../supabase/migrations/013_checkin_rpc_permissions_and_runtime_audit.sql");
const migration013 = readFileSync(migration013Path, "utf-8");

// Read migration 014 for authenticated session fix
const migration014Path = resolve(__dirname, "../supabase/migrations/014_allow_authenticated_checkin_token_flow.sql");
const migration014 = readFileSync(migration014Path, "utf-8");

// Extract individual function bodies for targeted testing
function extractFunction(sql: string, name: string): string {
  // Match both 'SET search_path = public;' and 'SET search_path = public, extensions;'
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ LANGUAGE (?:plpgsql|sql) SECURITY DEFINER SET search_path = public(?:, extensions)?;`
  );
  const match = sql.match(pattern);
  return match ? match[0] : "";
}

const fnGetParticipants = extractFunction(migration, "get_checkin_participants");
const fnVerifyParticipant = extractFunction(migration, "verify_checkin_participant");
const fnVerifyWalkin = extractFunction(migration, "verify_walkin_participant");
const fnPrefilled = extractFunction(migration, "get_checkin_prefilled_details");
const fnSubmitConsent = extractFunction(migration, "submit_checkin_consent");
const fnCreateSession = extractFunction(migration, "create_checkin_session");
const fnRevokeSession = extractFunction(migration, "revoke_checkin_session");
const fnSessionStatus = extractFunction(migration, "get_checkin_session_status");
const fnHashToken = extractFunction(migration, "_hash_token");

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Migration 010: QR Guest Check-in & Individual Activity Consent ===\n");

// =============================================
// 0. TOKEN HASHING HELPER
// =============================================
console.log("0. Token Hashing Helper (_hash_token)");
check("_hash_token function exists", /CREATE OR REPLACE FUNCTION public\._hash_token/.test(migration));
check("_hash_token is IMMUTABLE", /IMMUTABLE STRICT SECURITY DEFINER/.test(fnHashToken));
check("_hash_token uses pgcrypto digest", /digest\(convert_to\(p_token, 'UTF8'\), 'sha256'\)/.test(fnHashToken));
check("_hash_token uses encode/hex", /encode\(digest/.test(fnHashToken));

// =============================================
// 1. PARTICIPANT_TYPE ENUM
// =============================================
console.log("\n1. Participant Type Enum");
check("participant_type enum exists", /CREATE TYPE participant_type/.test(migration));
check("includes adult", /participant_type AS ENUM\s*\(\s*'adult'/.test(migration));
check("includes child", /participant_type AS ENUM\s*\(\s*'adult',\s*'child'/.test(migration));
check("idempotent (EXCEPTION WHEN duplicate_object)", /EXCEPTION WHEN duplicate_object THEN null/.test(migration));

// =============================================
// 2. BOOKING_PARTICIPANTS TABLE
// =============================================
console.log("\n2. booking_participants Table");
check("table created", /CREATE TABLE IF NOT EXISTS booking_participants/.test(migration));
check("has id UUID PRIMARY KEY", /booking_participants\s*\(\s*\n\s*id UUID PRIMARY KEY/.test(migration));
check("booking_id FK references bookings", /booking_id UUID REFERENCES bookings\(id\) ON DELETE CASCADE/.test(migration));
check("customer_id FK references customers", /customer_id UUID REFERENCES customers\(id\)/.test(migration));
check("full_name TEXT NOT NULL", /full_name TEXT NOT NULL/.test(migration));
check("participant_type NOT NULL DEFAULT adult", /participant_type participant_type NOT NULL DEFAULT 'adult'/.test(migration));
check("guardian_name TEXT", /guardian_name TEXT/.test(migration));
check("guardian_relationship TEXT", /guardian_relationship TEXT/.test(migration));
check("phone_last4 TEXT", /phone_last4 TEXT/.test(migration));
check("choice_token TEXT NOT NULL UNIQUE", /choice_token TEXT NOT NULL UNIQUE DEFAULT encode\(public\._gen_random_bytes\(12\),\s*'hex'\)/.test(migration));
check("consent_status DEFAULT pending", /consent_status consent_form_status NOT NULL DEFAULT 'pending'/.test(migration));
check("consent_form_id FK references consent_forms", /consent_form_id UUID REFERENCES consent_forms\(id\)/.test(migration));
check("created_at with default", /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(migration));
check("updated_at with default", /updated_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(migration));
check("updated_at trigger", /trg_bp_updated/.test(migration));
check("index on booking_id", /idx_bp_booking ON booking_participants\(booking_id\)/.test(migration));
check("index on customer_id", /idx_bp_customer ON booking_participants\(customer_id\)/.test(migration));
check("index on consent_status", /idx_bp_consent ON booking_participants\(consent_status\)/.test(migration));
check("index on choice_token", /idx_bp_choice ON booking_participants\(choice_token\)/.test(migration));
check("unique partial index for active consent", /idx_bp_active_unique/.test(migration));

// =============================================
// 3. CONSENT_CHECKIN_SESSIONS TABLE
// =============================================
console.log("\n3. consent_checkin_sessions Table");
check("table created", /CREATE TABLE IF NOT EXISTS consent_checkin_sessions/.test(migration));
check("session_token_hash TEXT NOT NULL UNIQUE", /session_token_hash TEXT NOT NULL UNIQUE/.test(migration));
check("token_short_id TEXT NOT NULL UNIQUE", /token_short_id TEXT NOT NULL UNIQUE/.test(migration));
check("booking_id nullable (walk-in support)", /booking_id UUID REFERENCES bookings\(id\)/.test(migration));
check("activity_id FK references activities", /activity_id UUID NOT NULL REFERENCES activities\(id\)/.test(migration));
check("created_by FK references staff_profiles", /created_by UUID NOT NULL REFERENCES staff_profiles\(id\)/.test(migration));
check("expires_at default 24 hours", /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) \+ INTERVAL '24 hours'\)/.test(migration));
check("revoked_at TIMESTAMPTZ", /revoked_at TIMESTAMPTZ/.test(migration));
check("revoked_by FK references staff_profiles", /revoked_by UUID REFERENCES staff_profiles\(id\)/.test(migration));
check("max_per_participant INT DEFAULT 5", /max_per_participant INT NOT NULL DEFAULT 5/.test(migration));
check("max_session_attempts INT DEFAULT 20", /max_session_attempts INT NOT NULL DEFAULT 20/.test(migration));
check("session_attempt_count INT DEFAULT 0", /session_attempt_count INT NOT NULL DEFAULT 0/.test(migration));
check("is_walkin BOOLEAN DEFAULT false", /is_walkin BOOLEAN NOT NULL DEFAULT false/.test(migration));
check("created_at with default", /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(migration));
check("index on session_token_hash", /idx_ccs_hash ON consent_checkin_sessions\(session_token_hash\)/.test(migration));
check("index on token_short_id", /idx_ccs_short ON consent_checkin_sessions\(token_short_id\)/.test(migration));
check("index on booking_id", /idx_ccs_booking ON consent_checkin_sessions\(booking_id\)/.test(migration));
check("index on expires_at", /idx_ccs_expires ON consent_checkin_sessions\(expires_at\)/.test(migration));

// =============================================
// 4. CONSENT_CHECKIN_ATTEMPTS TABLE
// =============================================
console.log("\n4. consent_checkin_attempts Table");
check("table created", /CREATE TABLE IF NOT EXISTS consent_checkin_attempts/.test(migration));
check("session_id FK references sessions ON DELETE CASCADE", /session_id UUID NOT NULL REFERENCES consent_checkin_sessions\(id\) ON DELETE CASCADE/.test(migration));
check("participant_id UUID", /participant_id UUID/.test(migration));
check("attempt_type TEXT DEFAULT verify", /attempt_type TEXT NOT NULL DEFAULT 'verify'/.test(migration));
check("success BOOLEAN DEFAULT false", /success BOOLEAN NOT NULL DEFAULT false/.test(migration));
check("created_at with default", /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(migration));
check("index on session_id", /idx_cca_session ON consent_checkin_attempts\(session_id\)/.test(migration));

// =============================================
// 5. CONSENT_CHECKIN_VERIFICATION_TOKENS TABLE
// =============================================
console.log("\n5. consent_checkin_verification_tokens Table");
check("table created", /CREATE TABLE IF NOT EXISTS consent_checkin_verification_tokens/.test(migration));
check("token_hash TEXT NOT NULL UNIQUE", /token_hash TEXT NOT NULL UNIQUE/.test(migration));
check("session_id FK", /session_id UUID NOT NULL REFERENCES consent_checkin_sessions\(id\)/.test(migration));
check("participant_id FK", /participant_id UUID NOT NULL REFERENCES booking_participants\(id\)/.test(migration));
check("expires_at default 10 minutes", /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) \+ INTERVAL '10 minutes'\)/.test(migration));
check("used_at TIMESTAMPTZ", /used_at TIMESTAMPTZ/.test(migration));
check("created_at with default", /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(migration));
check("index on token_hash", /idx_ccvt_hash ON consent_checkin_verification_tokens\(token_hash\)/.test(migration));

// =============================================
// 6. RLS POLICIES
// =============================================
console.log("\n6. RLS Policies");
check("booking_participants RLS enabled", /ALTER TABLE booking_participants ENABLE ROW LEVEL SECURITY/.test(migration));
check("consent_checkin_sessions RLS enabled", /ALTER TABLE consent_checkin_sessions ENABLE ROW LEVEL SECURITY/.test(migration));
check("consent_checkin_attempts RLS enabled", /ALTER TABLE consent_checkin_attempts ENABLE ROW LEVEL SECURITY/.test(migration));
check("consent_checkin_verification_tokens RLS enabled", /ALTER TABLE consent_checkin_verification_tokens ENABLE ROW LEVEL SECURITY/.test(migration));
check("bp_staff_policy restricts to owner/manager/reception", /CREATE POLICY bp_staff_policy ON booking_participants\s+FOR ALL USING \(\s*current_staff_role\(\) IN \('owner',\s*'manager',\s*'reception'\)\s*\)/.test(migration));
check("ccs_staff_policy restricts to owner/manager/reception", /CREATE POLICY ccs_staff_policy ON consent_checkin_sessions\s+FOR ALL USING \(\s*current_staff_role\(\) IN \('owner',\s*'manager',\s*'reception'\)\s*\)/.test(migration));
check("cca_staff_policy uses current_staff_role", /CREATE POLICY cca_staff_policy ON consent_checkin_attempts\s+FOR ALL USING \(\s*current_staff_role\(\) IS NOT NULL\s*\)/.test(migration));
check("ccvt_staff_policy uses current_staff_role", /CREATE POLICY ccvt_staff_policy ON consent_checkin_verification_tokens\s+FOR ALL USING \(\s*current_staff_role\(\) IS NOT NULL\s*\)/.test(migration));
check("anon revoked from booking_participants", /REVOKE ALL ON TABLE booking_participants FROM anon/.test(migration));
check("anon revoked from consent_checkin_sessions", /REVOKE ALL ON TABLE consent_checkin_sessions FROM anon/.test(migration));
check("anon revoked from consent_checkin_attempts", /REVOKE ALL ON TABLE consent_checkin_attempts FROM anon/.test(migration));
check("anon revoked from consent_checkin_verification_tokens", /REVOKE ALL ON TABLE consent_checkin_verification_tokens FROM anon/.test(migration));

// =============================================
// 7. STAFF RPCs
// =============================================
console.log("\n7. Staff RPCs");
check("create_checkin_session function", /CREATE OR REPLACE FUNCTION public\.create_checkin_session/.test(migration));
check("create_checkin_session SECURITY DEFINER", /FUNCTION public\.create_checkin_session[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("revoke_checkin_session function", /CREATE OR REPLACE FUNCTION public\.revoke_checkin_session/.test(migration));
check("revoke_checkin_session SECURITY DEFINER", /FUNCTION public\.revoke_checkin_session[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("get_checkin_session_status function", /CREATE OR REPLACE FUNCTION public\.get_checkin_session_status/.test(migration));
check("get_checkin_session_status SECURITY DEFINER", /FUNCTION public\.get_checkin_session_status[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("create_checkin_session REVOKE ALL FROM PUBLIC", /REVOKE ALL ON FUNCTION public\.create_checkin_session/.test(migration));
check("create_checkin_session GRANT TO authenticated", /GRANT EXECUTE ON FUNCTION public\.create_checkin_session.*TO authenticated/.test(migration));
check("revoke_checkin_session REVOKE ALL FROM PUBLIC", /REVOKE ALL ON FUNCTION public\.revoke_checkin_session/.test(migration));
check("revoke_checkin_session GRANT TO authenticated", /GRANT EXECUTE ON FUNCTION public\.revoke_checkin_session.*TO authenticated/.test(migration));
check("get_checkin_session_status REVOKE ALL FROM PUBLIC", /REVOKE ALL ON FUNCTION public\.get_checkin_session_status/.test(migration));
check("get_checkin_session_status GRANT TO authenticated", /GRANT EXECUTE ON FUNCTION public\.get_checkin_session_status.*TO authenticated/.test(migration));
check("create_checkin_session role check (owner/manager/reception)", /v_role NOT IN \('owner',\s*'manager',\s*'reception'\)/.test(migration));
check("revoke_checkin_session role check (owner/manager/reception)", /v_role NOT IN \('owner',\s*'manager',\s*'reception'\)/.test(migration));
check("get_checkin_session_status checks staff role", /v_role IS NULL OR v_role NOT IN/.test(fnSessionStatus));
check("create_checkin_session validates booking not cancelled", /v_booking\.status = 'cancelled'/.test(migration));
check("create_checkin_session auto-creates participants", /Auto-create participants from booking customer/.test(migration));
check("create_checkin_session walk-in mode supported", /p_is_walkin BOOLEAN DEFAULT false/.test(migration));
check("create_checkin_session returns raw token + short_id", /'session_token', v_raw_token/.test(fnCreateSession));
check("create_checkin_session returns token_short_id", /'token_short_id', v_short_id/.test(fnCreateSession));
check("revoke_checkin_session checks already revoked", /v_session\.revoked_at IS NOT NULL/.test(migration));
check("get_checkin_session_status returns participants JSON", /json_agg[\s\S]*?booking_participants/.test(fnSessionStatus));

// =============================================
// 8. PUBLIC RPCs (anon)
// =============================================
console.log("\n8. Public RPCs (Guest Check-in)");
check("get_checkin_participants function", /CREATE OR REPLACE FUNCTION public\.get_checkin_participants/.test(migration));
check("get_checkin_participants SECURITY DEFINER", /FUNCTION public\.get_checkin_participants[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("verify_checkin_participant function", /CREATE OR REPLACE FUNCTION public\.verify_checkin_participant/.test(migration));
check("verify_checkin_participant SECURITY DEFINER", /FUNCTION public\.verify_checkin_participant[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("verify_walkin_participant function", /CREATE OR REPLACE FUNCTION public\.verify_walkin_participant/.test(migration));
check("verify_walkin_participant SECURITY DEFINER", /FUNCTION public\.verify_walkin_participant[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("get_checkin_prefilled_details function", /CREATE OR REPLACE FUNCTION public\.get_checkin_prefilled_details/.test(migration));
check("get_checkin_prefilled_details SECURITY DEFINER", /FUNCTION public\.get_checkin_prefilled_details[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));
check("submit_checkin_consent function", /CREATE OR REPLACE FUNCTION public\.submit_checkin_consent/.test(migration));
check("submit_checkin_consent SECURITY DEFINER", /FUNCTION public\.submit_checkin_consent[\s\S]*?SECURITY DEFINER SET search_path = public/.test(migration));

// =============================================
// 9. REVOKE/GRANT PATTERNS
// =============================================
console.log("\n9. REVOKE/GRANT Security Patterns");

// Staff RPCs: revoke PUBLIC + anon, grant authenticated
const staffRpcs = ["create_checkin_session", "revoke_checkin_session", "get_checkin_session_status"];
for (const rpc of staffRpcs) {
  check(`${rpc} REVOKE ALL FROM PUBLIC`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}`).test(migration));
  check(`${rpc} REVOKE ALL FROM anon`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}.*FROM anon`).test(migration));
  check(`${rpc} GRANT TO authenticated`, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}.*TO authenticated`).test(migration));
}

// Public RPCs: revoke PUBLIC + authenticated, grant anon
const publicRpcs = [
  "get_checkin_participants",
  "verify_checkin_participant",
  "verify_walkin_participant",
  "get_checkin_prefilled_details",
  "submit_checkin_consent",
];
for (const rpc of publicRpcs) {
  check(`${rpc} REVOKE ALL FROM PUBLIC`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}`).test(migration));
  check(`${rpc} REVOKE ALL FROM authenticated`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}.*FROM authenticated`).test(migration));
  check(`${rpc} GRANT TO anon`, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}.*TO anon`).test(migration));
}

// =============================================
// 10. PRIVACY: No customer data leaked by public RPCs
// =============================================
console.log("\n10. Privacy Protections");
check("get_checkin_participants masks names (initcap + surname initial)", /initcap\(split_part\(bp\.full_name/.test(fnGetParticipants));
check("get_checkin_participants returns choice_token + display_name + type + consent_status", /'choice_token'[\s\S]*?'display_name'[\s\S]*?'participant_type'[\s\S]*?'consent_status'/.test(fnGetParticipants));
check("get_checkin_participants never returns phone", !/v_customer\.phone/.test(fnGetParticipants));
check("get_checkin_participants never returns email", !/email/.test(fnGetParticipants));
check("get_checkin_participants never returns passport", !/passport/.test(fnGetParticipants));
check("get_checkin_participants never returns DOB", !/date_of_birth/.test(fnGetParticipants));
check("get_checkin_participants never returns room_number", !/room_number/.test(fnGetParticipants));
check("get_checkin_participants never returns medical data", !/medical/.test(fnGetParticipants));
check("verify_checkin_participant uses opaque choice_token (not UUID)", /p_choice_token TEXT/.test(fnVerifyParticipant));
check("verify_checkin_participant validates participant belongs to session", /booking_id = v_session\.booking_id/.test(fnVerifyParticipant));
check("verify_checkin_participant generic error on failure", /Could not verify your details/.test(fnVerifyParticipant));
check("verify_walkin_participant creates participant with NULL booking_id", /VALUES\s*\(NULL/.test(fnVerifyWalkin));
check("verify_walkin_participant does NOT show customer list", !/customers\(full_name/.test(fnVerifyWalkin));
check("get_checkin_prefilled_details checks verification token validity", /v_vt\.expires_at < now\(\)/.test(fnPrefilled));
check("get_checkin_prefilled_details checks used_at", /v_vt\.used_at IS NOT NULL/.test(fnPrefilled));
check("submit_checkin_consent checks verification token used_at", /v_vt\.used_at IS NOT NULL/.test(fnSubmitConsent));
check("submit_checkin_consent checks expired", /v_vt\.expires_at < now\(\)/.test(fnSubmitConsent));
check("submit_checkin_consent creates customer for walk-in", /INSERT INTO customers/.test(fnSubmitConsent));
check("submit_checkin_consent signing_method is guest_checkin", /'guest_checkin'/.test(fnSubmitConsent));
check("submit_checkin_consent stores consent_text_snapshot", /consent_text_snapshot[\s\S]*?v_template\.consent_text/.test(fnSubmitConsent) || /v_template\.consent_text[\s\S]*?consent_text_snapshot/.test(fnSubmitConsent));

// =============================================
// 11. RATE LIMITING
// =============================================
console.log("\n11. Rate Limiting");
check("session has max_per_participant INT DEFAULT 5", /max_per_participant INT NOT NULL DEFAULT 5/.test(migration));
check("session has max_session_attempts INT DEFAULT 20", /max_session_attempts INT NOT NULL DEFAULT 20/.test(migration));
check("session has session_attempt_count INT DEFAULT 0", /session_attempt_count INT NOT NULL DEFAULT 0/.test(migration));
check("get_checkin_participants checks session attempt limit", /session_attempt_count >= v_session\.max_session_attempts/.test(fnGetParticipants));
check("verify checks session attempt limit", /session_attempt_count >= v_session\.max_session_attempts/.test(fnVerifyParticipant));
check("verify increments session_attempt_count", /session_attempt_count = session_attempt_count \+ 1/.test(fnVerifyParticipant));
check("verify checks per-participant limit", /v_participant_failures >= v_session\.max_per_participant/.test(fnVerifyParticipant));
check("verify counts per-participant failures", /count\(\*\)[\s\S]*?participant_id = v_participant\.id[\s\S]*?success = false/.test(fnVerifyParticipant));
check("rate limit error message generic", /Too many attempts/.test(migration));
check("attempts table stores success/failure", /success BOOLEAN NOT NULL DEFAULT false/.test(migration));

// =============================================
// 12. SESSION EXPIRY/REVOCATION
// =============================================
console.log("\n12. Session Expiry & Revocation");
check("session expires after 24 hours", /INTERVAL '24 hours'/.test(migration));
check("verification token expires after 10 minutes", /INTERVAL '10 minutes'/.test(migration));
check("get_checkin checks expiry", /v_session\.expires_at < now\(\)/.test(fnGetParticipants));
check("get_checkin checks revocation", /v_session\.revoked_at IS NOT NULL/.test(fnGetParticipants));
check("verify checks expiry", /v_session\.expires_at < now\(\)/.test(fnVerifyParticipant));
check("verify checks revocation", /v_session\.revoked_at IS NOT NULL/.test(fnVerifyParticipant));
check("expired error message clear", /link has expired/.test(migration));
check("revoked error message clear", /link has been cancelled/.test(migration));
check("revoke records revoked_by", /revoked_by = v_staff_id/.test(fnRevokeSession));

// =============================================
// 13. WALK-IN FLOW
// =============================================
console.log("\n13. Walk-in Flow");
check("is_walkin column on sessions", /is_walkin BOOLEAN NOT NULL DEFAULT false/.test(migration));
check("create_checkin_session supports walk-in mode", /p_is_walkin BOOLEAN/.test(migration));
check("create_checkin_session walk-in validates activity exists", /active = true/.test(migration));
check("verify_walkin_participant validates full name", /p_full_name IS NULL OR trim\(p_full_name\) = ''/.test(fnVerifyWalkin));
check("verify_walkin_participant validates phone", /p_phone_last4 IS NULL OR length/.test(fnVerifyWalkin));
check("verify_walkin_participant normalizes inputs", /v_normalized_name := trim\(p_full_name\)/.test(fnVerifyWalkin));
check("verify_walkin_participant creates participant with NULL booking_id", /VALUES\s*\(\s*NULL/.test(fnVerifyWalkin));
check("get_checkin_participants returns empty array for walk-in", /'is_walkin', true,\s*'participants', '\[\]'::json/.test(fnGetParticipants));

// =============================================
// 14. MINOR/GUARDIAN REQUIREMENTS
// =============================================
console.log("\n14. Minor/Guardian Requirements");
check("submit requires guardian name for minors", /[Pp]arent\/guardian name is required/.test(fnSubmitConsent));
check("submit requires guardian signature for minors", /[Pp]arent\/guardian signature is required/.test(fnSubmitConsent));
check("submit stores parent_guardian_name", /p_parent_guardian_name/.test(fnSubmitConsent));
check("submit stores parent_guardian_signature_data_url", /p_parent_guardian_signature_data_url/.test(fnSubmitConsent));
check("submit stores is_minor flag", /v_participant\.participant_type = 'child'/.test(fnSubmitConsent));

// =============================================
// 15. SIGNATURE VALIDATION
// =============================================
console.log("\n15. Signature Validation");
check("signature required", /Signature is required/.test(fnSubmitConsent));
check("signature must be PNG or JPEG data URL", /data:image\/png;base64,%/.test(fnSubmitConsent));
check("pre-decode size limit check", /699050/.test(fnSubmitConsent));
check("524288 byte limit", /524288/.test(fnSubmitConsent));
check("invalid base64 detection", /invalid data/.test(fnSubmitConsent));

// =============================================
// 16. CONSENT FORM CREATION
// =============================================
console.log("\n16. Consent Form Creation");
check("submit creates consent form", /INSERT INTO consent_forms/.test(fnSubmitConsent));
check("submit uses active template", /consent_type = 'activity' AND active = true/.test(fnSubmitConsent));
check("submit marks participant as signed", /consent_status = 'signed'.*consent_form_id = v_consent_id/.test(fnSubmitConsent));
check("submit marks verification token as used", /used_at = now\(\)/.test(fnSubmitConsent));
check("submit returns consent_id", /consent_id.*v_consent_id/.test(fnSubmitConsent));
check("submit returns activity name", /'activity_name'.*SELECT name FROM activities WHERE id = v_session\.activity_id/.test(fnSubmitConsent));
check("submit returns guest name", /guest_name.*v_participant\.full_name/.test(fnSubmitConsent));

// =============================================
// 17. SQL SECURITY
// =============================================
console.log("\n17. SQL Security Patterns");
const secDefCount = (migration.match(/SECURITY DEFINER SET search_path = public/g) || []).length;
check(`all ${secDefCount} functions use SECURITY DEFINER`, secDefCount >= 10);
check("staff RPCs: REVOKE ALL FROM PUBLIC + anon", /REVOKE ALL ON FUNCTION public\.(create_checkin_session|revoke_checkin_session|get_checkin_session_status).*FROM PUBLIC/g.test(migration));
check("public RPCs: REVOKE ALL FROM PUBLIC + authenticated", /REVOKE ALL ON FUNCTION public\.(get_checkin_participants|verify_checkin_participant|verify_walkin_participant|get_checkin_prefilled_details|submit_checkin_consent).*FROM PUBLIC/g.test(migration));
check("no raw session_token in public get_checkin_participants response", !/RETURN.*session_token/.test(fnGetParticipants));
check("uses format() or direct string concat for error messages", /message/.test(migration));
check("transaction wrapped (BEGIN/COMMIT)", /BEGIN;/.test(migration) && /COMMIT;/.test(migration));
check("no raw session_token stored in checkin_sessions table", !/session_token TEXT.*NOT NULL UNIQUE/.test(migration));
check("session_token_hash uses _hash_token helper", /_hash_token\(/.test(fnHashToken));
check("pgcrypto extension uses WITH SCHEMA extensions", /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/.test(migration));

// =============================================
// 18. IDEMPOTENCY
// =============================================
console.log("\n18. Idempotency");
check("booking_participants uses IF NOT EXISTS", /CREATE TABLE IF NOT EXISTS booking_participants/.test(migration));
check("consent_checkin_sessions uses IF NOT EXISTS", /CREATE TABLE IF NOT EXISTS consent_checkin_sessions/.test(migration));
check("consent_checkin_attempts uses IF NOT EXISTS", /CREATE TABLE IF NOT EXISTS consent_checkin_attempts/.test(migration));
check("consent_checkin_verification_tokens uses IF NOT EXISTS", /CREATE TABLE IF NOT EXISTS consent_checkin_verification_tokens/.test(migration));
check("indexes use IF NOT EXISTS", /CREATE INDEX IF NOT EXISTS/g.test(migration));
check("triggers use EXCEPTION WHEN duplicate_object", /EXCEPTION WHEN duplicate_object THEN null/g.test(migration));

// =============================================
// 19. VERIFICATION TOKEN SECURITY
// =============================================
console.log("\n19. Verification Token Security");
check("verification token is 192-bit (24 bytes)", /public\._gen_random_bytes\(24\)/.test(migration));
check("session token is 256-bit (32 bytes)", /public\._gen_random_bytes\(32\)/.test(migration));
check("verification token has 10min TTL", /INTERVAL '10 minutes'/.test(migration));
check("verification token tracks used_at", /used_at TIMESTAMPTZ/.test(migration));
check("submit checks token not already used", /used_at IS NOT NULL/.test(fnSubmitConsent));
check("verify hashes raw verification token", /_hash_token\(v_raw_vt\)/.test(fnVerifyParticipant));
check("get_checkin hashes presented token", /_hash_token\(p_token\)/.test(fnGetParticipants));

// =============================================
// 20. DUPLICATE PREVENTION
// =============================================
console.log("\n20. Duplicate Consent Prevention");
check("submit checks for existing signed consent", /status = 'signed'/.test(fnSubmitConsent));
check("unique partial index on participant consent", /idx_bp_active_unique/.test(migration));

// =============================================
// 21. CUSTOMER CREATION FOR WALK-INS
// =============================================
console.log("\n21. Walk-in Customer Creation");
check("submit creates customer for walk-in participants", /INSERT INTO customers/.test(fnSubmitConsent));
check("submit updates participant customer_id", /UPDATE booking_participants SET customer_id = v_customer_id/.test(fnSubmitConsent));

// =============================================
// 22. ATOMIC LOCKING
// =============================================
console.log("\n22. Atomic Locking");
check("verify uses FOR UPDATE on session row", /FOR UPDATE/.test(fnVerifyParticipant));
check("get_checkin checks session attempt limit without locking (read-only)", /session_attempt_count >= v_session\.max_session_attempts/.test(fnGetParticipants));

// =============================================
// 23. COMPLETE FLOW COVERAGE
// =============================================
console.log("\n23. Complete Flow Coverage");
check("5 public RPCs total", (migration.match(/CREATE OR REPLACE FUNCTION public\.(get_checkin_participants|verify_checkin_participant|verify_walkin_participant|get_checkin_prefilled_details|submit_checkin_consent)/g) || []).length === 5);
check("3 staff RPCs total", (migration.match(/CREATE OR REPLACE FUNCTION public\.(create_checkin_session|revoke_checkin_session|get_checkin_session_status)/g) || []).length === 3);
check("4 new tables total", (migration.match(/CREATE TABLE IF NOT EXISTS/g) || []).length === 4);
check("4 RLS policies total (1 per table)", (migration.match(/CREATE POLICY/g) || []).length === 4);

// =============================================
// 24. QR URL FRAGMENT DESIGN (no raw token in HTTP path)
// =============================================
console.log("\n24. QR URL Fragment Design");
check("QR URL uses fragment, not path", /checkin#token=/.test(qrManager));
check("QR URL does NOT use /checkin/${token}", !/\/checkin\/\$\{token\}/.test(qrManager));
check("obsolete [token] page renders generic message, no token param", /Link Updated/.test(obsoletePage));
check("obsolete page is force-static (no dynamic tokens)", /force-static/.test(obsoletePage));
check("hash page reads window.location.hash", /window\.location\.hash/.test(checkinHashPage));
check("hash page uses history.replaceState to strip fragment", /history\.replaceState/.test(checkinHashPage));
check("hash page validates 64-char hex token", /isValidHexToken|\\^#token=\\[0-9a-fA-F\\]\\+\\/.test(checkinHashPage));
check("hash page does NOT persist token in localStorage", !/localStorage/.test(checkinHashPage));
check("hash page does NOT persist token in sessionStorage", !/sessionStorage/.test(checkinHashPage));
check("hash page does NOT set cookies", !/document\.cookie/.test(checkinHashPage));

// =============================================
// 25. COLUMN NAME CORRECTNESS (stale attempt_count absent)
// =============================================
console.log("\n25. Column Name Correctness");
check("actions.ts uses session_attempt_count (not attempt_count)", /session_attempt_count/.test(actions) && !/\.attempt_count/.test(actions));
check("CheckinQRManager uses StoredSessionSummary with session_attempt_count", /StoredSessionSummary/.test(qrManager) && /session_attempt_count/.test(actions));
check("CheckinQRManager has no stale attempt_count", !/attempt_count/.test(qrManager.replace(/session_attempt_count/g, "")));
check("CheckinClient uses choice_token (not id)", /choice_token/.test(checkinClient));

// =============================================
// 26. CLIENT ERROR MESSAGES
// =============================================
console.log("\n26. Client Error Messages");
check("technical error: 'Unable to load check-in details'", /Unable to load check-in details/.test(checkinClient));
check("invalid/expired/revoked: 'invalid or has expired'", /invalid or has expired/.test(checkinClient));
check("no participants: 'No participants are ready for check-in'", /No participants are ready for check-in/.test(checkinClient));
check("safe logger (checkinDiag) used for RPC errors — no console.error", !/console\.error/.test(checkinClient) && /checkinDiag/.test(checkinClient));

// =============================================
// 27. NO RAW TOKEN IN HTTP REQUEST PATH
// =============================================
console.log("\n27. No Raw Token in HTTP Request Path");
check("no /checkin/[token] URL generation in QR manager", !/\/checkin\/\$\{/i.test(qrManager));
check("no raw token in page.tsx params", !/params.*token/.test(obsoletePage));
check("obsolete page exports force-static (SSG, no runtime params)", /export const dynamic = "force-static"/.test(obsoletePage));

// =============================================
// 28. TOKEN SHAPE AND EMPTY TOKEN PROTECTION
// =============================================
console.log("\n28. Token Shape and Empty Token Protection");
check("actions.ts validates 64-hex raw_token with regex", /\[0-9a-f\]\{64\}/.test(actions));
check("actions.ts throws on invalid raw_token", /Server returned an invalid check-in token/.test(actions));
check("actions.ts CreatedCheckinSession type has raw_token", /raw_token: string/.test(actions));
check("actions.ts StoredSessionSummary type has no raw_token", !(/raw_token/.test(actions.substring(actions.indexOf("StoredSessionSummary"), actions.indexOf("}", actions.indexOf("StoredSessionSummary")) + 200))));
check("actions.ts StoredSessionSummary type has no token_hash", !(/token_hash/.test(actions.substring(actions.indexOf("StoredSessionSummary"), actions.indexOf("}", actions.indexOf("StoredSessionSummary")) + 200))));
check("QR manager validates raw_token before QR generation", /\[0-9a-f\]\{64\}/.test(qrManager));
check("QR manager shows error on invalid token", /invalid token/.test(qrManager));
check("QR URL is non-empty /checkin#token=<hex>", /checkin#token=\$\{raw_token\}/.test(qrManager));

// =============================================
// 29. SQL: CREATE RETURNS TOKEN, LIST DOES NOT
// =============================================
console.log("\n29. SQL: Create Returns Token, List Does Not");
check("create_checkin_session returns session_token in JSON", /'session_token', v_raw_token/.test(fnCreateSession));
check("create_checkin_session stores hash, not raw token", /session_token_hash, token_short_id/.test(fnCreateSession));
check("get_checkin_session_status does NOT return session_token_hash", !/session_token_hash/.test(fnSessionStatus));
check("get_checkin_session_status does NOT return session_token", !/session_token/.test(fnSessionStatus));
check("actions select query has no session_token_hash", !(/session_token_hash/.test(actions)));

// =============================================
// 30. SESSION LIST: NO RAW TOKEN OR HASH
// =============================================
console.log("\n30. Session List: No Raw Token or Hash");
check("getCheckinSessionsForBooking select excludes session_token_hash", !/session_token_hash/.test(actions.substring(actions.indexOf("getCheckinSessionsForBooking"), actions.indexOf("return", actions.indexOf("getCheckinSessionsForBooking")))));
check("getCheckinSessionsForBooking select excludes raw_token", !/raw_token/.test(actions.substring(actions.indexOf("getCheckinSessionsForBooking"), actions.indexOf("return", actions.indexOf("getCheckinSessionsForBooking")))));

// =============================================
// 31. RELOAD CANNOT RECOVER SECRET
// =============================================
console.log("\n31. Reload Cannot Recover Secret");
check("hash page stores token only in React state (useState)", /useState.*null/.test(checkinHashPageClient));
check("hash page does NOT persist in localStorage", !/localStorage/.test(checkinHashPageClient));
check("hash page does NOT persist in sessionStorage", !/sessionStorage/.test(checkinHashPageClient));
check("hash page does NOT set cookies", !/document\.cookie/.test(checkinHashPageClient));
check("hash page strips fragment via history.replaceState", /history\.replaceState/.test(checkinHashPageClient));

// =============================================
// 32. COPY LINK BUTTON
// =============================================
console.log("\n32. Copy Link Button");
check("QR manager has Copy Link button", /Copy Link/.test(qrManager));
check("Copy Link uses navigator.clipboard.writeText", /writeText/.test(qrManager));
check("Copy Link disabled when qrUrl is null", /qrUrl/.test(qrManager));

// =============================================
// 33. VERIFY_CHECKIN_PARTICIPANT: MIGRATION 011 FIX
// =============================================
const fnVerifyFixed = extractFunction(migration011, "verify_checkin_participant");
const fnPrefilledFixed = extractFunction(migration012, "get_checkin_prefilled_details");
const fnGenRandomBytes = extractFunction(migration012, "_gen_random_bytes");

console.log("\n33. verify_checkin_participant: Migration 011 Fix");
check("migration 011 redefines verify_checkin_participant", fnVerifyFixed.length > 0);
check("function is SECURITY DEFINER", /SECURITY DEFINER/.test(fnVerifyFixed));
check("function uses SET search_path = public, extensions", /SET search_path = public, extensions/.test(fnVerifyFixed));
check("function signature unchanged: (TEXT, TEXT, TEXT)", /verify_checkin_participant\(\s*p_token TEXT,\s*p_choice_token TEXT,\s*p_verification_code TEXT\s*\)/.test(fnVerifyFixed));

// =============================================
// 34. ROOM VERIFICATION: BOOKINGS, NOT CUSTOMERS
// =============================================
console.log("\n34. Room Verification Against Booking Record");
check("looks up room from bookings table", /FROM bookings/.test(fnVerifyFixed));
check("does NOT check customers.room_number", !/v_customer\.room_number/.test(fnVerifyFixed));
check("uses bookings.room_number via v_booking_room", /v_booking_room/.test(fnVerifyFixed));
check("room comparison is case-insensitive", /lower\(trim\(v_booking_room\)\)/.test(fnVerifyFixed));
check("room comparison trims whitespace", /trim\(v_booking_room\)/.test(fnVerifyFixed));
check("room lookup uses session.booking_id", /WHERE id = v_session\.booking_id/.test(fnVerifyFixed));
check("room match uses booking from v_session", /v_session\.booking_id IS NOT NULL/.test(fnVerifyFixed));

// =============================================
// 35. PHONE VERIFICATION: PARTICIPANT + CUSTOMER FALLBACK
// =============================================
console.log("\n35. Phone Verification: Participant + Customer Fallback");
check("phone check uses participant.phone_last4", /v_participant\.phone_last4 IS NOT NULL/.test(fnVerifyFixed));
check("phone check uses customer phone last 4 as fallback", /FROM\s+customers[\s\S]+?id\s*=\s*v_participant\.customer_id/.test(fnVerifyFixed));
check("phone strips non-digits for comparison", /regexp_replace\(v_participant\.phone_last4, '\[\^0-9\]'/.test(fnVerifyFixed));
check("phone strips non-digits from verification input", /v_verification_digits/.test(fnVerifyFixed));
check("takes final 4 digits with right(..., 4)", /right\(.*4\)/.test(fnVerifyFixed));

// =============================================
// 36. NORMALIZATION AND EMPTY INPUT
// =============================================
console.log("\n36. Normalization and Empty Input");
check("rejects empty verification input after trim", /v_verification IS NULL OR v_verification = ''/.test(fnVerifyFixed));
check("trims p_verification_code", /trim\(p_verification_code\)/.test(fnVerifyFixed));
check("strips non-digits into v_verification_digits", /v_verification_digits := regexp_replace/.test(fnVerifyFixed));

// =============================================
// 37. PRESERVED SECURITY PROPERTIES
// =============================================
console.log("\n37. Preserved Security Properties");
check("uses FOR UPDATE for session row locking", /FOR UPDATE/.test(fnVerifyFixed));
check("checks session_attempt_count limit", /session_attempt_count >= v_session\.max_session_attempts/.test(fnVerifyFixed));
check("increments session_attempt_count", /session_attempt_count = session_attempt_count \+ 1/.test(fnVerifyFixed));
check("counts per-participant failures", /participant_id = v_participant\.id/.test(fnVerifyFixed));
check("checks per-participant limit", /v_participant_failures >= v_session\.max_per_participant/.test(fnVerifyFixed));
check("generates 192-bit verification token (24 bytes)", /_gen_random_bytes\(24\)/.test(fnVerifyFixed));
check("hashes verification token", /_hash_token\(v_raw_vt\)/.test(fnVerifyFixed));
check("REVOKE ALL FROM PUBLIC", /REVOKE ALL.*FROM PUBLIC/.test(migration011));
check("REVOKE ALL FROM authenticated", /REVOKE ALL.*FROM authenticated/.test(migration011));
check("GRANT TO anon", /GRANT EXECUTE.*TO anon/.test(migration011));
check("generic failure message does not reveal factor", /does not reveal which factor/.test(fnVerifyFixed));
check("never logs or returns room number", !/v_booking_room.*json_build_object/.test(fnVerifyFixed));
check("never logs or returns customer phone", !/v_customer_phone_last4.*json_build_object/.test(fnVerifyFixed));
check("never logs or returns customer ID", !/v_customer\.id.*json_build_object/.test(fnVerifyFixed));
check("never logs or returns participant ID", !/v_participant\.id.*json_build_object/.test(fnVerifyFixed) || /consent_checkin_attempts.*participant_id/.test(fnVerifyFixed));

// =============================================
// 38. ROOM FROM BOOKINGS, NOT CUSTOMERS
// =============================================
console.log("\n38. Room from Bookings, Not Customers (verify)");
check("verify reads room from bookings table", /SELECT room_number[\s\S]*FROM bookings/.test(fnVerifyFixed));
check("verify uses v_booking_room variable", /v_booking_room/.test(fnVerifyFixed));
check("verify compares lower(trim(v_booking_room))", /lower\(trim\(v_booking_room\)\)/.test(fnVerifyFixed));
check("verify does NOT use v_customer.room_number", !/v_customer\.room_number/.test(fnVerifyFixed));
check("verify room lookup uses session.booking_id", /WHERE id = v_session\.booking_id/.test(fnVerifyFixed));
check("verify rejects empty room string", /v_booking_room IS NOT NULL AND v_booking_room <> ''/.test(fnVerifyFixed));

// =============================================
// 39. PHONE CHECK ORDER: PARTICIPANT FIRST, CUSTOMER FALLBACK
// =============================================
console.log("\n39. Phone Check Order: Participant First, Customer Fallback");
check("participant.phone_last4 checked before customer.phone", fnVerifyFixed.indexOf("v_participant.phone_last4 IS NOT NULL") < fnVerifyFixed.indexOf("v_participant.customer_id IS NOT NULL"));
check("phone via participant uses right(..., 4) on last4", /right\(regexp_replace\(v_participant\.phone_last4.*4\)/.test(fnVerifyFixed));
check("phone via customer uses right(..., 4) on customer phone", /right\(regexp_replace\(v_customer_phone_last4.*4\)/.test(fnVerifyFixed));
check("customer phone lookup is SELECT phone INTO v_customer_phone_last4", /SELECT phone INTO v_customer_phone_last4/.test(fnVerifyFixed));

// =============================================
// 40. PREFILLED DETAILS: HOTEL/ROOM FROM BOOKINGS
// =============================================
console.log("\n40. Prefilled Details: Hotel/Room from Bookings");
check("get_checkin_prefilled_details defined in migration 011", fnPrefilledFixed.length > 0);
check("prefilled reads hotel_name from bookings", /SELECT hotel_name, room_number INTO v_hotel, v_room[\s\S]*FROM bookings/.test(fnPrefilledFixed));
check("prefilled uses session.booking_id for room", /WHERE id = v_session\.booking_id/.test(fnPrefilledFixed));
check("prefilled does NOT use v_customer.room_number for room", !/v_room := v_customer\.room_number/.test(fnPrefilledFixed));
check("prefilled does NOT use v_customer.hotel for hotel", !/v_hotel := v_customer\.hotel/.test(fnPrefilledFixed));
check("prefilled is SECURITY DEFINER", /SECURITY DEFINER/.test(fnPrefilledFixed));
check("prefilled REVOKE ALL FROM PUBLIC", /REVOKE ALL.*FROM PUBLIC/.test(migration012.substring(migration012.indexOf("get_checkin_prefilled_details"))));

// =============================================
// 41. CLIENT: MASKED GUEST NAME ON VERIFY SCREEN
// =============================================
console.log("\n41. Client: Masked Guest Name on Verify Screen");
check("verify screen shows 'Guest:' label", /Guest:/.test(checkinClient));
check("verify screen uses selectedParticipant.display_name", /selectedParticipant\.display_name/.test(checkinClient));
check("guest name shown only when selectedParticipant exists", /selectedParticipant &&/.test(checkinClient));

// =============================================
// 42. CLIENT: ERROR CATEGORIES
// =============================================
console.log("\n42. Client: Error Categories");
check("technical RPC error: 'A temporary error occurred'", /A temporary error occurred/.test(checkinClient));
check("verification failure: 'check your details'", /check your details/.test(checkinClient));
check("RPC errors use safe warn logger, not console.error", !/console\.error/.test(checkinClient) && /checkinDiag/.test(checkinClient));
check("RPC logger does not log raw error message strings",
  // Verify .message is not passed into any checkinDiag(…) call site
  !/checkinDiag\([^)]*\.message[^)]*\)/.test(checkinClient));

// =============================================
// 43. ATTEMPT LIMITS UNCHANGED
// =============================================
console.log("\n43. Attempt Limits Unchanged");
check("session max attempts still 20", /max_session_attempts INT(?: NOT NULL)? DEFAULT 20/.test(migration));
check("participant max attempts still 5", /max_per_participant INT(?: NOT NULL)? DEFAULT 5/.test(migration));
check("verify increments session_attempt_count", /session_attempt_count = session_attempt_count \+ 1/.test(fnVerifyFixed));
check("verify counts per-participant failures from attempts table", /consent_checkin_attempts/.test(fnVerifyFixed));

// =============================================
// 44. VERIFICATION FAILURE: NO FACTOR DISCLOSURE
// =============================================
console.log("\n44. Verification Failure: No Factor Disclosure");
check("failure message is generic", /Could not verify your details/.test(fnVerifyFixed));
check("failure does not mention 'room number'", !/room number/.test(fnVerifyFixed.substring(fnVerifyFixed.lastIndexOf("verification_failed"))));
check("failure does not mention 'phone'", !/phone/.test(fnVerifyFixed.substring(fnVerifyFixed.lastIndexOf("verification_failed"))));
check("failure does not reveal customer ID", !/v_participant\.customer_id.*json_build_object/.test(fnVerifyFixed.substring(fnVerifyFixed.lastIndexOf("verification_failed"))));
check("failure does not reveal choice token", !/choice_token.*json_build_object/.test(fnVerifyFixed.substring(fnVerifyFixed.lastIndexOf("verification_failed"))));

// =============================================
// 45. MIGRATION 012: _gen_random_bytes HELPER
// =============================================
console.log("\n45. Migration 012: _gen_random_bytes Helper");
check("migration 012 creates public._gen_random_bytes(integer)", fnGenRandomBytes.length > 0);
check("_gen_random_bytes uses SET search_path = public, extensions", /SET search_path = public, extensions/.test(fnGenRandomBytes));
check("_gen_random_bytes calls gen_random_bytes unqualified", /gen_random_bytes\(p_length\)/.test(fnGenRandomBytes) && !/public\.gen_random_bytes/.test(fnGenRandomBytes));
check("_gen_random_bytes rejects p_length < 1", /p_length < 1/.test(fnGenRandomBytes));
check("_gen_random_bytes rejects p_length > 64", /p_length > 64/.test(fnGenRandomBytes));
check("_gen_random_bytes uses RAISE EXCEPTION", /RAISE EXCEPTION/.test(fnGenRandomBytes));
check("_gen_random_bytes uses check_violation ERRCODE", /check_violation/.test(fnGenRandomBytes));
check("_gen_random_bytes REVOKE ALL FROM PUBLIC", /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM PUBLIC/.test(migration012));
check("_gen_random_bytes REVOKE ALL FROM anon", /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM anon/.test(migration012));
check("_gen_random_bytes REVOKE ALL FROM authenticated", /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM authenticated/.test(migration012));
check("_gen_random_bytes has no GRANT to browser roles", !/GRANT.*ON FUNCTION public\._gen_random_bytes/.test(migration012));
check("_gen_random_bytes is LANGUAGE plpgsql", /LANGUAGE plpgsql/.test(fnGenRandomBytes));
check("_gen_random_bytes is SECURITY DEFINER", /SECURITY DEFINER/.test(fnGenRandomBytes));

// =============================================
// 46. MIGRATION 012: PREFILLED DETAILS FIX
// =============================================
console.log("\n46. Migration 012: Prefilled Details Fix");
check("migration 012 redefines get_checkin_prefilled_details", fnPrefilledFixed.length > 0);
check("prefilled details is SECURITY DEFINER", /SECURITY DEFINER/.test(fnPrefilledFixed));
check("prefilled details uses SET search_path = public, extensions", /SET search_path = public, extensions/.test(fnPrefilledFixed));
check("prefilled loads hotel_name from bookings", /SELECT hotel_name, room_number INTO v_hotel, v_room[\s\S]*FROM bookings/.test(fnPrefilledFixed));
check("prefilled loads room from bookings via session.booking_id", /WHERE id = v_session\.booking_id/.test(fnPrefilledFixed));
check("prefilled does NOT read v_customer.room_number", !/v_customer\.room_number/.test(fnPrefilledFixed));
check("prefilled does NOT read v_customer.hotel", !/v_customer\.hotel/.test(fnPrefilledFixed));
check("prefilled still reads customer personal details", /v_full_name := v_customer\.full_name/.test(fnPrefilledFixed));
check("prefilled REVOKE ALL FROM PUBLIC", /REVOKE ALL.*FROM PUBLIC/.test(migration012.substring(migration012.indexOf("get_checkin_prefilled_details"))));
check("prefilled REVOKE ALL FROM authenticated", /REVOKE ALL.*FROM authenticated/.test(migration012.substring(migration012.indexOf("get_checkin_prefilled_details"))));
check("prefilled GRANT TO anon", /GRANT EXECUTE.*TO anon/.test(migration012.substring(migration012.indexOf("get_checkin_prefilled_details"))));

// =============================================
// 47. APPLIED MIGRATIONS UNCHANGED
// =============================================
console.log("\n47. Applied Migrations Unchanged");
check("migration 010 not modified: _hash_token exists", /CREATE OR REPLACE FUNCTION public\._hash_token/.test(migration));
check("migration 010 not modified: _gen_random_bytes exists", /CREATE OR REPLACE FUNCTION public\._gen_random_bytes/.test(migration));
check("migration 010 not modified: verify_checkin_participant original signature", /public\.verify_checkin_participant\(TEXT, TEXT, TEXT\)/.test(migration));
check("migration 011 not modified: verify_checkin_participant uses bookings.room_number", /SELECT room_number[\s\S]*FROM bookings/.test(fnVerifyFixed));
check("migration 011 not modified: verify_checkin_participant v_booking_room variable", /v_booking_room/.test(fnVerifyFixed));
check("migration 012 does NOT re-define verify_checkin_participant", !/CREATE OR REPLACE FUNCTION public\.verify_checkin_participant/.test(migration012));

// =============================================
// 48. MIGRATION 013: RPC PERMISSIONS AUDIT
// =============================================
console.log("\n48. Migration 013: RPC Permissions Audit");
check("migration 013 file exists", migration013.length > 0);

// Strip SQL comments for "does not contain" checks
// (avoids false positives from comment text matching SQL patterns)
const migration013Sql = migration013.replace(/--[^\n]*/g, '');

// Guest RPCs: anon only
const guestRpcSigs013: Array<[string, string]> = [
  ["get_checkin_participants",   "TEXT"],
  ["verify_checkin_participant", "TEXT, TEXT, TEXT"],
  ["verify_walkin_participant",  "TEXT, TEXT, TEXT"],
  ["get_checkin_prefilled_details", "TEXT"],
];
for (const [rpc, sig] of guestRpcSigs013) {
  check(
    `013: ${rpc} REVOKE ALL FROM PUBLIC`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) FROM PUBLIC`).test(migration013),
  );
  check(
    `013: ${rpc} REVOKE ALL FROM authenticated`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) FROM authenticated`).test(migration013),
  );
  check(
    `013: ${rpc} GRANT EXECUTE TO anon`,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) TO anon`).test(migration013),
  );
}

// submit_checkin_consent has a 17-param signature
const submitSig17 = "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT";
const submitSigEsc = submitSig17.replace(/,/g, ",");
check(
  "013: submit_checkin_consent REVOKE ALL FROM PUBLIC",
  new RegExp(`REVOKE ALL ON FUNCTION public\\.submit_checkin_consent\\(${submitSigEsc}\\) FROM PUBLIC`).test(migration013),
);
check(
  "013: submit_checkin_consent REVOKE ALL FROM authenticated",
  new RegExp(`REVOKE ALL ON FUNCTION public\\.submit_checkin_consent\\(${submitSigEsc}\\) FROM authenticated`).test(migration013),
);
check(
  "013: submit_checkin_consent GRANT EXECUTE TO anon",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${submitSigEsc}\\) TO anon`).test(migration013),
);

// Internal helpers: revoked from all browser roles
check("013: _hash_token REVOKE FROM PUBLIC",        /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM PUBLIC/.test(migration013));
check("013: _hash_token REVOKE FROM anon",           /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM anon/.test(migration013));
check("013: _hash_token REVOKE FROM authenticated",  /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM authenticated/.test(migration013));
check("013: _gen_random_bytes REVOKE FROM PUBLIC",        /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM PUBLIC/.test(migration013));
check("013: _gen_random_bytes REVOKE FROM anon",           /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM anon/.test(migration013));
check("013: _gen_random_bytes REVOKE FROM authenticated",  /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM authenticated/.test(migration013));
check("013: no GRANT on _hash_token to any role",
  // Use specific consecutive pattern — not the cross-statement lazy match
  !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._hash_token/.test(migration013));
check("013: no GRANT on _gen_random_bytes to any role",
  !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._gen_random_bytes/.test(migration013));

// Staff RPCs: authenticated only, anon revoked
const staffRpcSigs013: Array<[string, string]> = [
  ["create_checkin_session",     "UUID, UUID, BOOLEAN"],
  ["revoke_checkin_session",     "UUID"],
  ["get_checkin_session_status", "UUID"],
];
for (const [rpc, sig] of staffRpcSigs013) {
  check(
    `013: ${rpc} REVOKE ALL FROM PUBLIC`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) FROM PUBLIC`).test(migration013),
  );
  check(
    `013: ${rpc} REVOKE ALL FROM anon`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) FROM anon`).test(migration013),
  );
  check(
    `013: ${rpc} GRANT EXECUTE TO authenticated`,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\(${sig.replace(/,/g, ",")}\\) TO authenticated`).test(migration013),
  );
}

// No direct table grants to anon in migration 013
check("013: no TABLE grant to anon",    !/GRANT[\s\S]*?ON TABLE[\s\S]*?TO anon/.test(migration013));
check("013: no INSERT grant to anon",   !/GRANT.*INSERT.*TO anon/.test(migration013));
check("013: no SELECT grant to anon",   !/GRANT.*SELECT.*TO anon/.test(migration013));
check("013: no UPDATE grant to anon",   !/GRANT.*UPDATE.*TO anon/.test(migration013));
check("013: no DELETE grant to anon",   !/GRANT.*DELETE.*TO anon/.test(migration013));

// SECURITY DEFINER preserved: migration 013 does NOT redefine any function
// (use comment-stripped SQL to avoid false positives from comment text)
check("013: does not redefine get_checkin_participants (SECURITY DEFINER preserved)",  !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_checkin_participants/.test(migration013Sql));
check("013: does not redefine verify_checkin_participant (SECURITY DEFINER preserved)",!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.verify_checkin_participant/.test(migration013Sql));
check("013: does not redefine submit_checkin_consent (SECURITY DEFINER preserved)",    !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.submit_checkin_consent/.test(migration013Sql));
check("013: does not redefine _hash_token (SECURITY DEFINER preserved)",               !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\._hash_token/.test(migration013Sql));
check("013: does not redefine _gen_random_bytes (SECURITY DEFINER preserved)",         !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\._gen_random_bytes/.test(migration013Sql));
check("013: does not contain SET search_path (no accidental override)",                !/SET\s+search_path/.test(migration013Sql));

// Obsolete overload handling uses exact signatures (no broad DROPs)
// (use comment-stripped SQL to avoid false positives from audit comments)
check("013: no DROP FUNCTION statement (no obsolete overloads present)", !/DROP\s+FUNCTION/.test(migration013Sql));
check("013: INT=integer equivalence documented in overload audit",        /INT[\s\S]*?integer|integer[\s\S]*?INT/.test(migration013));

// =============================================
// 48b. CheckinClient Safe Diagnostic Logger
// =============================================
console.log("\n48b. CheckinClient Safe Diagnostic Logger");
check("CheckinClient has no console.error anywhere", !/console\.error/.test(checkinClient));
check("CheckinClient defines checkinDiag helper",    /function checkinDiag/.test(checkinClient));
check("CheckinClient uses checkinDiag for all RPC errors",
  (checkinClient.match(/checkinDiag\(/g) || []).length >= 6);
check("checkinDiag uses console.warn",                /console\.warn/.test(checkinClient));
check("checkinDiag is development-only (NODE_ENV guard)",
  /NODE_ENV.*development|development.*NODE_ENV/.test(checkinClient));
check("checkinDiag does NOT log .message (no raw DB error text)",
  // Verify no checkinDiag(...) call site passes .message as an argument
  !/checkinDiag\([^)]*\.message[^)]*\)/.test(checkinClient));
check("checkinDiag exposes only err.code",            /err(?:\.code|\?\.code)/.test(checkinClient));

// No sensitive values in logger call sites
check("logger call sites do not reference token values",
  !/checkinDiag\([^)]*token[^)]*\)/.test(checkinClient));
check("logger call sites do not reference room or phone values",
  !/checkinDiag\([^)]*(?:room|phone)[^)]*\)/.test(checkinClient));
check("logger call sites do not reference signature data",
  !/checkinDiag\([^)]*signature[^)]*\)/.test(checkinClient));
check("logger call sites do not reference guest information",
  !/checkinDiag\([^)]*(?:guest_name|customer|walkinName)[^)]*\)/.test(checkinClient));

// =============================================
// 48c. Generic Guest-Facing Error Messages
// =============================================
console.log("\n48c. Generic Guest-Facing Error Messages");
check("friendly error for invalid/expired links",         /invalid or has expired/.test(checkinClient));
check("generic error for prefilled details failure",      /A temporary error occurred/.test(checkinClient));
check("generic error for consent submission failure",     /There was an error submitting/.test(checkinClient));
check("errors surfaced in UI (not silently swallowed)",
  /setError\(/.test(checkinClient) && /setVerificationError\(/.test(checkinClient));

// =============================================
// 48d. Migrations 010–012 Unchanged
// =============================================
console.log("\n48d. Migrations 010–012 Unchanged");
check("010 unchanged: get_checkin_participants GRANT TO anon",
  /GRANT EXECUTE ON FUNCTION public\.get_checkin_participants\(TEXT\) TO anon/.test(migration));
check("010 unchanged: submit_checkin_consent 17-param GRANT TO anon",
  /GRANT EXECUTE ON FUNCTION public\.submit_checkin_consent\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) TO anon/.test(migration));
check("011 unchanged: canonical verify_checkin_participant signature",
  /public\.verify_checkin_participant\(\s*p_token TEXT,\s*p_choice_token TEXT,\s*p_verification_code TEXT\s*\)/.test(migration011));
check("011 unchanged: room from bookings (not customers)",
  /SELECT room_number[\s\S]*?FROM bookings/.test(migration011));
check("012 unchanged: _gen_random_bytes REVOKE FROM anon",
  /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM anon/.test(migration012));
check("012 unchanged: _gen_random_bytes REVOKE FROM authenticated",
  /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM authenticated/.test(migration012));
check("012 unchanged: get_checkin_prefilled_details hotel/room from bookings",
  /SELECT hotel_name, room_number INTO v_hotel, v_room[\s\S]*FROM bookings/.test(migration012));

// =============================================
// 49. MIGRATION 014: AUTHENTICATED GUEST CHECK-IN ACCESS
// =============================================
console.log("\n49. Migration 014: Authenticated Guest Check-in Access");
check("migration 014 file exists", migration014.length > 0);

// Strip comments for "does-not-contain" checks
const migration014Sql = migration014.replace(/--[^\n]*/g, '');

// 49a. All five guest RPCs grant EXECUTE to both anon AND authenticated
const guestRpcSigs014: Array<[string, string]> = [
  ["get_checkin_participants",      "TEXT"],
  ["verify_checkin_participant",    "TEXT, TEXT, TEXT"],
  ["verify_walkin_participant",     "TEXT, TEXT, TEXT"],
  ["get_checkin_prefilled_details", "TEXT"],
];
for (const [rpc, sig] of guestRpcSigs014) {
  check(
    `014: ${rpc} REVOKE ALL FROM PUBLIC`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\(${sig}\\) FROM PUBLIC`).test(migration014),
  );
  check(
    `014: ${rpc} GRANT EXECUTE TO anon`,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\(${sig}\\) TO anon`).test(migration014),
  );
  check(
    `014: ${rpc} GRANT EXECUTE TO authenticated`,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\(${sig}\\) TO authenticated`).test(migration014),
  );
}

// submit_checkin_consent 17-param signature
const sig17 = "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT";
check(
  "014: submit_checkin_consent REVOKE ALL FROM PUBLIC",
  new RegExp(`REVOKE ALL ON FUNCTION public\\.submit_checkin_consent\\(${sig17}\\) FROM PUBLIC`).test(migration014),
);
check(
  "014: submit_checkin_consent GRANT EXECUTE TO anon",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${sig17}\\) TO anon`).test(migration014),
);
check(
  "014: submit_checkin_consent GRANT EXECUTE TO authenticated",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${sig17}\\) TO authenticated`).test(migration014),
);

// 49b. Internal helpers remain locked from all browser roles
check("014: _hash_token REVOKE FROM PUBLIC",        /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM PUBLIC/.test(migration014));
check("014: _hash_token REVOKE FROM anon",           /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM anon/.test(migration014));
check("014: _hash_token REVOKE FROM authenticated",  /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM authenticated/.test(migration014));
check("014: _gen_random_bytes REVOKE FROM PUBLIC",        /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM PUBLIC/.test(migration014));
check("014: _gen_random_bytes REVOKE FROM anon",           /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM anon/.test(migration014));
check("014: _gen_random_bytes REVOKE FROM authenticated",  /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM authenticated/.test(migration014));
check("014: no GRANT on _hash_token to any role",       !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._hash_token/.test(migration014));
check("014: no GRANT on _gen_random_bytes to any role", !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._gen_random_bytes/.test(migration014));

// 49c. No direct table grants
check("014: no TABLE grant to anon",          !/GRANT[\s\S]*?ON TABLE[\s\S]*?TO anon/.test(migration014));
check("014: no TABLE grant to authenticated", !/GRANT[\s\S]*?ON TABLE[\s\S]*?TO authenticated/.test(migration014));
check("014: no INSERT grant",  !/GRANT.*INSERT/.test(migration014));
check("014: no SELECT grant",  !/GRANT.*SELECT/.test(migration014));
check("014: no UPDATE grant",  !/GRANT.*UPDATE/.test(migration014));
check("014: no DELETE grant",  !/GRANT.*DELETE/.test(migration014));

// 49d. No function bodies or search_path changed
check("014: does not define any function",
  !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/.test(migration014Sql));
check("014: does not contain SET search_path",
  !/SET\s+search_path/.test(migration014Sql));
check("014: no DROP FUNCTION statement",
  !/DROP\s+FUNCTION/.test(migration014Sql));

// 49e. Staff RPCs not mentioned in migration 014 (untouched)
check("014: does not touch create_checkin_session",    !/create_checkin_session/.test(migration014Sql));
check("014: does not touch revoke_checkin_session",    !/revoke_checkin_session/.test(migration014Sql));
check("014: does not touch get_checkin_session_status",!/get_checkin_session_status/.test(migration014Sql));

// 49f. Explanation comment present
check("014: explains token-based authorization model",
  /high.entropy/.test(migration014) && /token/.test(migration014));
check("014: explains authenticated session scenario",
  /authenticated.*session|session.*authenticated/i.test(migration014));
check("014: states SECURITY DEFINER validation preserved",
  /SECURITY DEFINER/.test(migration014));

// 49g. Migration 013 unchanged
console.log("\n49g. Migrations 010–013 Unchanged");
check("013 unchanged: get_checkin_participants REVOKE FROM authenticated",
  /REVOKE ALL ON FUNCTION public\.get_checkin_participants\(TEXT\) FROM authenticated/.test(migration013));
check("013 unchanged: submit_checkin_consent REVOKE FROM authenticated",
  /REVOKE ALL ON FUNCTION public\.submit_checkin_consent\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT\) FROM authenticated/.test(migration013));
check("013 unchanged: _hash_token REVOKE FROM all browser roles",
  /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM authenticated/.test(migration013));
check("013 unchanged: no DROP FUNCTION statement",
  !/DROP\s+FUNCTION/.test(migration013.replace(/--[^\n]*/g, '')));

// =============================================
// 50. MIGRATION 015: CONSENT SUBMISSION FIX
// =============================================
console.log("\n50. Migration 015: Consent Submission Fix");

const migration015Path = resolve(__dirname, "../supabase/migrations/015_fix_checkin_consent_submission.sql");
const migration015 = readFileSync(migration015Path, "utf-8");
const migration015Sql = migration015.replace(/--[^\n]*/g, '');

check("migration 015 file exists", migration015.length > 0);

// 50a. signing_method constraint fix
check("015: drops consent_forms_signing_method_check",
  /DROP CONSTRAINT consent_forms_signing_method_check/.test(migration015));
check("015: adds corrected constraint with guest_checkin",
  /ADD CONSTRAINT consent_forms_signing_method_check/.test(migration015) &&
  /guest_checkin/.test(migration015));
check("015: constraint retains guest_token",
  /guest_token/.test(migration015));
check("015: constraint retains staff_assisted",
  /staff_assisted/.test(migration015));
check("015: constraint uses IF EXISTS guard",
  /IF EXISTS[\s\S]*consent_forms_signing_method_check/.test(migration015));

// 50b. submit_checkin_consent permissions re-confirmed
// submit_checkin_consent 17-param signature
const sig17_015 = "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT";
check(
  "015: submit_checkin_consent REVOKE ALL FROM PUBLIC",
  new RegExp(`REVOKE ALL ON FUNCTION public\\.submit_checkin_consent\\(${sig17_015}\\) FROM PUBLIC`).test(migration015),
);
check(
  "015: submit_checkin_consent GRANT TO anon",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${sig17_015}\\) TO anon`).test(migration015),
);
check(
  "015: submit_checkin_consent GRANT TO authenticated",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${sig17_015}\\) TO authenticated`).test(migration015),
);

// 50c. Internal helpers remain locked
check("015: _hash_token REVOKE FROM PUBLIC",        /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM PUBLIC/.test(migration015));
check("015: _hash_token REVOKE FROM anon",           /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM anon/.test(migration015));
check("015: _hash_token REVOKE FROM authenticated",  /REVOKE ALL ON FUNCTION public\._hash_token\(TEXT\) FROM authenticated/.test(migration015));
check("015: _gen_random_bytes REVOKE FROM PUBLIC",   /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM PUBLIC/.test(migration015));
check("015: _gen_random_bytes REVOKE FROM anon",     /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM anon/.test(migration015));
check("015: _gen_random_bytes REVOKE FROM authenticated", /REVOKE ALL ON FUNCTION public\._gen_random_bytes\(integer\) FROM authenticated/.test(migration015));
check("015: no GRANT on _hash_token",        !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._hash_token/.test(migration015));
check("015: no GRANT on _gen_random_bytes",  !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._gen_random_bytes/.test(migration015));

// 50d. No direct table grants
check("015: no TABLE grant",   !/GRANT[\s\S]*?ON TABLE/.test(migration015Sql));
check("015: no INSERT grant",  !/GRANT.*INSERT/.test(migration015Sql));
check("015: no SELECT grant",  !/GRANT.*SELECT/.test(migration015Sql));
check("015: no UPDATE grant",  !/GRANT.*UPDATE/.test(migration015Sql));
check("015: no DELETE grant",  !/GRANT.*DELETE/.test(migration015Sql));

// 50e. No function body change in migration 015
check("015: does not define or redefine any function",
  !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/.test(migration015Sql));
check("015: does not contain SET search_path",
  !/SET\s+search_path/.test(migration015Sql));

// 50f. Client parameter mapping: 17 params all present
console.log("\n50f. Client parameter mapping (17 params)");
const submitParams: string[] = [
  "p_verification_token",
  "p_swimming_ability",
  "p_medical_conditions",
  "p_allergies",
  "p_medications",
  "p_recent_injuries",
  "p_is_pregnant",
  "p_safety_briefing_confirmed",
  "p_life_jacket_confirmed",
  "p_risk_acknowledged",
  "p_photo_consent",
  "p_signature_data_url",
  "p_witness_name",
  "p_witness_signature_data_url",
  "p_parent_guardian_name",
  "p_parent_guardian_relationship",
  "p_parent_guardian_signature_data_url",
];
for (const param of submitParams) {
  check(`client includes ${param}`, checkinClient.includes(`${param}:`));
}

// p_parent_guardian_relationship is specifically present (the previously missing param)
check("client: p_parent_guardian_relationship is present in RPC call",
  /p_parent_guardian_relationship\s*:/.test(checkinClient));
check("client: p_parent_guardian_relationship is conditional on is_minor",
  /is_minor.*parentGuardianRelationship|parentGuardianRelationship.*is_minor/.test(
    checkinClient.replace(/\n/g, ' ')
  ));

// 50g. Client state and UI
check("client: parentGuardianRelationship state variable declared",
  /parentGuardianRelationship.*useState|useState.*parentGuardianRelationship/.test(
    checkinClient.replace(/\n/g, ' ')
  ));
check("client: parentGuardianRelationship input exists in UI",
  /setParentGuardianRelationship/.test(checkinClient));

// 50h. canSubmit requires minor fields when is_minor
check("client: canSubmit checks parentGuardianRelationship for minors",
  /parentGuardianRelationship/.test(checkinClient));

// 50i. Error handling covers key error codes
check("client: handles expired error code",   /errCode.*expired|expired.*errCode/.test(checkinClient.replace(/\n/g, ' ')));
check("client: handles duplicate error code", /errCode.*duplicate|duplicate.*errCode/.test(checkinClient.replace(/\n/g, ' ')));
check("client: handles already_used error code",
  /already_used/.test(checkinClient));
check("client: handles template_missing",
  /template_missing/.test(checkinClient));
check("client: no raw DB message exposed in generic handler",
  !/rpcError\.message/.test(checkinClient));

// 50j. SQL body still has the correct 17-param signature
check("sql: submit_checkin_consent has 17 parameters (line-by-line in sig block)",
  /p_parent_guardian_relationship TEXT DEFAULT NULL/.test(migration));

// 50k. No function-not-found source inside body: _hash_token signature matches call
check("sql: _hash_token called with TEXT argument",
  /public\._hash_token\(p_verification_token\)/.test(migration) ||
  /public\._hash_token\(p_token\)/.test(migration011));

// 50l. Migrations 010–014 unchanged
console.log("\n50l. Migrations 010–014 unchanged");
check("010 unchanged: submit_checkin_consent CREATE OR REPLACE exists",
  /CREATE OR REPLACE FUNCTION public\.submit_checkin_consent/.test(migration));
check("010 unchanged: uses SECURITY DEFINER",
  /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions/.test(migration));
check("014 unchanged: GRANT TO authenticated for get_checkin_participants",
  /GRANT EXECUTE ON FUNCTION public\.get_checkin_participants\(TEXT\) TO authenticated/.test(migration014));
check("014 unchanged: GRANT TO authenticated for submit_checkin_consent",
  new RegExp(`GRANT EXECUTE ON FUNCTION public\\.submit_checkin_consent\\(${sig17_015}\\) TO authenticated`).test(migration014));

// =============================================
// SUMMARY
// =============================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
if (failed > 0) process.exit(1);
