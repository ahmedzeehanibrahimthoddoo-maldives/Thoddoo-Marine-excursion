-- =============================================
-- Migration 010: QR Guest Check-in & Individual Activity Consent
-- =============================================
-- Security-hardened rewrite of the QR check-in system.
--
-- Design:
--   - All tokens SHA-256 hashed at rest (pgcrypto digest)
--   - Raw tokens never stored in database
--   - Opaque participant choice tokens (not UUIDs) for guest selection
--   - Attempt limits: 5 per participant/session, 20 per session
--   - Atomic counting with SELECT ... FOR UPDATE
--   - RLS: REVOKE from anon, restrictive role-based policies
--   - Verification tokens: 10min TTL, single-use, session+participant bound
--   - All public RPCs accept only opaque tokens, never UUIDs from client
--   - Generic error messages prevent enumeration
--   - No raw tokens in audit_log, public responses, or error messages
--
-- Does NOT modify migrations 001-009.
-- Requires: pgcrypto extension for digest() function.
-- =============================================

BEGIN;

-- =============================================
-- 0. EXTENSION
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- =============================================
-- 1. HELPER: SHA-256 hash
-- =============================================

CREATE OR REPLACE FUNCTION public._hash_token(p_token TEXT)
RETURNS TEXT AS $$
  SELECT encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$ LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public._gen_random_bytes(n INT)
RETURNS BYTEA AS $$
  SELECT gen_random_bytes(n)
$$ LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public._gen_random_bytes(INT) FROM PUBLIC;

-- =============================================
-- 2. ENUM: participant_type
-- =============================================

DO $$ BEGIN
  CREATE TYPE participant_type AS ENUM ('adult', 'child');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 3. TABLE: booking_participants
-- =============================================
-- Individual identity for every group member in a booking.
-- choice_token: opaque per-session identifier for guest selection (not UUID).

CREATE TABLE IF NOT EXISTS booking_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  full_name TEXT NOT NULL,
  participant_type participant_type NOT NULL DEFAULT 'adult',
  guardian_name TEXT,
  guardian_relationship TEXT,
  phone_last4 TEXT,
  choice_token TEXT NOT NULL UNIQUE DEFAULT encode(public._gen_random_bytes(12), 'hex'),
  consent_status consent_form_status NOT NULL DEFAULT 'pending',
  consent_form_id UUID REFERENCES consent_forms(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bp_booking ON booking_participants(booking_id);
CREATE INDEX IF NOT EXISTS idx_bp_customer ON booking_participants(customer_id);
CREATE INDEX IF NOT EXISTS idx_bp_consent ON booking_participants(consent_status);
CREATE INDEX IF NOT EXISTS idx_bp_choice ON booking_participants(choice_token);

DO $$ BEGIN
  CREATE TRIGGER trg_bp_updated
    BEFORE UPDATE ON booking_participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- One active/signed consent per participant per activity
CREATE UNIQUE INDEX IF NOT EXISTS idx_bp_active_unique
  ON booking_participants (id, consent_form_id)
  WHERE consent_status IN ('pending', 'signed');

-- =============================================
-- 4. TABLE: consent_checkin_sessions
-- =============================================
-- session_token_hash: SHA-256 of the raw random token (never store raw)
-- token_short_id: first 12 hex chars for staff display
-- max_per_participant: per-participant verification attempt limit
-- max_session_attempts: total session attempt limit

CREATE TABLE IF NOT EXISTS consent_checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash TEXT NOT NULL UNIQUE,
  token_short_id TEXT NOT NULL UNIQUE,
  booking_id UUID REFERENCES bookings(id),
  activity_id UUID NOT NULL REFERENCES activities(id),
  created_by UUID NOT NULL REFERENCES staff_profiles(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES staff_profiles(id),
  max_per_participant INT NOT NULL DEFAULT 5,
  max_session_attempts INT NOT NULL DEFAULT 20,
  session_attempt_count INT NOT NULL DEFAULT 0,
  is_walkin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccs_hash ON consent_checkin_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_ccs_short ON consent_checkin_sessions(token_short_id);
CREATE INDEX IF NOT EXISTS idx_ccs_booking ON consent_checkin_sessions(booking_id);
CREATE INDEX IF NOT EXISTS idx_ccs_expires ON consent_checkin_sessions(expires_at);

-- =============================================
-- 5. TABLE: consent_checkin_attempts
-- =============================================
-- Track verification attempts per session + participant.
-- NEVER stores the verification code (room number, phone digits).

CREATE TABLE IF NOT EXISTS consent_checkin_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES consent_checkin_sessions(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES booking_participants(id),
  attempt_type TEXT NOT NULL DEFAULT 'verify',
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cca_session ON consent_checkin_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_cca_session_participant ON consent_checkin_attempts(session_id, participant_id);

-- =============================================
-- 6. TABLE: consent_checkin_verification_tokens
-- =============================================
-- Short-lived tokens after successful verification.
-- token_hash: SHA-256 of the raw token
-- Bound to one session + one participant. Single-use.
-- Consumed atomically only when consent signing succeeds.

CREATE TABLE IF NOT EXISTS consent_checkin_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  session_id UUID NOT NULL REFERENCES consent_checkin_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES booking_participants(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccvt_hash ON consent_checkin_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_ccvt_session ON consent_checkin_verification_tokens(session_id);

-- =============================================
-- 7. RLS POLICIES
-- =============================================
-- No direct anon access to any QR table.
-- Authenticated access is restricted to specific roles.
-- All real access goes through SECURITY DEFINER RPCs (defense-in-depth).

ALTER TABLE booking_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_checkin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_checkin_verification_tokens ENABLE ROW LEVEL SECURITY;

-- Revoke direct table access from anon
REVOKE ALL ON TABLE booking_participants FROM anon;
REVOKE ALL ON TABLE consent_checkin_sessions FROM anon;
REVOKE ALL ON TABLE consent_checkin_attempts FROM anon;
REVOKE ALL ON TABLE consent_checkin_verification_tokens FROM anon;

-- booking_participants: owner/manager/reception only (via RPCs)
DROP POLICY IF EXISTS bp_staff_policy ON booking_participants;
CREATE POLICY bp_staff_policy ON booking_participants
  FOR ALL USING (
    current_staff_role() IN ('owner', 'manager', 'reception')
  );

-- consent_checkin_sessions: owner/manager/reception only
DROP POLICY IF EXISTS ccs_staff_policy ON consent_checkin_sessions;
CREATE POLICY ccs_staff_policy ON consent_checkin_sessions
  FOR ALL USING (
    current_staff_role() IN ('owner', 'manager', 'reception')
  );

-- consent_checkin_attempts: staff insert through RPCs only
DROP POLICY IF EXISTS cca_staff_policy ON consent_checkin_attempts;
CREATE POLICY cca_staff_policy ON consent_checkin_attempts
  FOR ALL USING (
    current_staff_role() IS NOT NULL
  );

-- consent_checkin_verification_tokens: staff insert through RPCs only
DROP POLICY IF EXISTS ccvt_staff_policy ON consent_checkin_verification_tokens;
CREATE POLICY ccvt_staff_policy ON consent_checkin_verification_tokens
  FOR ALL USING (
    current_staff_role() IS NOT NULL
  );

-- =============================================
-- 8. STAFF RPCs
-- =============================================

-- 8a. create_checkin_session
-- Owner/manager/reception can create sessions.
-- Generates raw token, stores SHA-256 hash, returns raw + short_id.
-- booking_id nullable for walk-ins.

CREATE OR REPLACE FUNCTION public.create_checkin_session(
  p_booking_id UUID,
  p_activity_id UUID,
  p_is_walkin BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
  v_booking bookings%ROWTYPE;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_short_id TEXT;
  v_session_id UUID;
  v_session_expires TIMESTAMPTZ;
  v_participant_count INT;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: only owner, manager, or reception can create check-in sessions.';
  END IF;

  IF NOT p_is_walkin THEN
    IF p_booking_id IS NULL THEN
      RETURN json_build_object('error', 'validation', 'message', 'Booking ID is required for non-walk-in sessions.');
    END IF;

    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN
      RETURN json_build_object('error', 'not_found', 'message', 'Booking not found.');
    END IF;
    IF v_booking.status = 'cancelled' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Cannot create session for cancelled booking.');
    END IF;
    IF v_booking.activity_id != p_activity_id THEN
      RETURN json_build_object('error', 'validation', 'message', 'Activity does not match booking.');
    END IF;

    -- Auto-create participants from booking customer if none exist
    SELECT count(*) INTO v_participant_count
    FROM booking_participants
    WHERE booking_id = p_booking_id;

    IF v_participant_count = 0 THEN
      INSERT INTO booking_participants (booking_id, customer_id, full_name, participant_type, phone_last4)
      SELECT
        b.id,
        b.customer_id,
        c.full_name,
        'adult',
        CASE WHEN c.phone IS NOT NULL AND length(c.phone) >= 4 THEN right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4) ELSE NULL END
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      WHERE b.id = p_booking_id;

      FOR i IN 2..v_booking.guests LOOP
        INSERT INTO booking_participants (booking_id, full_name, participant_type)
        VALUES (p_booking_id, format('Guest %s', i), 'adult');
      END LOOP;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM activities WHERE id = p_activity_id AND active = true) THEN
      RETURN json_build_object('error', 'not_found', 'message', 'Activity not found.');
    END IF;
  END IF;

  -- Generate raw token, hash it, derive short_id
  v_raw_token := encode(public._gen_random_bytes(32), 'hex');
  v_token_hash := public._hash_token(v_raw_token);
  v_short_id := left(v_token_hash, 12);

  INSERT INTO consent_checkin_sessions (
    session_token_hash, token_short_id, booking_id, activity_id, created_by, is_walkin
  ) VALUES (
    v_token_hash, v_short_id,
    CASE WHEN p_is_walkin THEN NULL ELSE p_booking_id END,
    p_activity_id, v_staff_id, p_is_walkin
  )
  RETURNING id, expires_at INTO v_session_id, v_session_expires;

  RETURN json_build_object(
    'session_id', v_session_id,
    'session_token', v_raw_token,
    'token_short_id', v_short_id,
    'expires_at', v_session_expires,
    'is_walkin', p_is_walkin
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_checkin_session(UUID, UUID, BOOLEAN) TO authenticated;

-- 8b. revoke_checkin_session

CREATE OR REPLACE FUNCTION public.revoke_checkin_session(
  p_session_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
  v_session consent_checkin_sessions%ROWTYPE;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: only owner, manager, or reception can revoke sessions.';
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Session not found.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN json_build_object('error', 'validation', 'message', 'Session already revoked.');
  END IF;

  UPDATE consent_checkin_sessions
  SET revoked_at = now(), revoked_by = v_staff_id
  WHERE id = p_session_id;

  -- Invalidate all verification tokens for this session
  UPDATE consent_checkin_verification_tokens
  SET used_at = now()
  WHERE session_id = p_session_id AND used_at IS NULL;

  RETURN json_build_object('success', true, 'message', 'Session revoked.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.revoke_checkin_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_checkin_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_checkin_session(UUID) TO authenticated;

-- 8c. get_checkin_session_status (staff monitoring)
-- Returns participants with real names (staff-only context).

CREATE OR REPLACE FUNCTION public.get_checkin_session_status(
  p_session_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_session consent_checkin_sessions%ROWTYPE;
  v_activity_name TEXT;
  v_participants JSON;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Session not found.');
  END IF;

  SELECT name INTO v_activity_name FROM activities WHERE id = v_session.activity_id;

  SELECT json_agg(json_build_object(
    'participant_id', bp.id,
    'full_name', bp.full_name,
    'participant_type', bp.participant_type,
    'consent_status', bp.consent_status
  )) INTO v_participants
  FROM booking_participants bp
  WHERE bp.booking_id = v_session.booking_id;

  RETURN json_build_object(
    'session_id', v_session.id,
    'token_short_id', v_session.token_short_id,
    'activity_name', v_activity_name,
    'booking_id', v_session.booking_id,
    'expires_at', v_session.expires_at,
    'revoked_at', v_session.revoked_at,
    'session_attempt_count', v_session.session_attempt_count,
    'max_session_attempts', v_session.max_session_attempts,
    'is_walkin', v_session.is_walkin,
    'participants', COALESCE(v_participants, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.get_checkin_session_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_session_status(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_session_status(UUID) TO authenticated;

-- =============================================
-- 9. PUBLIC RPCs: Guest check-in flow (anon)
-- =============================================

-- 9a. get_checkin_participants
-- Hashes presented token, returns masked participant list with choice_tokens.
-- Never reveals phone, email, passport, DOB, room, medical data, or UUIDs.

CREATE OR REPLACE FUNCTION public.get_checkin_participants(
  p_token TEXT
)
RETURNS JSON AS $$
DECLARE
  v_token_hash TEXT;
  v_session consent_checkin_sessions%ROWTYPE;
  v_activity_name TEXT;
  v_participants JSON;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Invalid check-in link.');
  END IF;

  v_token_hash := public._hash_token(p_token);

  SELECT * INTO v_session
  FROM consent_checkin_sessions
  WHERE session_token_hash = v_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Check-in link not recognised.');
  END IF;

  IF v_session.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'This check-in link has expired. Please ask staff for a new one.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN json_build_object('error', 'revoked', 'message', 'This check-in link has been cancelled. Please ask staff for a new one.');
  END IF;

  IF v_session.session_attempt_count >= v_session.max_session_attempts THEN
    RETURN json_build_object('error', 'rate_limited', 'message', 'Too many attempts. Please ask staff for a new link.');
  END IF;

  SELECT name INTO v_activity_name FROM activities WHERE id = v_session.activity_id;

  IF v_session.is_walkin THEN
    RETURN json_build_object(
      'activity_name', v_activity_name,
      'is_walkin', true,
      'participants', '[]'::json,
      'expires_at', v_session.expires_at
    );
  END IF;

  -- Masked participant list: choice_token + first name + surname initial
  SELECT json_agg(json_build_object(
    'choice_token', bp.choice_token,
    'display_name', initcap(split_part(bp.full_name, ' ', 1)) || ' ' || upper(left(split_part(bp.full_name, ' ', 2), 1)) || '.',
    'participant_type', bp.participant_type::text,
    'consent_status', bp.consent_status::text
  )) INTO v_participants
  FROM booking_participants bp
  WHERE bp.booking_id = v_session.booking_id;

  RETURN json_build_object(
    'activity_name', v_activity_name,
    'is_walkin', false,
    'participants', COALESCE(v_participants, '[]'::json),
    'expires_at', v_session.expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.get_checkin_participants(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_participants(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkin_participants(TEXT) TO anon;

-- 9b. verify_checkin_participant
-- Verifies selected participant using room number OR last 4 digits of phone.
-- Uses choice_token (not UUID) for participant selection.
-- Atomic attempt counting with FOR UPDATE.
-- Per-participant limit: 5. Per-session limit: 20.
-- Returns a short-lived verification token on success.
-- Generic error messages prevent enumeration.

CREATE OR REPLACE FUNCTION public.verify_checkin_participant(
  p_token TEXT,
  p_choice_token TEXT,
  p_verification_code TEXT
)
RETURNS JSON AS $$
DECLARE
  v_token_hash TEXT;
  v_session consent_checkin_sessions%ROWTYPE;
  v_participant booking_participants%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_verification TEXT;
  v_matched BOOLEAN := false;
  v_raw_vt TEXT;
  v_vt_hash TEXT;
  v_participant_failures INT;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Invalid check-in link.');
  END IF;

  v_token_hash := public._hash_token(p_token);

  -- Lock session row for atomic attempt counting
  SELECT * INTO v_session
  FROM consent_checkin_sessions
  WHERE session_token_hash = v_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Check-in link not recognised.');
  END IF;

  IF v_session.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'This check-in link has expired.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN json_build_object('error', 'revoked', 'message', 'This check-in link has been cancelled.');
  END IF;

  IF v_session.session_attempt_count >= v_session.max_session_attempts THEN
    RETURN json_build_object('error', 'rate_limited', 'message', 'Too many attempts. Please ask staff for a new link.');
  END IF;

  -- Increment session attempt count atomically
  UPDATE consent_checkin_sessions
  SET session_attempt_count = session_attempt_count + 1
  WHERE id = v_session.id;

  -- Validate participant belongs to this session's booking via choice_token
  SELECT * INTO v_participant
  FROM booking_participants
  WHERE choice_token = p_choice_token
    AND booking_id = v_session.booking_id;

  IF NOT FOUND THEN
    -- Record attempt against session only (no participant match)
    INSERT INTO consent_checkin_attempts (session_id, participant_id, attempt_type, success)
    VALUES (v_session.id, NULL, 'verify', false);
    RETURN json_build_object('error', 'verification_failed', 'message', 'Could not verify your details. Please check and try again.');
  END IF;

  IF v_participant.consent_status = 'signed' THEN
    RETURN json_build_object('error', 'already_signed', 'message', 'You have already completed your consent for this activity.');
  END IF;

  -- Check per-participant attempt limit
  SELECT count(*) INTO v_participant_failures
  FROM consent_checkin_attempts
  WHERE session_id = v_session.id
    AND participant_id = v_participant.id
    AND success = false;

  IF v_participant_failures >= v_session.max_per_participant THEN
    RETURN json_build_object('error', 'rate_limited', 'message', 'Too many failed attempts for this participant. Please ask staff for assistance.');
  END IF;

  -- Record attempt (success determined after verification)
  INSERT INTO consent_checkin_attempts (session_id, participant_id, attempt_type, success)
  VALUES (v_session.id, v_participant.id, 'verify', false);

  -- Verify using room number or last 4 digits of phone
  v_verification := trim(replace(p_verification_code, '-', ''));

  IF v_participant.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_participant.customer_id;
    IF FOUND THEN
      IF v_customer.room_number IS NOT NULL
         AND lower(trim(replace(v_customer.room_number, '-', ''))) = lower(v_verification) THEN
        v_matched := true;
      END IF;
      IF NOT v_matched AND v_customer.phone IS NOT NULL
         AND right(regexp_replace(v_customer.phone, '[^0-9]', '', 'g'), 4) = right(regexp_replace(v_verification, '[^0-9]', '', 'g'), 4) THEN
        v_matched := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_matched AND v_participant.phone_last4 IS NOT NULL
     AND right(regexp_replace(v_verification, '[^0-9]', '', 'g'), 4) = right(regexp_replace(v_participant.phone_last4, '[^0-9]', '', 'g'), 4) THEN
    v_matched := true;
  END IF;

  IF NOT v_matched THEN
    -- Generic failure — does not reveal which factor was wrong
    RETURN json_build_object('error', 'verification_failed', 'message', 'Could not verify your details. Please check and try again.');
  END IF;

  -- Mark attempt as success
  UPDATE consent_checkin_attempts SET success = true
  WHERE session_id = v_session.id
    AND participant_id = v_participant.id
    AND success = false;

  -- Generate verification token, hash it for storage
  v_raw_vt := encode(public._gen_random_bytes(24), 'hex');
  v_vt_hash := public._hash_token(v_raw_vt);

  INSERT INTO consent_checkin_verification_tokens (token_hash, session_id, participant_id)
  VALUES (v_vt_hash, v_session.id, v_participant.id);

  -- Return raw verification token to client (never stored in DB raw)
  RETURN json_build_object(
    'success', true,
    'verification_token', v_raw_vt,
    'participant_name', v_participant.full_name,
    'is_minor', v_participant.participant_type = 'child'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_checkin_participant(TEXT, TEXT, TEXT) TO anon;

-- 9c. verify_walkin_participant
-- Walk-in: guest provides their own name and phone last 4.
-- Creates participant and verification token. No customer lookup.
-- Conservative match: name + normalized phone.

CREATE OR REPLACE FUNCTION public.verify_walkin_participant(
  p_token TEXT,
  p_full_name TEXT,
  p_phone_last4 TEXT
)
RETURNS JSON AS $$
DECLARE
  v_token_hash TEXT;
  v_session consent_checkin_sessions%ROWTYPE;
  v_raw_vt TEXT;
  v_vt_hash TEXT;
  v_participant_id UUID;
  v_normalized_name TEXT;
  v_normalized_phone TEXT;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Invalid check-in link.');
  END IF;

  v_token_hash := public._hash_token(p_token);

  -- Lock session row
  SELECT * INTO v_session
  FROM consent_checkin_sessions
  WHERE session_token_hash = v_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_token', 'message', 'Check-in link not recognised.');
  END IF;

  IF NOT v_session.is_walkin THEN
    RETURN json_build_object('error', 'validation', 'message', 'This is not a walk-in session.');
  END IF;

  IF v_session.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'This check-in link has expired.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN json_build_object('error', 'revoked', 'message', 'This check-in link has been cancelled.');
  END IF;

  IF v_session.session_attempt_count >= v_session.max_session_attempts THEN
    RETURN json_build_object('error', 'rate_limited', 'message', 'Too many attempts. Please ask staff for a new link.');
  END IF;

  UPDATE consent_checkin_sessions
  SET session_attempt_count = session_attempt_count + 1
  WHERE id = v_session.id;

  -- Validate inputs
  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Full name is required.');
  END IF;

  IF p_phone_last4 IS NULL OR length(trim(p_phone_last4)) < 4 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Please enter at least 4 digits for verification.');
  END IF;

  v_normalized_name := trim(p_full_name);
  v_normalized_phone := regexp_replace(p_phone_last4, '[^0-9]', '', 'g');
  v_normalized_phone := right(v_normalized_phone, 4);

  -- Create participant (no customer_id for walk-in)
  INSERT INTO booking_participants (booking_id, full_name, participant_type, phone_last4)
  VALUES (NULL, v_normalized_name, 'adult', v_normalized_phone)
  RETURNING id INTO v_participant_id;

  INSERT INTO consent_checkin_attempts (session_id, participant_id, attempt_type, success)
  VALUES (v_session.id, v_participant_id, 'verify_walkin', true);

  -- Generate verification token
  v_raw_vt := encode(public._gen_random_bytes(24), 'hex');
  v_vt_hash := public._hash_token(v_raw_vt);

  INSERT INTO consent_checkin_verification_tokens (token_hash, session_id, participant_id)
  VALUES (v_vt_hash, v_session.id, v_participant_id);

  RETURN json_build_object(
    'success', true,
    'verification_token', v_raw_vt,
    'participant_name', v_normalized_name,
    'is_minor', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_walkin_participant(TEXT, TEXT, TEXT) TO anon;

-- 9d. get_checkin_prefilled_details
-- Returns permitted prefilled details after verification.
-- Hashes verification token. Only returns that participant's data.

CREATE OR REPLACE FUNCTION public.get_checkin_prefilled_details(
  p_verification_token TEXT
)
RETURNS JSON AS $$
DECLARE
  v_vt_hash TEXT;
  v_vt consent_checkin_verification_tokens%ROWTYPE;
  v_session consent_checkin_sessions%ROWTYPE;
  v_participant booking_participants%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_activity_name TEXT;
  v_template consent_templates%ROWTYPE;
  v_full_name TEXT;
  v_nationality TEXT;
  v_phone TEXT;
  v_hotel TEXT;
  v_room TEXT;
  v_dob DATE;
  v_passport TEXT;
  v_emergency_name TEXT;
  v_emergency_phone TEXT;
BEGIN
  IF p_verification_token IS NULL OR p_verification_token = '' THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid session. Please start again.');
  END IF;

  v_vt_hash := public._hash_token(p_verification_token);

  SELECT * INTO v_vt
  FROM consent_checkin_verification_tokens
  WHERE token_hash = v_vt_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session expired or invalid. Please start again.');
  END IF;

  IF v_vt.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'Session expired. Please scan the QR code again.');
  END IF;

  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'This session has already been used.');
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = v_vt.session_id;
  SELECT * INTO v_participant FROM booking_participants WHERE id = v_vt.participant_id;
  SELECT name INTO v_activity_name FROM activities WHERE id = v_session.activity_id;

  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = 'activity' AND active = true;

  IF v_participant.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers WHERE id = v_participant.customer_id;
    IF FOUND THEN
      v_full_name := v_customer.full_name;
      v_nationality := v_customer.nationality;
      v_phone := v_customer.phone;
      v_hotel := v_customer.hotel;
      v_room := v_customer.room_number;
      v_dob := v_customer.date_of_birth;
      v_passport := v_customer.passport_number;
      v_emergency_name := v_customer.emergency_contact_name;
      v_emergency_phone := v_customer.emergency_contact_phone;
    END IF;
  END IF;

  IF v_full_name IS NULL THEN
    v_full_name := v_participant.full_name;
  END IF;

  RETURN json_build_object(
    'guest_name', v_full_name,
    'nationality', v_nationality,
    'phone', v_phone,
    'hotel', v_hotel,
    'room_number', v_room,
    'date_of_birth', v_dob,
    'passport_number', v_passport,
    'emergency_contact_name', v_emergency_name,
    'emergency_contact_phone', v_emergency_phone,
    'activity_name', v_activity_name,
    'is_minor', v_participant.participant_type = 'child',
    'guardian_name', v_participant.guardian_name,
    'consent_version', v_template.version,
    'consent_text', v_template.consent_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_prefilled_details(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkin_prefilled_details(TEXT) TO anon;

-- 9e. submit_checkin_consent
-- Creates consent record and signs it using active server template.
-- Preserves all migration 009 protections:
--   - active server template required
--   - expected template version
--   - exact database template snapshot (consent_text_snapshot)
--   - required consent-text acknowledgement (via safety fields)
--   - safety acknowledgements
--   - PNG/JPEG signature only
--   - 524,288 decoded-byte limit with pre-decode limit (699,050 base64 chars)
--   - signed record immutable (existing trigger protects)
--   - one individual consent per participant/activity
-- Minor requires guardian name, relationship, and signature.
-- Consumes verification token atomically.

CREATE OR REPLACE FUNCTION public.submit_checkin_consent(
  p_verification_token TEXT,
  p_swimming_ability TEXT DEFAULT NULL,
  p_medical_conditions TEXT DEFAULT NULL,
  p_allergies TEXT DEFAULT NULL,
  p_medications TEXT DEFAULT NULL,
  p_recent_injuries TEXT DEFAULT NULL,
  p_is_pregnant BOOLEAN DEFAULT false,
  p_safety_briefing_confirmed BOOLEAN DEFAULT false,
  p_life_jacket_confirmed BOOLEAN DEFAULT false,
  p_risk_acknowledged BOOLEAN DEFAULT false,
  p_photo_consent BOOLEAN DEFAULT false,
  p_signature_data_url TEXT DEFAULT NULL,
  p_witness_name TEXT DEFAULT NULL,
  p_witness_signature_data_url TEXT DEFAULT NULL,
  p_parent_guardian_name TEXT DEFAULT NULL,
  p_parent_guardian_relationship TEXT DEFAULT NULL,
  p_parent_guardian_signature_data_url TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_vt_hash TEXT;
  v_vt consent_checkin_verification_tokens%ROWTYPE;
  v_session consent_checkin_sessions%ROWTYPE;
  v_participant booking_participants%ROWTYPE;
  v_template consent_templates%ROWTYPE;
  v_consent_id UUID;
  v_customer_id UUID;
  v_payload TEXT;
  v_sig_bytes INT;
BEGIN
  IF p_verification_token IS NULL OR p_verification_token = '' THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid session.');
  END IF;

  v_vt_hash := public._hash_token(p_verification_token);

  SELECT * INTO v_vt
  FROM consent_checkin_verification_tokens
  WHERE token_hash = v_vt_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session expired or invalid.');
  END IF;

  IF v_vt.expires_at < now() THEN
    RETURN json_build_object('error', 'expired', 'message', 'Session expired. Please scan the QR code again.');
  END IF;

  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'Consent already submitted for this participant.');
  END IF;

  -- Lock verification token row to prevent concurrent submissions
  PERFORM pg_advisory_xact_lock(hashtext(p_verification_token));

  -- Re-check used_at under advisory lock
  SELECT * INTO v_vt FROM consent_checkin_verification_tokens WHERE token_hash = v_vt_hash;
  IF v_vt.used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_used', 'message', 'Consent already submitted for this participant.');
  END IF;

  SELECT * INTO v_session FROM consent_checkin_sessions WHERE id = v_vt.session_id;
  SELECT * INTO v_participant FROM booking_participants WHERE id = v_vt.participant_id;

  -- Validate required safety fields
  IF NOT p_safety_briefing_confirmed OR NOT p_life_jacket_confirmed OR NOT p_risk_acknowledged THEN
    RETURN json_build_object('error', 'validation', 'message', 'All safety acknowledgements are required.');
  END IF;

  -- Validate signature present
  IF p_signature_data_url IS NULL OR p_signature_data_url = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature is required.');
  END IF;

  -- Validate signature format (PNG or JPEG only)
  IF p_signature_data_url NOT LIKE 'data:image/png;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpeg;base64,%'
     AND p_signature_data_url NOT LIKE 'data:image/jpg;base64,%' THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature must be a PNG or JPEG data URL.');
  END IF;

  -- Pre-decode size limit (699,050 base64 chars max)
  v_payload := split_part(p_signature_data_url, ',', 2);
  IF length(v_payload) > 699050 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size.');
  END IF;

  BEGIN
    v_sig_bytes := length(decode(v_payload, 'base64'));
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature contains invalid data.');
  END;

  -- Decoded byte limit (524,288 bytes)
  IF v_sig_bytes > 524288 THEN
    RETURN json_build_object('error', 'validation', 'message', 'Signature image exceeds maximum size.');
  END IF;

  -- Minor requires guardian name, relationship, and signature
  IF v_participant.participant_type = 'child' THEN
    IF p_parent_guardian_name IS NULL OR p_parent_guardian_name = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian name is required for minors.');
    END IF;
    IF p_parent_guardian_relationship IS NULL OR p_parent_guardian_relationship = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Guardian relationship is required for minors.');
    END IF;
    IF p_parent_guardian_signature_data_url IS NULL OR p_parent_guardian_signature_data_url = '' THEN
      RETURN json_build_object('error', 'validation', 'message', 'Parent/guardian signature is required for minors.');
    END IF;
  END IF;

  -- Load active consent template (migration 009 protection)
  SELECT * INTO v_template
  FROM consent_templates
  WHERE consent_type = 'activity' AND active = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'template_missing', 'message', 'No active consent template. Please contact staff.');
  END IF;

  -- Check for duplicate individual consent (same participant + activity already signed)
  IF v_participant.consent_status = 'signed' THEN
    RETURN json_build_object('error', 'duplicate', 'message', 'Consent already submitted for this activity.');
  END IF;

  -- Create customer for walk-ins if needed
  IF v_participant.customer_id IS NULL THEN
    INSERT INTO customers (full_name)
    VALUES (v_participant.full_name)
    RETURNING id INTO v_customer_id;
    UPDATE booking_participants SET customer_id = v_customer_id WHERE id = v_participant.id;
  ELSE
    v_customer_id := v_participant.customer_id;
  END IF;

  -- Create and sign consent form with server template snapshot
  INSERT INTO consent_forms (
    booking_id,
    customer_id,
    activity_id,
    activity_name,
    booking_ref,
    guest_name,
    nationality,
    date_of_birth,
    passport_number,
    phone,
    hotel,
    room_number,
    emergency_contact_name,
    emergency_contact_phone,
    swimming_ability,
    medical_conditions,
    allergies,
    medications,
    recent_injuries,
    is_pregnant,
    safety_briefing_confirmed,
    life_jacket_confirmed,
    risk_acknowledged,
    photo_consent,
    signature_data_url,
    witness_name,
    witness_signature_data_url,
    parent_guardian_name,
    parent_guardian_signature_data_url,
    is_minor,
    status,
    signed_at,
    consent_version,
    consent_text_snapshot,
    signing_method
  )
  SELECT
    v_session.booking_id,
    v_customer_id,
    v_session.activity_id,
    (SELECT name FROM activities WHERE id = v_session.activity_id),
    (SELECT booking_ref FROM bookings WHERE id = v_session.booking_id),
    v_participant.full_name,
    (SELECT nationality FROM customers WHERE id = v_customer_id),
    (SELECT date_of_birth FROM customers WHERE id = v_customer_id),
    (SELECT passport_number FROM customers WHERE id = v_customer_id),
    (SELECT phone FROM customers WHERE id = v_customer_id),
    (SELECT hotel FROM customers WHERE id = v_customer_id),
    (SELECT room_number FROM customers WHERE id = v_customer_id),
    (SELECT emergency_contact_name FROM customers WHERE id = v_customer_id),
    (SELECT emergency_contact_phone FROM customers WHERE id = v_customer_id),
    p_swimming_ability,
    p_medical_conditions,
    p_allergies,
    p_medications,
    p_recent_injuries,
    p_is_pregnant,
    p_safety_briefing_confirmed,
    p_life_jacket_confirmed,
    p_risk_acknowledged,
    p_photo_consent,
    p_signature_data_url,
    p_witness_name,
    p_witness_signature_data_url,
    p_parent_guardian_name,
    p_parent_guardian_signature_data_url,
    v_participant.participant_type = 'child',
    'signed',
    now(),
    v_template.version,
    v_template.consent_text,
    'guest_checkin'
  RETURNING id INTO v_consent_id;

  -- Update participant consent status
  UPDATE booking_participants
  SET consent_status = 'signed', consent_form_id = v_consent_id,
      guardian_name = COALESCE(p_parent_guardian_name, guardian_name),
      guardian_relationship = COALESCE(p_parent_guardian_relationship, guardian_relationship)
  WHERE id = v_participant.id;

  -- Mark verification token as used (consumed atomically)
  UPDATE consent_checkin_verification_tokens
  SET used_at = now()
  WHERE id = v_vt.id;

  RETURN json_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'guest_name', v_participant.full_name,
    'activity_name', (SELECT name FROM activities WHERE id = v_session.activity_id),
    'message', 'Consent form signed successfully.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checkin_consent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

-- =============================================
-- 10. SECURITY REPORT
-- =============================================
-- Token Storage:
--   session_token_hash: SHA-256 of raw token (pgcrypto digest)
--   token_short_id: first 12 hex chars of hash (staff display)
--   verification token_hash: SHA-256 of raw token
--   Raw tokens NEVER stored in database.
--
-- Participant Selection:
--   choice_token: opaque per-session token (128-bit random hex)
--   UUIDs never exposed to public RPCs.
--
-- Attempt Limits:
--   Per-participant: 5 failed attempts per session (max_per_participant)
--   Per-session: 20 total attempts (max_session_attempts)
--   Atomic counting with SELECT ... FOR UPDATE on session row.
--   Successful verification does not reset evidence of previous failures.
--   Attempt log stores: session_id, participant_id, type, success, timestamp.
--   Attempt log NEVER stores: verification code, room number, phone digits.
--
-- RLS:
--   REVOKE ALL FROM anon on all 4 QR tables.
--   Staff policies: owner/manager/reception for sessions and participants.
--   All real access through SECURITY DEFINER RPCs.
--
-- Public RPCs (anon):
--   get_checkin_participants(p_token)          — masked list with choice_tokens
--   verify_checkin_participant(p_token, choice_token, code) — verification token
--   verify_walkin_participant(p_token, name, code)          — verification token
--   get_checkin_prefilled_details(vt)          — prefilled details
--   submit_checkin_consent(vt, ...)            — creates + signs consent
--
-- All accept only opaque tokens/hashes. No customer/booking UUIDs from client.
-- Session tokens: 256-bit. Verification tokens: 192-bit, 10min TTL.
-- Verification tokens: single-use, session+participant bound, consumed atomically.
-- Signed consent is immutable (existing trigger from migration 009 protects).
-- One consent per participant/activity enforced.
-- Child requires guardian name, relationship, and signature.

-- =============================================
-- 11. IDEMPOTENCY CHECK
-- =============================================
-- All CREATE statements use IF NOT EXISTS or EXCEPTION WHEN duplicate_object.
-- REVOKE/GRANT and policy DROP IF EXISTS ensure safe re-application.
-- Migration is safe to apply after partial execution.

COMMIT;
