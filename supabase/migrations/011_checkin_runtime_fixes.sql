-- =============================================
-- Thoddoo Marine – Check-in Runtime Fixes 011
--
-- Fixes verify_checkin_participant room check:
--   - Verify room against bookings.room_number
--     (not customers.room_number)
--   - Verify phone against participant phone_last4
--     and customer phone last-4
--   - Normalize inputs: trim, case-insensitive room,
--     strip non-digits for phone
--   - Reject empty verification input
--   - Preserve all rate-limiting, hashing, permissions
-- Idempotent. Safe to re-run.
-- =============================================

-- 1. Replace verify_checkin_participant
-- Canonical signature: (p_token TEXT, p_choice_token TEXT, p_verification_code TEXT)
-- Returns: JSON with error/success
-- Permissions: REVOKE ALL FROM PUBLIC, REVOKE ALL FROM authenticated, GRANT anon

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
  v_booking bookings%ROWTYPE;
  v_verification TEXT;
  v_verification_digits TEXT;
  v_matched BOOLEAN := false;
  v_raw_vt TEXT;
  v_vt_hash TEXT;
  v_participant_failures INT;
  v_booking_room TEXT;
  v_customer_phone_last4 TEXT;
BEGIN
  -- Validate token input
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

  -- Validate verification input is non-empty after trim
  v_verification := trim(p_verification_code);
  IF v_verification IS NULL OR v_verification = '' THEN
    RETURN json_build_object('error', 'verification_failed', 'message', 'Could not verify your details. Please check and try again.');
  END IF;

  -- Normalise: strip non-digits for phone comparison
  v_verification_digits := regexp_replace(v_verification, '[^0-9]', '', 'g');

  -- Record attempt (success determined after verification)
  INSERT INTO consent_checkin_attempts (session_id, participant_id, attempt_type, success)
  VALUES (v_session.id, v_participant.id, 'verify', false);

  -- ============================================================
  -- FACT 1: Room number from the session's trusted booking record
  --         (NOT from customers — public bookings store room on
  --         bookings.room_number, not the customer profile)
  -- ============================================================
  IF v_session.booking_id IS NOT NULL THEN
    SELECT room_number INTO v_booking_room
    FROM bookings
    WHERE id = v_session.booking_id;

    IF v_booking_room IS NOT NULL AND v_booking_room <> '' THEN
      IF lower(trim(v_booking_room)) = lower(v_verification) THEN
        v_matched := true;
      END IF;
    END IF;
  END IF;

  -- ============================================================
  -- FACT 2: Phone — participant.phone_last4
  --         (source of truth for guest-provided phone on the
  --         booking; set by create_checkin_session from customer)
  -- ============================================================
  IF NOT v_matched AND v_participant.phone_last4 IS NOT NULL THEN
    IF right(regexp_replace(v_participant.phone_last4, '[^0-9]', '', 'g'), 4)
       = right(v_verification_digits, 4) THEN
      v_matched := true;
    END IF;
  END IF;

  -- ============================================================
  -- FACT 3: Phone — customer profile phone last 4 digits
  --         (fallback when participant.phone_last4 is absent,
  --         e.g. guests 2+ who have no customer_id)
  -- ============================================================
  IF NOT v_matched AND v_participant.customer_id IS NOT NULL THEN
    SELECT phone INTO v_customer_phone_last4
    FROM customers
    WHERE id = v_participant.customer_id;

    IF v_customer_phone_last4 IS NOT NULL THEN
      IF right(regexp_replace(v_customer_phone_last4, '[^0-9]', '', 'g'), 4)
         = right(v_verification_digits, 4) THEN
        v_matched := true;
      END IF;
    END IF;
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
