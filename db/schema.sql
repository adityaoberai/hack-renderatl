CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS restrooms (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL,
	latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
	longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
	address TEXT,
	source TEXT NOT NULL,
	source_id TEXT,
	source_url TEXT,
	location_type TEXT,
	officially_public BOOLEAN,
	purchase_required BOOLEAN,
	wheelchair_accessible BOOLEAN,
	gender_neutral BOOLEAN,
	changing_table BOOLEAN,
	soap_available BOOLEAN,
	toilet_paper_available BOOLEAN,
	water_available BOOLEAN,
	opening_hours TEXT,
	historically_accessible BOOLEAN,
	original_audit_date TIMESTAMPTZ,
	last_source_verified_at TIMESTAMPTZ,
	source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT restrooms_source_check
		CHECK (source IN ('gsu', 'osm', 'marta', 'atlanta', 'throne', 'community'))
);

CREATE UNIQUE INDEX IF NOT EXISTS restrooms_source_id_idx
	ON restrooms (source, source_id)
	WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS restrooms_coordinates_idx
	ON restrooms (latitude, longitude);

CREATE TABLE IF NOT EXISTS reports (
	id BIGSERIAL,
	restroom_id UUID NOT NULL REFERENCES restrooms(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	metadata JSONB,
	PRIMARY KEY (id, created_at),
	CONSTRAINT reports_status_check
		CHECK (
			status IN (
				'accessible',
				'locked',
				'closed',
				'customer_only',
				'out_of_service',
				'not_found',
				'other'
			)
		)
);

SELECT create_hypertable('reports', 'created_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS reports_restroom_created_at_idx
	ON reports (restroom_id, created_at DESC);
