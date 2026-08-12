-- Relief ATL — Tiger Data schema
--
-- Two tables, two very different jobs:
--
--   restrooms  — slow-moving facts imported from public datasets (GSU audit,
--                OpenStreetMap, and later MARTA / City of Atlanta / Throne).
--                One row per physical location. Provenance is never discarded.
--
--   reports    — the time-series. Every anonymous community confirmation is an
--                immutable, timestamped event. We never UPDATE a status; the
--                current picture is always *derived* from recent events, which
--                is exactly what Tiger Data is good at.
--
-- Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- restrooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restrooms (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name                    TEXT NOT NULL,

    latitude                DOUBLE PRECISION NOT NULL,
    longitude               DOUBLE PRECISION NOT NULL,

    address                 TEXT,

    -- Provenance. Never present community or third-party data as official.
    source                  TEXT NOT NULL,
    source_id               TEXT,
    source_url              TEXT,

    location_type           TEXT,

    -- Access restrictions, as recorded by the source.
    officially_public       BOOLEAN,
    purchase_required       BOOLEAN,
    permission_required     BOOLEAN,
    code_or_key_required    BOOLEAN,
    gate_or_turnstile       BOOLEAN,

    -- Accessibility + facilities. NULL means "the source didn't say" — it is
    -- never rendered as a "no". We do not infer missing attributes.
    wheelchair_accessible   BOOLEAN,
    gender_neutral          BOOLEAN,
    changing_table          BOOLEAN,

    soap_available          BOOLEAN,
    toilet_paper_available  BOOLEAN,
    water_available         BOOLEAN,

    opening_hours           TEXT,
    open_24h                BOOLEAN,

    -- TRUE when somebody physically verified a usable restroom here.
    -- This is the distinction the whole product is built on: a listing is not
    -- a verification, and a verification is not current availability.
    historically_accessible BOOLEAN,

    original_audit_date     TIMESTAMPTZ,
    last_source_verified_at TIMESTAMPTZ,

    source_metadata         JSONB,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (source, source_id) so importers are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS restrooms_source_key
    ON restrooms (source, source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS restrooms_lat_lon_idx ON restrooms (latitude, longitude);
CREATE INDEX IF NOT EXISTS restrooms_source_idx  ON restrooms (source);

-- ---------------------------------------------------------------------------
-- reports  (the Tiger Data hypertable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id            BIGSERIAL,

    restroom_id   UUID NOT NULL REFERENCES restrooms(id) ON DELETE CASCADE,

    status        TEXT NOT NULL
                  CHECK (status IN ('accessible', 'locked', 'closed',
                                    'customer_only', 'out_of_service',
                                    'not_found', 'other')),

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata      JSONB,

    PRIMARY KEY (id, created_at)
);

-- Partition the event stream by time. This is what makes "what happened here
-- in the last 20 minutes?" cheap even as the history grows without bound.
SELECT create_hypertable(
    'reports', 'created_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS reports_restroom_time_idx
    ON reports (restroom_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_status_time_idx
    ON reports (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Continuous aggregate: hourly availability per restroom.
--
-- Powers the status timeline and the reliability metric without rescanning the
-- raw event stream. Tiger Data keeps it fresh incrementally.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS reports_hourly
WITH (timescaledb.continuous) AS
SELECT
    restroom_id,
    time_bucket(INTERVAL '1 hour', created_at)                     AS bucket,
    COUNT(*) FILTER (WHERE status = 'accessible')                  AS positive,
    COUNT(*) FILTER (WHERE status <> 'accessible')                 AS negative,
    COUNT(*)                                                       AS total
FROM reports
GROUP BY restroom_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'reports_hourly',
    start_offset      => INTERVAL '30 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists     => TRUE
);
