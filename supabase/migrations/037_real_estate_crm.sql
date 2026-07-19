-- ============================================================
-- 037_real_estate_crm.sql
--
-- Refactors and upgrades the database schema to handle distinct
-- real estate primitives with strict typing and relations.
-- ============================================================

-- 1) Refactor CONTACTS table
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS type TEXT CHECK (type IN ('Buyer', 'Seller', 'Renter', 'Agent')),
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS budget_min NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS budget_max NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS preferred_locations TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS requirements_beds INTEGER,
  ADD COLUMN IF NOT EXISTS requirements_baths INTEGER,
  ADD COLUMN IF NOT EXISTS requirements_property_type TEXT;

-- 2) Create PROPERTIES table
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('MLS', 'Property Finder', 'Bayut', 'Internal')),
  source_id TEXT,
  address TEXT NOT NULL,
  coordinates_lat NUMERIC(10, 8),
  coordinates_lng NUMERIC(11, 8),
  price NUMERIC(12, 2) NOT NULL,
  beds INTEGER,
  baths INTEGER,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Pending', 'Sold', 'Off-Market')),
  features TEXT[] DEFAULT ARRAY[]::TEXT[],
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_account ON properties(account_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_price ON properties(price);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS properties_select ON properties;
DROP POLICY IF EXISTS properties_insert ON properties;
DROP POLICY IF EXISTS properties_update ON properties;
DROP POLICY IF EXISTS properties_delete ON properties;

CREATE POLICY properties_select ON properties FOR SELECT USING (is_account_member(account_id));
CREATE POLICY properties_insert ON properties FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY properties_update ON properties FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY properties_delete ON properties FOR DELETE USING (is_account_member(account_id, 'agent'));

-- 3) Refactor DEALS table
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'New Lead' CHECK (stage IN ('New Lead', 'Qualified', 'Viewing Scheduled', 'Offer Sent', 'Won', 'Lost')),
  ADD COLUMN IF NOT EXISTS commission_expectation NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS suggested_property_ids UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX IF NOT EXISTS idx_deals_property ON deals(property_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage_text ON deals(stage);

-- 4) Create BOOKINGS/viewings table
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  scheduled_time TIMESTAMPTZ NOT NULL,
  feedback_notes TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'No-Show')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings(account_id);
CREATE INDEX IF NOT EXISTS idx_bookings_deal ON bookings(deal_id);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_time ON bookings(scheduled_time);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_select ON bookings;
DROP POLICY IF EXISTS bookings_insert ON bookings;
DROP POLICY IF EXISTS bookings_update ON bookings;
DROP POLICY IF EXISTS bookings_delete ON bookings;

CREATE POLICY bookings_select ON bookings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY bookings_insert ON bookings FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY bookings_update ON bookings FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY bookings_delete ON bookings FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Triggers for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON properties;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
