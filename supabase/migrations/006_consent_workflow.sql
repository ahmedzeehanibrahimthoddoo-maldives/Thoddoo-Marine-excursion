-- Migration 006: Consent workflow + audit
-- Idempotent. Safe to run once after 001–005.
-- Reuses the canonical signing_token / signing_token_expires_at columns.
-- Does NOT add parallel token columns.

BEGIN;

-- ============================================================
-- 1. SCHEMA CHANGES
-- ============================================================

-- 1a. consent_type column (activity, rental, medical, photo)
-- Distinguishes the logical purpose of a consent form.
ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS consent_type TEXT NOT NULL DEFAULT 'activity';

-- 1b. Void audit columns
ALTER TABLE consent_forms
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES staff_profiles(id);

-- ============================================================
-- 2. DUPLICATE CONSENT PREVENTION
-- ============================================================

-- Prevents multiple pending/signed consents for the same
-- customer + booking + activity + consent_type combination.
-- COALESCE turns NULL booking_id into a sentinel UUID so that
-- walk-in consents (no booking) are correctly de-duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_forms_active_unique
  ON consent_forms (
    customer_id,
    COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'),
    activity_id,
    consent_type
  )
  WHERE status IN ('pending', 'signed');

-- ============================================================
-- 3. CANCELLED BOOKING GUARD
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_consent_for_cancelled_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE id = NEW.booking_id AND status = 'cancelled'
    ) THEN
      RAISE EXCEPTION 'Cannot create consent form for a cancelled booking';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_consent_cancelled_booking ON consent_forms;
CREATE TRIGGER trg_prevent_consent_cancelled_booking
  BEFORE INSERT ON consent_forms
  FOR EACH ROW
  EXECUTE FUNCTION prevent_consent_for_cancelled_booking();

-- ============================================================
-- 4. RPC: void_consent_form (staff-only)
-- ============================================================
-- Only owner/manager/reception.
-- Only pending consents may be voided.
-- Signed consents must not be silently voided.
-- Records void_reason, voided_at, voided_by.
-- Creates audit entry WITHOUT signature, token, passport, or medical data.

CREATE OR REPLACE FUNCTION public.void_consent_form(
  p_consent_id UUID,
  p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
  v_row consent_forms%ROWTYPE;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Staff authentication required.');
  END IF;

  IF v_role NOT IN ('owner', 'manager', 'reception') THEN
    RETURN json_build_object('error', 'forbidden', 'message', 'Only owners, managers, and reception staff can void consent forms.');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN json_build_object('error', 'validation', 'message', 'A void reason is required.');
  END IF;

  SELECT * INTO v_row FROM consent_forms WHERE id = p_consent_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Consent form not found.');
  END IF;

  IF v_row.status != 'pending' THEN
    RETURN json_build_object(
      'error', 'invalid_state',
      'message', 'Only pending consent forms can be voided. Signed forms must go through a formal revocation process.'
    );
  END IF;

  UPDATE consent_forms SET
    status = 'voided',
    void_reason = trim(p_reason),
    voided_at = now(),
    voided_by = v_staff_id
  WHERE id = p_consent_id;

  INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details)
  VALUES (
    v_staff_id,
    'void',
    'consent_form',
    p_consent_id,
    json_build_object('void_reason', trim(p_reason))::text
  );

  RETURN json_build_object('success', true, 'message', 'Consent form voided.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.void_consent_form(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_consent_form(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_consent_form(UUID, TEXT) TO authenticated;

-- ============================================================
-- 5. UPDATE get_consent_forms_list to include expiry info
-- ============================================================
-- Adds signing_token (for admin link generation) and
-- signing_token_expires_at (for expiry status display).
-- Only callable by authenticated owner/manager/reception.

CREATE OR REPLACE FUNCTION public.get_consent_forms_list()
RETURNS SETOF json AS $$
DECLARE
  v_role staff_role;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied. Required role: owner, manager, or reception.';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', cf.id,
    'activity_name', cf.activity_name,
    'booking_ref', cf.booking_ref,
    'guest_name', cf.guest_name,
    'status', cf.status,
    'signed_at', cf.signed_at,
    'created_at', cf.created_at,
    'signing_token', cf.signing_token,
    'signing_token_expires_at', cf.signing_token_expires_at,
    'void_reason', cf.void_reason,
    'voided_at', cf.voided_at
  )
  FROM consent_forms cf
  ORDER BY cf.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
