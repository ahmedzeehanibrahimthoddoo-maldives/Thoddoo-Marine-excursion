-- =============================================
-- Thoddoo Marine CMS – Access Control Migration 005
-- Staff assignments table + safe RPC functions
-- Idempotent. Safe to re-run.
-- =============================================

-- =============================================
-- 1. STAFF ASSIGNMENTS TABLE
-- =============================================

-- staff_assignments table is created in 002_rls.sql (with all columns).
-- Enable RLS here (idempotent).
ALTER TABLE staff_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sa_owner_manager_all ON staff_assignments;
DROP POLICY IF EXISTS sa_staff_read_own ON staff_assignments;

CREATE POLICY sa_owner_manager_all ON staff_assignments
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));

CREATE POLICY sa_staff_read_own ON staff_assignments
  FOR SELECT
  USING (staff_id = current_staff_id());

-- =============================================
-- 2. CUSTOMER-SAFE RPC FUNCTIONS
-- =============================================

-- 2a. get_customers_list()
-- For owner/manager/reception. Excludes passport, medical, notes.
CREATE OR REPLACE FUNCTION public.get_customers_list()
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
    'id', c.id,
    'full_name', c.full_name,
    'email', c.email,
    'phone', c.phone,
    'nationality', c.nationality,
    'hotel', c.hotel,
    'room_number', c.room_number,
    'emergency_contact_name', c.emergency_contact_name,
    'emergency_contact_phone', c.emergency_contact_phone,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  )
  FROM customers c
  ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 2b. get_customer_detail(p_customer_id uuid)
-- For owner/manager/reception. Returns ALL fields.
CREATE OR REPLACE FUNCTION public.get_customer_detail(p_customer_id uuid)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_row customers%ROWTYPE;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied. Required role: owner, manager, or reception.';
  END IF;

  SELECT * INTO v_row FROM customers WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'email', v_row.email,
    'phone', v_row.phone,
    'nationality', v_row.nationality,
    'passport_number', v_row.passport_number,
    'date_of_birth', v_row.date_of_birth,
    'hotel', v_row.hotel,
    'room_number', v_row.room_number,
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'medical_conditions', v_row.medical_conditions,
    'allergies', v_row.allergies,
    'medications', v_row.medications,
    'notes', v_row.notes,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 2c. get_customers_for_booking(p_booking_id uuid)
-- For watersports staff and boat crew. Returns ONLY minimal fields.
CREATE OR REPLACE FUNCTION public.get_customers_for_booking(p_booking_id uuid)
RETURNS SETOF json AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  v_staff_id := current_staff_id();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required.';
  END IF;

  IF NOT staff_has_booking_access(p_booking_id) THEN
    RAISE EXCEPTION 'Access denied. You do not have access to this booking.';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', c.id,
    'full_name', c.full_name,
    'phone', c.phone,
    'emergency_contact_name', c.emergency_contact_name,
    'emergency_contact_phone', c.emergency_contact_phone,
    'hotel', c.hotel
  )
  FROM bookings b
  JOIN customers c ON c.id = b.customer_id
  WHERE b.id = p_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 3. CONSENT-SAFE RPC FUNCTIONS
-- =============================================

-- 3a. get_consent_forms_list()
-- For owner/manager/reception. Excludes medical, signature, passport, token fields.
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
    'created_at', cf.created_at
  )
  FROM consent_forms cf
  ORDER BY cf.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 3b. get_consent_form_detail(p_id uuid)
-- For owner/manager/reception OR watersports_staff with booking access.
-- Returns all fields EXCEPT signing_token, signing_token_expires_at.
CREATE OR REPLACE FUNCTION public.get_consent_form_detail(p_id uuid)
RETURNS JSON AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
  v_row consent_forms%ROWTYPE;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required.';
  END IF;

  SELECT * INTO v_row FROM consent_forms WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Owner/manager/reception: full access (minus tokens)
  IF v_role IN ('owner', 'manager', 'reception') THEN
    -- allowed
  -- Watersports staff: only if they have booking access
  ELSIF v_role = 'watersports_staff' THEN
    IF v_row.booking_id IS NULL OR NOT staff_has_booking_access(v_row.booking_id) THEN
      RAISE EXCEPTION 'Access denied. You do not have access to this consent form.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied. Required role: owner, manager, reception, or watersports_staff.';
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'booking_id', v_row.booking_id,
    'customer_id', v_row.customer_id,
    'activity_id', v_row.activity_id,
    'activity_name', v_row.activity_name,
    'booking_ref', v_row.booking_ref,
    'guest_name', v_row.guest_name,
    'nationality', v_row.nationality,
    'date_of_birth', v_row.date_of_birth,
    'passport_number', v_row.passport_number,
    'phone', v_row.phone,
    'hotel', v_row.hotel,
    'room_number', v_row.room_number,
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'swimming_ability', v_row.swimming_ability,
    'medical_conditions', v_row.medical_conditions,
    'allergies', v_row.allergies,
    'medications', v_row.medications,
    'recent_injuries', v_row.recent_injuries,
    'is_pregnant', v_row.is_pregnant,
    'safety_briefing_confirmed', v_row.safety_briefing_confirmed,
    'life_jacket_confirmed', v_row.life_jacket_confirmed,
    'risk_acknowledged', v_row.risk_acknowledged,
    'photo_consent', v_row.photo_consent,
    'signature_data_url', v_row.signature_data_url,
    'witness_name', v_row.witness_name,
    'witness_signature_data_url', v_row.witness_signature_data_url,
    'parent_guardian_name', v_row.parent_guardian_name,
    'parent_guardian_signature_data_url', v_row.parent_guardian_signature_data_url,
    'is_minor', v_row.is_minor,
    'status', v_row.status,
    'form_version', v_row.form_version,
    'signed_at', v_row.signed_at,
    'created_at', v_row.created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 4. BOOKING-SAFE RPC FUNCTIONS
-- =============================================

-- 4a. get_bookings_list()
-- For owner/manager/reception. Returns bookings with JOINed activity and customer info.
CREATE OR REPLACE FUNCTION public.get_bookings_list()
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
    'id', b.id,
    'booking_ref', b.booking_ref,
    'customer_id', b.customer_id,
    'activity_id', b.activity_id,
    'source', b.source,
    'status', b.status,
    'guests', b.guests,
    'total_cents', b.total_cents,
    'payment_status', b.payment_status,
    'special_requests', b.special_requests,
    'created_at', b.created_at,
    'updated_at', b.updated_at,
    'activity', json_build_object(
      'name', a.name,
      'slug', a.slug
    ),
    'customer', json_build_object(
      'full_name', c.full_name,
      'phone', c.phone,
      'hotel', c.hotel
    )
  )
  FROM bookings b
  LEFT JOIN activities a ON a.id = b.activity_id
  LEFT JOIN customers c ON c.id = b.customer_id
  ORDER BY b.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 4b. get_bookings_for_ops()
-- For watersports staff and boat crew. Returns minimal booking info.
-- Only returns bookings the staff member has access to.
CREATE OR REPLACE FUNCTION public.get_bookings_for_ops()
RETURNS SETOF json AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL OR v_role NOT IN ('watersports_staff', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied. Required role: watersports_staff or boat_crew.';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', b.id,
    'booking_ref', b.booking_ref,
    'status', b.status,
    'guests', b.guests,
    'source', b.source,
    'created_at', b.created_at,
    'activity', json_build_object(
      'name', a.name,
      'slug', a.slug
    )
  )
  FROM bookings b
  LEFT JOIN activities a ON a.id = b.activity_id
  WHERE staff_has_booking_access(b.id)
  ORDER BY b.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 5. INCIDENT-SAFE RPC FUNCTIONS
-- =============================================

-- 5a. get_incidents_list()
-- For owner/manager only. Returns full incident data.
CREATE OR REPLACE FUNCTION public.get_incidents_list()
RETURNS SETOF json AS $$
DECLARE
  v_role staff_role;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Access denied. Required role: owner or manager.';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', ir.id,
    'activity_name', a.name,
    'customer_name', c.full_name,
    'incident_date', ir.incident_date,
    'severity', ir.severity,
    'description', ir.description,
    'actions_taken', ir.actions_taken,
    'resolved', ir.resolved,
    'resolved_at', ir.resolved_at,
    'created_at', ir.created_at
  )
  FROM incident_reports ir
  LEFT JOIN activities a ON a.id = ir.activity_id
  LEFT JOIN customers c ON c.id = ir.customer_id
  ORDER BY ir.incident_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- 5b. get_incidents_for_ops()
-- For watersports staff, reception, boat crew.
-- Watersports staff and boat crew only see incidents for activities they have assignments for.
CREATE OR REPLACE FUNCTION public.get_incidents_for_ops()
RETURNS SETOF json AS $$
DECLARE
  v_role staff_role;
  v_staff_id UUID;
BEGIN
  v_role := current_staff_role();
  v_staff_id := current_staff_id();

  IF v_role IS NULL OR v_role NOT IN ('watersports_staff', 'reception', 'boat_crew') THEN
    RAISE EXCEPTION 'Access denied. Required role: watersports_staff, reception, or boat_crew.';
  END IF;

  -- Reception: can see all incidents
  IF v_role = 'reception' THEN
    RETURN QUERY
    SELECT json_build_object(
      'id', ir.id,
      'activity_name', a.name,
      'customer_name', c.full_name,
      'incident_date', ir.incident_date,
      'severity', ir.severity,
      'description', ir.description,
      'resolved', ir.resolved
    )
    FROM incident_reports ir
    LEFT JOIN activities a ON a.id = ir.activity_id
    LEFT JOIN customers c ON c.id = ir.customer_id
    ORDER BY ir.incident_date DESC;

  -- Watersports staff / boat crew: only incidents for assigned activities
  ELSE
    RETURN QUERY
    SELECT json_build_object(
      'id', ir.id,
      'activity_name', a.name,
      'customer_name', c.full_name,
      'incident_date', ir.incident_date,
      'severity', ir.severity,
      'description', ir.description,
      'resolved', ir.resolved
    )
    FROM incident_reports ir
    LEFT JOIN activities a ON a.id = ir.activity_id
    LEFT JOIN customers c ON c.id = ir.customer_id
    WHERE EXISTS (
      SELECT 1 FROM staff_assignments sa
      WHERE sa.staff_id = v_staff_id
        AND sa.active = true
        AND sa.activity_id = ir.activity_id
    )
    ORDER BY ir.incident_date DESC;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 6. PAYMENT-SAFE RPC FUNCTIONS
-- =============================================

-- 6a. get_payments_list()
-- For owner/manager/reception.
CREATE OR REPLACE FUNCTION public.get_payments_list()
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
    'id', p.id,
    'booking_ref', b.booking_ref,
    'customer_name', c.full_name,
    'amount_cents', p.amount_cents,
    'method', p.method,
    'reference', p.reference,
    'created_at', p.created_at
  )
  FROM payments p
  LEFT JOIN bookings b ON b.id = p.booking_id
  LEFT JOIN customers c ON c.id = b.customer_id
  ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 7. AUDIT-SAFE RPC FUNCTIONS
-- =============================================

-- 7a. get_audit_log(p_limit int DEFAULT 50)
-- For owner/manager. Excludes old_data, new_data.
CREATE OR REPLACE FUNCTION public.get_audit_log(p_limit int DEFAULT 50)
RETURNS SETOF json AS $$
DECLARE
  v_role staff_role;
BEGIN
  v_role := current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Access denied. Required role: owner or manager.';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', al.id,
    'actor_name', al.actor_name,
    'action', al.action,
    'table_name', al.table_name,
    'record_id', al.record_id,
    'created_at', al.created_at
  )
  FROM audit_log al
  ORDER BY al.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =============================================
-- 8. REVOKE & GRANT PERMISSIONS
-- =============================================

-- Revoke from PUBLIC (prevents direct table access bypassing RPCs)
REVOKE ALL ON staff_assignments FROM PUBLIC;

-- Customer-safe RPCs
REVOKE ALL ON FUNCTION public.get_customers_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customers_for_booking(uuid) FROM PUBLIC;

-- Consent-safe RPCs
REVOKE ALL ON FUNCTION public.get_consent_forms_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_form_detail(uuid) FROM PUBLIC;

-- Booking-safe RPCs
REVOKE ALL ON FUNCTION public.get_bookings_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_bookings_for_ops() FROM PUBLIC;

-- Incident-safe RPCs
REVOKE ALL ON FUNCTION public.get_incidents_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_incidents_for_ops() FROM PUBLIC;

-- Payment-safe RPCs
REVOKE ALL ON FUNCTION public.get_payments_list() FROM PUBLIC;

-- Audit-safe RPCs
REVOKE ALL ON FUNCTION public.get_audit_log(int) FROM PUBLIC;

-- Grant EXECUTE to authenticated role only
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_assignments TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_customers_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customers_for_booking(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_consent_forms_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consent_form_detail(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_bookings_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bookings_for_ops() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_incidents_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_incidents_for_ops() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_payments_list() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_audit_log(int) TO authenticated;
