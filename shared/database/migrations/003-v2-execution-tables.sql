-- Migration 003: V2 Execution Tables
-- Adds design_runs, stage_runs, artifacts, component_prices
-- Forward-only; does not modify existing tables (001, 002).
-- Idempotent: uses IF NOT EXISTS guards.

-- =============================================================================
-- design_runs: one row per pipeline execution
-- =============================================================================
CREATE TABLE IF NOT EXISTS design_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_draft_id UUID NOT NULL REFERENCES design_drafts(id),
    pipeline_version VARCHAR NOT NULL DEFAULT '2.0',
    status VARCHAR NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'waiting_for_user', 'succeeded', 'failed', 'cancelled')),
    current_stage VARCHAR NULL,
    requested_by UUID NULL,
    input_snapshot JSONB NOT NULL DEFAULT '{}',
    warning_count INT NOT NULL DEFAULT 0,
    error_code VARCHAR NULL,
    error_message TEXT NULL,
    cancel_requested_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_runs_draft_status
    ON design_runs (design_draft_id, status);

CREATE INDEX IF NOT EXISTS idx_design_runs_status
    ON design_runs (status);

-- =============================================================================
-- stage_runs: one row per stage attempt within a design_run
-- =============================================================================
CREATE TABLE IF NOT EXISTS stage_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_run_id UUID NOT NULL REFERENCES design_runs(id),
    stage_name VARCHAR NOT NULL,
    stage_version VARCHAR NOT NULL DEFAULT '1',
    attempt INT NOT NULL DEFAULT 1,
    status VARCHAR NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_for_user')),
    idempotency_key VARCHAR NOT NULL,
    input_json JSONB NULL,
    output_json JSONB NULL,
    diagnostics JSONB NULL,
    error_code VARCHAR NULL,
    error_message TEXT NULL,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (design_run_id, stage_name, attempt),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_stage_runs_run_stage
    ON stage_runs (design_run_id, stage_name);

-- =============================================================================
-- artifacts: append-only output artifacts from stages
-- =============================================================================
CREATE TABLE IF NOT EXISTS artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    design_draft_id UUID NOT NULL REFERENCES design_drafts(id),
    design_run_id UUID NOT NULL REFERENCES design_runs(id),
    stage_run_id UUID NULL REFERENCES stage_runs(id),
    artifact_type VARCHAR NOT NULL
        CHECK (artifact_type IN (
            'design_spec', 'component_selection', 'bom', 'firmware_source',
            'compile_result', 'circuit_ir', 'wiring_svg', 'wiring_checklist',
            'upload_instructions', 'price_snapshot'
        )),
    schema_version VARCHAR NOT NULL DEFAULT '1',
    content_json JSONB NULL,
    content_text TEXT NULL,
    content_hash VARCHAR NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_type
    ON artifacts (design_run_id, artifact_type);

CREATE INDEX IF NOT EXISTS idx_artifacts_draft_type
    ON artifacts (design_draft_id, artifact_type);

-- =============================================================================
-- component_prices: dynamic pricing cache (non-fatal enrichment)
-- =============================================================================
CREATE TABLE IF NOT EXISTS component_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR NOT NULL,
    supplier VARCHAR NOT NULL,
    region VARCHAR NULL,
    currency VARCHAR NOT NULL DEFAULT 'CNY',
    unit_price DECIMAL NULL,
    purchase_url TEXT NULL,
    availability VARCHAR NULL,
    raw_payload JSONB NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_component_prices_lookup
    ON component_prices (component_id, supplier);
