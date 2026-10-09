-- =============================================
-- 025: TRUNCATE DEMO DATA FOR LIVE TRIAL
-- =============================================
-- Deletes all transactional data so the team
-- starts the 1-week trial with a clean slate.
-- Preserved: staff profiles, activities + pricing,
--   boats, crew, equipment, consent templates,
--   gallery items, explore items, site content,
--   incident reports.
-- =============================================

BEGIN;

-- Parent tables first (FK order matters)
TRUNCATE TABLE trip_manifest CASCADE;
TRUNCATE TABLE booking_participants CASCADE;
TRUNCATE TABLE consent_forms CASCADE;
TRUNCATE TABLE payments CASCADE;
TRUNCATE TABLE audit_log CASCADE;
TRUNCATE TABLE bookings CASCADE;
TRUNCATE TABLE customers CASCADE;
TRUNCATE TABLE trips CASCADE;

-- Checkin / consent flow
TRUNCATE TABLE consent_checkin_verification_tokens CASCADE;
TRUNCATE TABLE consent_checkin_attempts CASCADE;
TRUNCATE TABLE consent_checkin_sessions CASCADE;

-- Staff assignments (junction table)
TRUNCATE TABLE staff_assignments CASCADE;

COMMIT;