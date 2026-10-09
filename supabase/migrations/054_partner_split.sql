-- ================================================================
-- 054 — Partner split (e.g. Resort Trip to Ellaidhoo)
-- ================================================================
-- Each Resort Trip guest is charged USD 150 (resort fee + transfer).
-- Of that, USD 95/person is payable to the resort, and the remaining
-- USD 55/person is Thoddoo Marine's net. This is the "Partner /
-- Commission / Net" model used by Reports and the Partner Statement PDF.
--
-- The split lives on the ACTIVITY (per guest):
--   activities.partner            = resort/partner name
--   activities.commission_cents   = per-guest amount due to the partner
--   activities.net_cents          = per-guest amount Thoddoo Marine keeps
--
-- A BEFORE INSERT trigger on bookings auto-fills bookings.partner,
-- bookings.commission_cents and bookings.net_cents from the activity
-- (guests × per-guest value), so EVERY booking path (website RPC,
-- walk-in QR, admin form) records the split without manual entry.
-- Manually-provided partner/commission/net on insert are respected.
-- ================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS partner TEXT;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS commission_cents INT NOT NULL DEFAULT 0 CHECK (commission_cents >= 0);

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS net_cents INT NOT NULL DEFAULT 0 CHECK (net_cents >= 0);

-- Configure the Resort Trip to Ellaidhoo split: $95 to resort, $55 to us.
UPDATE public.activities
SET partner = 'Cinnamon Ellaidhoo Resort',
    commission_cents = 9500,
    net_cents = 5500
WHERE slug = 'resort-trip-ellaidhoo';

-- ================================================================
-- Auto-fill bookings.commission/net/partner from the activity
-- ================================================================
CREATE OR REPLACE FUNCTION public.auto_partner_split_bookings()
RETURNS TRIGGER AS $$
DECLARE
  v_pax     INTEGER;
  v_comm    INTEGER;
  v_net     INTEGER;
  v_partner TEXT;
BEGIN
  IF NEW.activity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.commission_cents, a.net_cents, a.partner
    INTO v_comm, v_net, v_partner
    FROM public.activities a
   WHERE a.id = NEW.activity_id;

  IF v_comm IS NULL OR v_net IS NULL THEN
    RETURN NEW;
  END IF;

  -- Partner name (only when not explicitly provided).
  IF NEW.partner IS NULL AND v_partner IS NOT NULL THEN
    NEW.partner := v_partner;
  END IF;

  -- Split amounts (only when a split is configured).
  IF v_comm > 0 OR v_net > 0 THEN
    v_pax := GREATEST(COALESCE(NEW.guests, 0), 0);
    IF v_pax = 0 THEN
      v_pax := GREATEST(COALESCE(NEW.adults, 0), 0)
             + GREATEST(COALESCE(NEW.children_count, 0), 0);
    END IF;

    IF v_pax > 0 THEN
      IF NEW.commission_cents IS NULL OR NEW.commission_cents = 0 THEN
        NEW.commission_cents := v_comm * v_pax;
      END IF;
      IF NEW.net_cents IS NULL OR NEW.net_cents = 0 THEN
        NEW.net_cents := v_net * v_pax;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

DROP TRIGGER IF EXISTS trg_bookings_auto_partner_split ON public.bookings;
CREATE TRIGGER trg_bookings_auto_partner_split
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.auto_partner_split_bookings();