/**
 * Tiger Data command line.
 *
 *   node scripts/db.mjs setup    # create tables, hypertable + continuous aggregate
 *   node scripts/db.mjs import   # load the imported public datasets (idempotent)
 *   node scripts/db.mjs status   # what is actually in the database
 *   node scripts/db.mjs reset    # drop everything (asks for --force)
 *
 * Typical first run:  setup → import
 *
 * Needs DATABASE_URL, e.g.
 *   postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:39999/tsdb?sslmode=require
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(root, 'src/lib/server/data');
const SCHEMA_PATH = path.join(root, 'src/lib/server/schema.sql');

const url = process.env.DATABASE_URL?.trim();
if (!url) {
	console.error('DATABASE_URL is not set.\n');
	console.error('Create a .env file (see .env.example) with your Tiger Data connection string:');
	console.error(
		'  DATABASE_URL=postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:39999/tsdb?sslmode=require'
	);
	process.exit(1);
}

const sql = postgres(url, {
	ssl: /sslmode=disable/.test(url) ? false : 'require',
	max: 4,
	connect_timeout: 15,
	onnotice: () => {}
});

function loadDataset(file) {
	const full = path.join(DATA_DIR, file);
	if (!fs.existsSync(full)) return [];
	return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function allRestrooms() {
	const gsu = loadDataset('gsu-restrooms.json');
	const osm = loadDataset('osm-restrooms.json');
	return [...gsu, ...osm];
}

/* ------------------------------------------------------------------ setup */

async function setup() {
	const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
	console.log('Applying schema…');
	try {
		await sql.unsafe(schema);
		console.log('  ✓ restrooms, reports hypertable and reports_hourly aggregate are ready');
	} catch (error) {
		// Plain PostgreSQL without TimescaleDB still gives a working app; the
		// time-series features simply run against the raw table.
		if (/timescaledb|create_hypertable|continuous/i.test(String(error.message))) {
			console.warn(`  ! TimescaleDB features unavailable: ${error.message}`);
			console.warn('  → Falling back to plain tables. Point DATABASE_URL at Tiger Data for the');
			console.warn('    hypertable, continuous aggregate and time_bucket queries.');
			const withoutTimescale = schema
				.replace(/SELECT create_hypertable[\s\S]*?;/i, '')
				.replace(/CREATE MATERIALIZED VIEW[\s\S]*?WITH NO DATA;/i, '')
				.replace(/SELECT add_continuous_aggregate_policy[\s\S]*?;/i, '')
				.replace(/CREATE EXTENSION IF NOT EXISTS timescaledb;/i, '');
			await sql.unsafe(withoutTimescale);
			console.log('  ✓ base tables created');
		} else {
			throw error;
		}
	}
}

/* ----------------------------------------------------------------- import */

async function importRestrooms() {
	const restrooms = allRestrooms();
	if (!restrooms.length) {
		console.error(
			'No datasets found. Run: node scripts/import-gsu.mjs && node scripts/fetch-osm.mjs'
		);
		process.exit(1);
	}
	console.log(`Importing ${restrooms.length} restrooms…`);

	let inserted = 0;
	for (const r of restrooms) {
		const row = {
			id: r.id,
			name: r.name,
			latitude: r.latitude,
			longitude: r.longitude,
			address: r.address,
			source: r.source,
			source_id: r.sourceId,
			source_url: r.sourceUrl,
			location_type: r.locationType,
			officially_public: r.officiallyPublic,
			purchase_required: r.purchaseRequired,
			permission_required: r.permissionRequired,
			code_or_key_required: r.codeOrKeyRequired,
			gate_or_turnstile: r.gateOrTurnstile,
			wheelchair_accessible: r.wheelchairAccessible,
			gender_neutral: r.genderNeutral,
			changing_table: r.changingTable,
			soap_available: r.soapAvailable,
			toilet_paper_available: r.toiletPaperAvailable,
			water_available: r.waterAvailable,
			opening_hours: r.openingHours,
			open_24h: r.open24h,
			historically_accessible: r.historicallyAccessible,
			original_audit_date: r.originalAuditDate,
			last_source_verified_at: r.lastSourceVerifiedAt,
			source_metadata: sql.json(r.sourceMetadata ?? {})
		};

		// Re-importing refreshes the static facts without touching the event history.
		await sql`
			INSERT INTO restrooms ${sql(row)}
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				latitude = EXCLUDED.latitude,
				longitude = EXCLUDED.longitude,
				address = EXCLUDED.address,
				source_url = EXCLUDED.source_url,
				location_type = EXCLUDED.location_type,
				officially_public = EXCLUDED.officially_public,
				purchase_required = EXCLUDED.purchase_required,
				permission_required = EXCLUDED.permission_required,
				code_or_key_required = EXCLUDED.code_or_key_required,
				gate_or_turnstile = EXCLUDED.gate_or_turnstile,
				wheelchair_accessible = EXCLUDED.wheelchair_accessible,
				gender_neutral = EXCLUDED.gender_neutral,
				changing_table = EXCLUDED.changing_table,
				soap_available = EXCLUDED.soap_available,
				toilet_paper_available = EXCLUDED.toilet_paper_available,
				water_available = EXCLUDED.water_available,
				opening_hours = EXCLUDED.opening_hours,
				open_24h = EXCLUDED.open_24h,
				historically_accessible = EXCLUDED.historically_accessible,
				original_audit_date = EXCLUDED.original_audit_date,
				last_source_verified_at = EXCLUDED.last_source_verified_at,
				source_metadata = EXCLUDED.source_metadata
		`;
		inserted++;
		if (inserted % 50 === 0) console.log(`  ${inserted}/${restrooms.length}`);
	}

	const bySource =
		await sql`SELECT source, COUNT(*)::int AS count FROM restrooms GROUP BY source ORDER BY source`;
	console.log(`  ✓ ${inserted} restrooms upserted`);
	for (const row of bySource) console.log(`      ${row.source}: ${row.count}`);
}

/* ----------------------------------------------------------------- status */

async function status() {
	const [restrooms, reports, recent] = await Promise.all([
		sql`SELECT source, COUNT(*)::int AS count FROM restrooms GROUP BY source ORDER BY source`,
		sql`
			SELECT COUNT(*)::int AS total,
			       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last24,
			       COUNT(DISTINCT restroom_id)::int AS locations,
			       MIN(created_at) AS oldest,
			       MAX(created_at) AS newest
			FROM reports
		`,
		sql`
			SELECT r.name, rep.status, rep.created_at
			FROM reports rep JOIN restrooms r ON r.id = rep.restroom_id
			ORDER BY rep.created_at DESC LIMIT 8
		`
	]);

	console.log('Restrooms:');
	for (const row of restrooms) console.log(`   ${String(row.count).padStart(4)}  ${row.source}`);

	const stats = reports[0];
	console.log(
		`\nReports: ${stats.total} total · ${stats.last24} in the last 24h · ${stats.locations} locations`
	);
	if (stats.oldest)
		console.log(`   window: ${stats.oldest.toISOString()} → ${stats.newest.toISOString()}`);

	let hypertable = false;
	try {
		const rows =
			await sql`SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'reports'`;
		hypertable = rows.length > 0;
	} catch {
		/* not a Timescale instance */
	}
	console.log(`\nTiger Data hypertable on "reports": ${hypertable ? 'yes' : 'no'}`);

	console.log('\nMost recent events:');
	for (const row of recent) {
		console.log(`   ${row.created_at.toISOString()}  ${row.status.padEnd(15)} ${row.name}`);
	}
}

/* ------------------------------------------------------------------ reset */

async function reset() {
	if (!process.argv.includes('--force')) {
		console.error('This drops the reports and restrooms tables. Re-run with --force to confirm.');
		process.exit(1);
	}
	await sql.unsafe(`
		DROP MATERIALIZED VIEW IF EXISTS reports_hourly CASCADE;
		DROP TABLE IF EXISTS reports CASCADE;
		DROP TABLE IF EXISTS restrooms CASCADE;
	`);
	console.log('Dropped.');
}

/* ------------------------------------------------------------------- main */

const commands = { setup, import: importRestrooms, status, reset };
const command = process.argv[2];

if (!command || !(command in commands)) {
	console.error(`Usage: node scripts/db.mjs <${Object.keys(commands).join('|')}>`);
	process.exit(1);
}

try {
	await commands[command]();
} catch (error) {
	console.error(`\n${command} failed:`, error.message ?? error);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
