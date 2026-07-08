CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    tier VARCHAR(50) NOT NULL DEFAULT 'free',
    daily_quota_remaining INT NOT NULL DEFAULT 10,
    daily_quota_reset_at TIMESTAMP DEFAULT NOW(),
    search_quota_monthly INT NOT NULL DEFAULT 0,
    search_quota_used INT NOT NULL DEFAULT 0,
    payg_balance DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    key_type VARCHAR(50) NOT NULL,
    key_value_encrypted TEXT NOT NULL,
    label VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP
);

CREATE TABLE design_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255),
    raw_description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'analyzing',
    current_stage VARCHAR(50) DEFAULT 'requirement',
    experience_level VARCHAR(50) NOT NULL DEFAULT 'beginner',
    membership_tier VARCHAR(50) NOT NULL DEFAULT 'free',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE project_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_draft_id UUID NOT NULL REFERENCES design_drafts(id),
    name VARCHAR(255),
    is_auto BOOLEAN DEFAULT TRUE,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE project_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    template_data JSONB NOT NULL,
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_design_drafts_user ON design_drafts(user_id);
CREATE INDEX idx_snapshots_draft ON project_snapshots(design_draft_id);