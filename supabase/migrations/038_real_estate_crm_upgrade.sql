-- ============================================================
-- 038_real_estate_crm_upgrade.sql
--
-- Upgrades the database schema with professional real estate CRM
-- additions: Rich Personas, Calendar Integrations, Flow Logs, and
-- Omni-Channel channel supports.
-- ============================================================

-- 1) AGENT PERSONAS TABLE
CREATE TABLE IF NOT EXISTS agent_personas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  specialty_badge TEXT NOT NULL,
  tone TEXT NOT NULL,
  greeting_style TEXT NOT NULL,
  connected_capabilities TEXT[] DEFAULT ARRAY[]::TEXT[],
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_personas_account ON agent_personas(account_id);

ALTER TABLE agent_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_personas_select ON agent_personas;
DROP POLICY IF EXISTS agent_personas_insert ON agent_personas;
DROP POLICY IF EXISTS agent_personas_update ON agent_personas;
DROP POLICY IF EXISTS agent_personas_delete ON agent_personas;

CREATE POLICY agent_personas_select ON agent_personas FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_personas_insert ON agent_personas FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_personas_update ON agent_personas FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY agent_personas_delete ON agent_personas FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 2) ADD ACTIVE_PERSONA_ID TO CONTACTS AND DEALS
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS active_persona_id UUID REFERENCES agent_personas(id) ON DELETE SET NULL;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS active_persona_id UUID REFERENCES agent_personas(id) ON DELETE SET NULL;

-- 3) INTEGRATIONS TABLE (CALENDAR/CRM OAUTH STORAGE)
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'cal')),
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_account ON integrations(account_id);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_select ON integrations;
DROP POLICY IF EXISTS integrations_insert ON integrations;
DROP POLICY IF EXISTS integrations_update ON integrations;
DROP POLICY IF EXISTS integrations_delete ON integrations;

CREATE POLICY integrations_select ON integrations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY integrations_insert ON integrations FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY integrations_update ON integrations FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY integrations_delete ON integrations FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 4) BOOKINGS UPGRADES WITH EXTERNAL CALENDAR LINKS
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS external_event_id TEXT,
  ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;

-- 5) FLOW LOGS FOR PRODUCTION-GRADE VISUAL BUILDER RUNS (Module 4)
CREATE TABLE IF NOT EXISTS flow_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES flows(id) ON DELETE CASCADE,
  run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_logs_account ON flow_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_flow_logs_flow ON flow_logs(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_logs_run ON flow_logs(run_id);

ALTER TABLE flow_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_logs_select ON flow_logs;
CREATE POLICY flow_logs_select ON flow_logs FOR SELECT USING (is_account_member(account_id));

-- 6) OMNI-CHANNEL CHANNEL SWITCHING SUPPORT
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'email', 'chat'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'email', 'chat'));

-- 7) SEED INITIAL agent_personas FOR DUAL-COMPATIBILITY
-- Wrap in a DO block to prevent duplicating on re-runs
DO $$
DECLARE
  v_account RECORD;
BEGIN
  FOR v_account IN SELECT id FROM accounts LOOP
    IF NOT EXISTS (SELECT 1 FROM agent_personas WHERE account_id = v_account.id AND name = 'Seraphina') THEN
      INSERT INTO agent_personas (account_id, name, role, specialty_badge, tone, greeting_style, connected_capabilities)
      VALUES (
        v_account.id,
        'Seraphina',
        'Elite Luxury Concierge (Pearl Qatar)',
        'Luxury',
        'Prestigiously polished, sophisticated, and highly professional',
        'Greetings of distinction! Seraphina here, your dedicated luxury advisor.',
        ARRAY['Vector RAG', 'Calendar Lookup', 'Comp Analysis']
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM agent_personas WHERE account_id = v_account.id AND name = 'Marcus') THEN
      INSERT INTO agent_personas (account_id, name, role, specialty_badge, tone, greeting_style, connected_capabilities)
      VALUES (
        v_account.id,
        'Marcus',
        'High-Velocity MLS ROI Specialist',
        'MLS Specialist',
        'Assertive, fast-moving, and focused strictly on the numbers/analytics',
        'Hey! Marcus here, MLS pricing specialist. Let''s talk value.',
        ARRAY['Calendar Lookup', 'Comp Analysis']
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM agent_personas WHERE account_id = v_account.id AND name = 'Yasmin') THEN
      INSERT INTO agent_personas (account_id, name, role, specialty_badge, tone, greeting_style, connected_capabilities)
      VALUES (
        v_account.id,
        'Yasmin',
        'Relocation & Family Home Guide',
        'Relocation',
        'Empathetic, warm, neighborhood-focused, and highly detailed',
        'Hello! Yasmin here, delighted to guide your family property search.',
        ARRAY['Calendar Lookup']
      );
    END IF;
  END LOOP;
END $$;

-- 8) TRIGGERS FOR UPDATED_AT
DROP TRIGGER IF EXISTS set_updated_at ON agent_personas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_personas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON integrations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
