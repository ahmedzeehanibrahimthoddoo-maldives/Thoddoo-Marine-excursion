-- =============================================
-- 028: FIX get_tomorrow_bookings ORDER BY bug
-- =============================================
-- json_agg() with an ORDER BY applied to the
-- aggregated subquery caused "column must appear
-- in GROUP BY". Wrap the ordered rows in a subquery
-- and aggregate over it.
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_tomorrow_bookings()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role      staff_role;
  v_staff_id  UUID;
  v_tomorrow  DATE;
  v_result    JSON;
BEGIN
  v_staff_id := public.current_staff_id();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: staff profile not found.';
  END IF;

  v_role := public.current_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'reception') THEN
    RAISE EXCEPTION 'Access denied: required role is owner, manager, or reception.';
  END IF;

  v_tomorrow := (now() AT TIME ZONE 'Indian/Maldives')::DATE + INTERVAL '1 day';

  SELECT json_build_object(
    'date', v_tomorrow::TEXT,
    'bookings', COALESCE(
      (
        SELECT json_agg(row_data)
        FROM (
          SELECT json_build_object(
            'booking_ref',           b.booking_ref,
            'status',                b.status::TEXT,
            'activity_name',         a.name,
            'guest_name',            c.full_name,
            'guest_phone',           c.phone,
            'adults',                b.adults,
            'children',              b.children_count,
            'guests',                b.guests,
            'booking_date',          b.booking_date::TEXT,
            'preferred_time',        b.preferred_time,
            'hotel_name',            b.hotel_name,
            'room_number',           b.room_number,
            'pickup_location',       b.pickup_location,
            'pricing_option',        b.pricing_option_label,
            'estimated_total_cents', b.estimated_total_cents,
            'total_cents',           b.total_cents,
            'payment_status',        b.payment_status::TEXT,
            'special_requests',      b.special_requests,
            'source',                b.source::TEXT,
            'created_at',            b.created_at::TEXT,
            'booking_currency',      b.booking_currency,
            'exchange_rate',         b.exchange_rate_mvr_per_usd,
            'converted_usd_cents',   b.converted_usd_cents,
            'converted_mvr_laari',   b.converted_mvr_laari
          ) AS row_data
          FROM public.bookings b
          JOIN public.activities a ON a.id = b.activity_id
          JOIN public.customers c ON c.id = b.customer_id
          WHERE b.booking_date = v_tomorrow
            AND b.status != 'cancelled'
          ORDER BY b.preferred_time NULLS LAST, b.created_at
        ) ordered
      ),
      '[]'::JSON
    ),
    'summary', (
      SELECT json_build_object(
        'total',              COUNT(*),
        'confirmed',          COUNT(*) FILTER (WHERE status = 'confirmed'),
        'pending',            COUNT(*) FILTER (WHERE status = 'pending'),
        'total_adults',       COALESCE(SUM(adults), 0),
        'total_children',     COALESCE(SUM(children_count), 0),
        'total_guests',       COALESCE(SUM(guests), 0),
        'total_usd_cents',    COALESCE(SUM(converted_usd_cents), 0),
        'total_mvr_laari',    COALESCE(SUM(converted_mvr_laari), 0),
        'by_currency', (
          SELECT COALESCE(json_object_agg(bc, json_build_object(
            'count', bc_summary.cnt,
            'total_minor', bc_summary.total_minor
          )), '{}'::JSON)
          FROM (
            SELECT booking_currency AS bc,
                   COUNT(*) AS cnt,
                   SUM(estimated_total_cents) AS total_minor
            FROM public.bookings
            WHERE booking_date = v_tomorrow
              AND status != 'cancelled'
            GROUP BY booking_currency
          ) bc_summary
        )
      )
      FROM public.bookings
      WHERE booking_date = v_tomorrow
        AND status != 'cancelled'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMIT;