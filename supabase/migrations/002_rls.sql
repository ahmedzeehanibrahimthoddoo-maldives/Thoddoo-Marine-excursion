-- =============================================
-- Thoddoo Marine CMS – RLS Policies Migration 002
-- Row Level Security for all tables
-- =============================================

-- =============================================
-- 0. STAFF ASSIGNMENTS TABLE (if not exists)
-- =============================================
-- Links staff members to activities for assignment-based access control.
-- Watersports staff and boat crew can only see bookings/incidents
-- whose activity_id matches one of their active assignments.

CREATE TABLE IF NOT EXISTS staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  assigned_date DATE,
  role_on_trip TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_assignments_staff ON staff_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_booking ON staff_assignments(booking_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_activity ON staff_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_staff_assignments_date ON staff_assignments(assigned_date);

-- =============================================
-- 1. HELPER FUNCTIONS
-- =============================================

CREATE OR REPLACE FUNCTION public.user_has_role(required_roles staff_role[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE user_id = auth.uid()
      AND active = true
      AND role = ANY(required_roles)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS UUID AS $$
  SELECT id FROM staff_profiles WHERE user_id = auth.uid() AND active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS staff_role AS $$
  SELECT role FROM staff_profiles WHERE user_id = auth.uid() AND active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- Assignment enforcement: checks if current staff member has access to a booking via:
--   1. They created the booking (bookings.created_by = current_staff_id())
--   2. OR they have an active staff_assignment for the booking's activity
CREATE OR REPLACE FUNCTION public.staff_has_booking_access(p_booking_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = p_booking_id
      AND (
        b.created_by = current_staff_id()
        OR EXISTS (
          SELECT 1 FROM staff_assignments sa
          WHERE sa.staff_id = current_staff_id()
            AND sa.activity_id = b.activity_id
            AND sa.active = true
        )
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- Helper: check if current staff has an active assignment for a given activity
CREATE OR REPLACE FUNCTION public.staff_has_activity(p_activity_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_assignments
    WHERE staff_id = current_staff_id()
      AND activity_id = p_activity_id
      AND active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- =============================================
-- 2. STAFF PROFILES
-- =============================================
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_owner_all ON staff_profiles;
DROP POLICY IF EXISTS staff_owner_insert ON staff_profiles;
DROP POLICY IF EXISTS staff_owner_update ON staff_profiles;
DROP POLICY IF EXISTS staff_active_read ON staff_profiles;
DROP POLICY IF EXISTS staff_self_read ON staff_profiles;

-- Owner: full access
CREATE POLICY staff_owner_all ON staff_profiles
  FOR ALL
  USING (user_has_role(ARRAY['owner']::staff_role[]));

-- Owner only: insert staff profiles (prevents manager from creating accounts)
CREATE POLICY staff_owner_insert ON staff_profiles
  FOR INSERT
  WITH CHECK (user_has_role(ARRAY['owner']::staff_role[]));

-- Owner only: update staff (prevents manager self-escalation)
CREATE POLICY staff_owner_update ON staff_profiles
  FOR UPDATE
  USING (user_has_role(ARRAY['owner']::staff_role[]));

-- All active staff: read all profiles (needed for UI dropdowns)
CREATE POLICY staff_active_read ON staff_profiles
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- Staff: read own profile (fallback for edge cases)
CREATE POLICY staff_self_read ON staff_profiles
  FOR SELECT
  USING (user_id = auth.uid());

-- =============================================
-- 3. ACTIVITIES
-- =============================================
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activities_owner_manager_all ON activities;
DROP POLICY IF EXISTS activities_staff_read ON activities;
DROP POLICY IF EXISTS activities_public_read ON activities;

-- Owner/manager: full access
CREATE POLICY activities_owner_manager_all ON activities
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));

-- All active staff: read
CREATE POLICY activities_staff_read ON activities
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- Public (anon): SELECT active activities (website)
CREATE POLICY activities_public_read ON activities
  FOR SELECT
  USING (active = true);

-- =============================================
-- 4. ACTIVITY PRICING
-- =============================================
ALTER TABLE activity_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_owner_manager_all ON activity_pricing;
DROP POLICY IF EXISTS pricing_staff_read ON activity_pricing;
DROP POLICY IF EXISTS pricing_public_read ON activity_pricing;

-- Owner/manager: full access
CREATE POLICY pricing_owner_manager_all ON activity_pricing
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));

-- All active staff: read
CREATE POLICY pricing_staff_read ON activity_pricing
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- Public (anon): read all pricing (pricing is public)
CREATE POLICY pricing_public_read ON activity_pricing
  FOR SELECT
  USING (true);

-- =============================================
-- 5. ACTIVITY SCHEDULES
-- =============================================
ALTER TABLE activity_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedules_owner_manager_ws_all ON activity_schedules;
DROP POLICY IF EXISTS schedules_staff_read ON activity_schedules;
DROP POLICY IF EXISTS schedules_public_read ON activity_schedules;

-- Owner/manager/watersports_staff: full access
CREATE POLICY schedules_owner_manager_ws_all ON activity_schedules
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'watersports_staff']::staff_role[]));

-- All active staff: read
CREATE POLICY schedules_staff_read ON activity_schedules
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- Public (anon): read schedules for today and future
CREATE POLICY schedules_public_read ON activity_schedules
  FOR SELECT
  USING (scheduled_date >= CURRENT_DATE);

-- =============================================
-- 6. CUSTOMERS
-- =============================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_owner_mgr_reception_all ON customers;

-- Owner/manager/reception: full access
CREATE POLICY customers_owner_mgr_reception_all ON customers
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]));

-- Watersports staff: NO direct access (use RPCs only)
-- Boat crew: NO direct access (use RPCs only)

-- =============================================
-- 7. BOOKINGS
-- =============================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_owner_mgr_reception_all ON bookings;
DROP POLICY IF EXISTS bookings_watersports_staff_access ON bookings;
DROP POLICY IF EXISTS bookings_boat_crew_access ON bookings;

-- Owner/manager/reception: full access
CREATE POLICY bookings_owner_mgr_reception_all ON bookings
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]));

-- Watersports staff: SELECT only bookings they have assignment access to
CREATE POLICY bookings_watersports_staff_access ON bookings
  FOR SELECT
  USING (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND staff_has_booking_access(id)
  );

-- Boat crew: SELECT only bookings they have assignment access to
CREATE POLICY bookings_boat_crew_access ON bookings
  FOR SELECT
  USING (
    user_has_role(ARRAY['boat_crew']::staff_role[])
    AND staff_has_booking_access(id)
  );

-- =============================================
-- 8. EQUIPMENT
-- =============================================
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_owner_manager_ws_all ON equipment;
DROP POLICY IF EXISTS equipment_staff_read ON equipment;

-- Owner/manager/watersports_staff: full access
CREATE POLICY equipment_owner_manager_ws_all ON equipment
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'watersports_staff']::staff_role[]));

-- All active staff: read
CREATE POLICY equipment_staff_read ON equipment
  FOR SELECT
  USING (
    user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff', 'boat_crew']::staff_role[])
  );

-- =============================================
-- 9. EQUIPMENT RENTALS
-- =============================================
ALTER TABLE equipment_rentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rentals_owner_mgr_reception_ws_all ON equipment_rentals;
DROP POLICY IF EXISTS rentals_boat_crew_access ON equipment_rentals;

-- NO public token policies (guest access via RPCs only in 004_rpcs.sql)

-- Owner/manager/reception/watersports_staff: full access
CREATE POLICY rentals_owner_mgr_reception_ws_all ON equipment_rentals
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception', 'watersports_staff']::staff_role[]));

-- Boat crew: SELECT only rentals for bookings they have assignment access to
CREATE POLICY rentals_boat_crew_access ON equipment_rentals
  FOR SELECT
  USING (
    user_has_role(ARRAY['boat_crew']::staff_role[])
    AND staff_has_booking_access(booking_id)
  );

-- =============================================
-- 10. CONSENT FORMS
-- =============================================
ALTER TABLE consent_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_owner_mgr_reception_all ON consent_forms;
DROP POLICY IF EXISTS consent_watersports_staff_read ON consent_forms;
DROP POLICY IF EXISTS consent_watersports_staff_update ON consent_forms;

-- NO public token policies (guest access via RPCs only in 004_rpcs.sql)
-- Boat crew: NO access to consent_forms

-- Owner/manager/reception: full access
CREATE POLICY consent_owner_mgr_reception_all ON consent_forms
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]));

-- Watersports staff: SELECT only consent forms for bookings they have assignment access to
CREATE POLICY consent_watersports_staff_read ON consent_forms
  FOR SELECT
  USING (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND staff_has_booking_access(booking_id)
  );

-- Watersports staff: UPDATE only consent forms for bookings they have assignment access to
CREATE POLICY consent_watersports_staff_update ON consent_forms
  FOR UPDATE
  USING (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND staff_has_booking_access(booking_id)
  );

-- =============================================
-- 11. INCIDENT REPORTS
-- =============================================
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incidents_owner_manager_all ON incident_reports;
DROP POLICY IF EXISTS incidents_watersports_staff_read ON incident_reports;
DROP POLICY IF EXISTS incidents_watersports_staff_insert ON incident_reports;
DROP POLICY IF EXISTS incidents_watersports_staff_update ON incident_reports;
DROP POLICY IF EXISTS incidents_boat_crew_read ON incident_reports;
DROP POLICY IF EXISTS incidents_reception_read ON incident_reports;

-- Owner/manager: full access
CREATE POLICY incidents_owner_manager_all ON incident_reports
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));

-- Watersports staff: SELECT incidents where activity matches their assignments or they reported it
CREATE POLICY incidents_watersports_staff_read ON incident_reports
  FOR SELECT
  USING (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND (
      staff_has_activity(activity_id)
      OR reported_by = (SELECT full_name FROM staff_profiles WHERE id = current_staff_id())
    )
  );

-- Watersports staff: INSERT incidents for activities they are assigned to
CREATE POLICY incidents_watersports_staff_insert ON incident_reports
  FOR INSERT
  WITH CHECK (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND (
      staff_has_activity(activity_id)
      OR reported_by = (SELECT full_name FROM staff_profiles WHERE id = current_staff_id())
    )
  );

-- Watersports staff: UPDATE incidents where activity matches their assignments or they reported it
CREATE POLICY incidents_watersports_staff_update ON incident_reports
  FOR UPDATE
  USING (
    user_has_role(ARRAY['watersports_staff']::staff_role[])
    AND (
      staff_has_activity(activity_id)
      OR reported_by = (SELECT full_name FROM staff_profiles WHERE id = current_staff_id())
    )
  );

-- Boat crew: SELECT incidents where activity matches their assignments
CREATE POLICY incidents_boat_crew_read ON incident_reports
  FOR SELECT
  USING (
    user_has_role(ARRAY['boat_crew']::staff_role[])
    AND staff_has_activity(activity_id)
  );

-- Reception: SELECT only
CREATE POLICY incidents_reception_read ON incident_reports
  FOR SELECT
  USING (user_has_role(ARRAY['reception']::staff_role[]));

-- =============================================
-- 12. PAYMENTS
-- =============================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_owner_mgr_reception_all ON payments;

-- Owner/manager/reception: full access
CREATE POLICY payments_owner_mgr_reception_all ON payments
  FOR ALL
  USING (user_has_role(ARRAY['owner', 'manager', 'reception']::staff_role[]));

-- Watersports staff: NO access
-- Boat crew: NO access

-- =============================================
-- 13. AUDIT LOG
-- =============================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_owner_manager_read ON audit_log;

-- Owner/manager: SELECT only
CREATE POLICY audit_owner_manager_read ON audit_log
  FOR SELECT
  USING (user_has_role(ARRAY['owner', 'manager']::staff_role[]));

-- All others: NO access
-- System inserts via SECURITY DEFINER functions bypass RLS
