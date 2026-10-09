-- =============================================
-- Thoddoo Marine CMS – Schema Migration 001
-- Idempotent. Safe to re-run on empty database.
-- =============================================

-- ENUMS (idempotent)
DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('owner', 'manager', 'reception', 'watersports_staff', 'boat_crew');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_source AS ENUM ('online', 'whatsapp', 'walk_in');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('unpaid', 'partial', 'paid', 'refunded');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE equipment_condition AS ENUM ('excellent', 'good', 'fair', 'poor', 'damaged');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rental_status AS ENUM ('checked_out', 'returned', 'overdue');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE incident_severity AS ENUM ('minor', 'moderate', 'major', 'critical');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE consent_form_status AS ENUM ('pending', 'signed', 'voided');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 1. STAFF PROFILES
-- =============================================
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role staff_role NOT NULL DEFAULT 'reception',
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_role ON staff_profiles(role);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_active ON staff_profiles(active);

-- =============================================
-- 2. ACTIVITIES
-- =============================================
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  location TEXT,
  duration_minutes INT,
  max_guests INT,
  base_price_cents INT NOT NULL DEFAULT 0,
  price_note TEXT,
  image TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  gopro BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_slug ON activities(slug);
CREATE INDEX IF NOT EXISTS idx_activities_category ON activities(category);
CREATE INDEX IF NOT EXISTS idx_activities_active ON activities(active);

-- =============================================
-- 2b. ACTIVITY PRICING OPTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS activity_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price_cents INT NOT NULL,
  note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_pricing_activity ON activity_pricing(activity_id);

-- =============================================
-- 2c. ACTIVITY SCHEDULES
-- =============================================
CREATE TABLE IF NOT EXISTS activity_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  available_spots INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES staff_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_schedules_date ON activity_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_activity_schedules_activity ON activity_schedules(activity_id);

-- =============================================
-- 3. CUSTOMERS
-- =============================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  nationality TEXT,
  passport_number TEXT,
  date_of_birth DATE,
  hotel TEXT,
  room_number TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  medical_conditions TEXT,
  allergies TEXT,
  medications TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(full_name);
CREATE INDEX IF NOT EXISTS idx_customers_hotel ON customers(hotel);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- =============================================
-- 4. BOOKINGS
-- =============================================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  activity_id UUID NOT NULL REFERENCES activities(id),
  schedule_id UUID REFERENCES activity_schedules(id),
  source booking_source NOT NULL DEFAULT 'walk_in',
  status booking_status NOT NULL DEFAULT 'pending',
  guests INT NOT NULL DEFAULT 1 CHECK (guests > 0),
  total_cents INT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  special_requests TEXT,
  created_by UUID REFERENCES staff_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_activity ON bookings(activity_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(created_at);

-- =============================================
-- 5. EQUIPMENT
-- =============================================
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  asset_number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  condition_status equipment_condition NOT NULL DEFAULT 'good',
  daily_rate_cents INT NOT NULL DEFAULT 0 CHECK (daily_rate_cents >= 0),
  deposit_cents INT NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  photo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_asset ON equipment(asset_number);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_active ON equipment(active);

-- =============================================
-- 6. EQUIPMENT RENTALS
-- =============================================
CREATE TABLE IF NOT EXISTS equipment_rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  booking_id UUID REFERENCES bookings(id),
  checkout_condition equipment_condition NOT NULL DEFAULT 'good',
  checkout_photo_url TEXT,
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  return_condition equipment_condition,
  return_photo_url TEXT,
  rental_charge_cents INT NOT NULL DEFAULT 0 CHECK (rental_charge_cents >= 0),
  deposit_cents INT NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  additional_charges_cents INT NOT NULL DEFAULT 0 CHECK (additional_charges_cents >= 0),
  damage_notes TEXT,
  status rental_status NOT NULL DEFAULT 'checked_out',
  checked_out_by UUID REFERENCES staff_profiles(id),
  returned_to UUID REFERENCES staff_profiles(id),
  signing_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rentals_equipment ON equipment_rentals(equipment_id);
CREATE INDEX IF NOT EXISTS idx_rentals_customer ON equipment_rentals(customer_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON equipment_rentals(status);

-- =============================================
-- 7. CONSENT FORMS
-- =============================================
CREATE TABLE IF NOT EXISTS consent_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  activity_id UUID NOT NULL REFERENCES activities(id),
  activity_name TEXT NOT NULL,
  booking_ref TEXT,
  guest_name TEXT NOT NULL,
  nationality TEXT,
  date_of_birth DATE,
  passport_number TEXT,
  phone TEXT,
  hotel TEXT,
  room_number TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  swimming_ability TEXT,
  medical_conditions TEXT,
  allergies TEXT,
  medications TEXT,
  recent_injuries TEXT,
  is_pregnant BOOLEAN NOT NULL DEFAULT false,
  safety_briefing_confirmed BOOLEAN NOT NULL DEFAULT false,
  life_jacket_confirmed BOOLEAN NOT NULL DEFAULT false,
  risk_acknowledged BOOLEAN NOT NULL DEFAULT false,
  photo_consent BOOLEAN NOT NULL DEFAULT false,
  signature_data_url TEXT,
  witness_name TEXT,
  witness_signature_data_url TEXT,
  parent_guardian_name TEXT,
  parent_guardian_signature_data_url TEXT,
  is_minor BOOLEAN NOT NULL DEFAULT false,
  status consent_form_status NOT NULL DEFAULT 'pending',
  form_version TEXT NOT NULL DEFAULT '1.0',
  signed_at TIMESTAMPTZ,
  signing_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_booking ON consent_forms(booking_id);
CREATE INDEX IF NOT EXISTS idx_consent_customer ON consent_forms(customer_id);
CREATE INDEX IF NOT EXISTS idx_consent_status ON consent_forms(status);

-- =============================================
-- 8. INCIDENT REPORTS
-- =============================================
CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  customer_id UUID REFERENCES customers(id),
  activity_id UUID REFERENCES activities(id),
  reported_by TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  severity incident_severity NOT NULL DEFAULT 'minor',
  description TEXT NOT NULL,
  actions_taken TEXT,
  equipment_involved TEXT,
  witness_names TEXT,
  follow_up_needed BOOLEAN NOT NULL DEFAULT false,
  follow_up_notes TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_date ON incident_reports(incident_date);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incident_reports(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_resolved ON incident_reports(resolved);

-- =============================================
-- 9. PAYMENTS
-- =============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES staff_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

-- =============================================
-- 10. AUDIT LOG
-- =============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);

-- =============================================
-- AUTO-UPDATE TRIGGERS
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_staff_profiles_updated
    BEFORE UPDATE ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_activities_updated
    BEFORE UPDATE ON activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_customers_updated
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_bookings_updated
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_equipment_updated
    BEFORE UPDATE ON equipment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_incident_reports_updated
    BEFORE UPDATE ON incident_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- BOOKING REF GENERATOR
-- =============================================
CREATE OR REPLACE FUNCTION generate_booking_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_ref IS NULL OR NEW.booking_ref = '' THEN
    NEW.booking_ref := 'OB-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_bookings_ref
    BEFORE INSERT ON bookings
    FOR EACH ROW EXECUTE FUNCTION generate_booking_ref();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- SIGNING TOKEN GENERATOR
-- =============================================
CREATE OR REPLACE FUNCTION generate_signing_token()
RETURNS TEXT AS $$
  SELECT encode(gen_random_bytes(32), 'hex');
$$ LANGUAGE sql;

-- Set signing_token on consent_forms and equipment_rentals if NULL
CREATE OR REPLACE FUNCTION set_signing_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.signing_token IS NULL THEN
    NEW.signing_token := generate_signing_token();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_consent_signing_token
    BEFORE INSERT ON consent_forms
    FOR EACH ROW EXECUTE FUNCTION set_signing_token();
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_rental_signing_token
    BEFORE INSERT ON equipment_rentals
    FOR EACH ROW EXECUTE FUNCTION set_signing_token();
EXCEPTION WHEN duplicate_object THEN null;
END $$;
