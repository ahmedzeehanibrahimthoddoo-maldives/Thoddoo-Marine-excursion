-- 030_watersports_staff_all_bookings.sql
-- Watersports staff (the main ops account) must see ALL bookings on the admin
-- list, not only assigned trips. They already have INSERT/UPDATE on bookings,
-- customers, and payments, so the SELECT restriction was inconsistent.
-- Boat crew access stays limited to assigned trips.

begin;

DROP POLICY IF EXISTS bookings_watersports_staff_access ON public.bookings;
CREATE POLICY bookings_watersports_staff_access ON public.bookings
  FOR SELECT
  USING (user_has_role(ARRAY['watersports_staff']::staff_role[]));

commit;