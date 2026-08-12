import seedRestrooms from '$lib/data/gsu-restrooms.json';
import demoRestroomData from '$lib/data/demo-restrooms.json';
import type { ReportStatus, Restroom, RestroomReport } from '$lib/types';
import { databaseEnabled, query } from './db';

interface RestroomRow {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	address: string | null;
	source: Restroom['source'];
	source_id: string | null;
	source_url: string | null;
	location_type: string | null;
	officially_public: boolean | null;
	purchase_required: boolean | null;
	wheelchair_accessible: boolean | null;
	gender_neutral: boolean | null;
	changing_table: boolean | null;
	soap_available: boolean | null;
	toilet_paper_available: boolean | null;
	water_available: boolean | null;
	opening_hours: string | null;
	historically_accessible: boolean | null;
	original_audit_date: Date | string | null;
	last_source_verified_at: Date | string | null;
	source_metadata: Record<string, unknown> | null;
}

interface ReportRow {
	id: string;
	restroom_id: string;
	status: ReportStatus;
	created_at: Date | string;
	metadata: Record<string, unknown> | null;
}

export interface RestroomWithReports {
	restroom: Restroom;
	reports: RestroomReport[];
}

const restroomColumns = `
	id, name, latitude, longitude, address, source, source_id, source_url, location_type,
	officially_public, purchase_required, wheelchair_accessible, gender_neutral,
	changing_table, soap_available, toilet_paper_available, water_available, opening_hours,
	historically_accessible, original_audit_date, last_source_verified_at, source_metadata
`;

let demoInitialized = false;
let demoSequence = 0;
const demoReports = new Map<string, RestroomReport[]>();

function toIsoString(value: Date | string | null): string | null {
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRestroom(row: RestroomRow): Restroom {
	return {
		id: row.id,
		name: row.name,
		latitude: Number(row.latitude),
		longitude: Number(row.longitude),
		address: row.address,
		source: row.source,
		sourceId: row.source_id,
		sourceUrl: row.source_url,
		locationType: row.location_type,
		officiallyPublic: row.officially_public,
		purchaseRequired: row.purchase_required,
		wheelchairAccessible: row.wheelchair_accessible,
		genderNeutral: row.gender_neutral,
		changingTable: row.changing_table,
		soapAvailable: row.soap_available,
		toiletPaperAvailable: row.toilet_paper_available,
		waterAvailable: row.water_available,
		openingHours: row.opening_hours,
		historicallyAccessible: row.historically_accessible,
		originalAuditDate: toIsoString(row.original_audit_date),
		lastSourceVerifiedAt: toIsoString(row.last_source_verified_at),
		sourceMetadata: row.source_metadata ?? {}
	};
}

function mapReport(row: ReportRow): RestroomReport {
	return {
		id: String(row.id),
		restroomId: row.restroom_id,
		status: row.status,
		createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
		metadata: row.metadata
	};
}

function initializeDemoReports(restrooms: Restroom[]): void {
	if (demoInitialized || restrooms.length === 0) return;
	demoInitialized = true;

	const auditedAccessible = restrooms.filter(
		(restroom) => restroom.historicallyAccessible === true
	);
	const accessible = auditedAccessible.length >= 3 ? auditedAccessible : restrooms;
	const now = Date.now();
	const selected = new Set<string>();
	const pick = (pattern: RegExp, fallbackIndex: number): Restroom | undefined => {
		const fallback = accessible[fallbackIndex];
		const restroom =
			accessible.find((candidate) => pattern.test(candidate.name) && !selected.has(candidate.id)) ??
			(fallback && !selected.has(fallback.id) ? fallback : undefined) ??
			accessible.find((candidate) => !selected.has(candidate.id));
		if (restroom) selected.add(restroom.id);
		return restroom;
	};
	const primary = pick(/library/i, 0);
	const unavailable = pick(/marta|station|transit/i, 1);
	const park = pick(/park|recreation/i, 2);
	const examples: Array<{ restroom: Restroom | undefined; status: ReportStatus; minutes: number }> =
		[
			{ restroom: primary, status: 'accessible', minutes: 18 },
			{ restroom: unavailable, status: 'locked', minutes: 12 },
			{ restroom: park, status: 'accessible', minutes: 126 },
			{ restroom: primary, status: 'accessible', minutes: 31 * 24 * 60 }
		];

	for (const example of examples) {
		if (!example.restroom) continue;
		const report: RestroomReport = {
			id: `demo-${++demoSequence}`,
			restroomId: example.restroom.id,
			status: example.status,
			createdAt: new Date(now - example.minutes * 60_000).toISOString(),
			metadata: { seeded: true }
		};
		demoReports.set(example.restroom.id, [report, ...(demoReports.get(example.restroom.id) ?? [])]);
	}
}

async function databaseRestrooms(): Promise<RestroomWithReports[]> {
	const restroomResult = await query<RestroomRow>(`SELECT ${restroomColumns} FROM restrooms`);
	const restrooms = restroomResult.rows.map(mapRestroom);
	if (restrooms.length === 0) return [];

	const ids = restrooms.map((restroom) => restroom.id);
	const reportResult = await query<ReportRow>(
		`SELECT id, restroom_id, status, created_at, metadata
		 FROM reports
		 WHERE restroom_id = ANY($1::uuid[])
		   AND created_at > NOW() - INTERVAL '90 days'
		 ORDER BY created_at DESC`,
		[ids]
	);
	const reportsByRestroom = new Map<string, RestroomReport[]>();
	for (const row of reportResult.rows) {
		const report = mapReport(row);
		reportsByRestroom.set(report.restroomId, [
			...(reportsByRestroom.get(report.restroomId) ?? []),
			report
		]);
	}

	return restrooms.map((restroom) => ({
		restroom,
		reports: reportsByRestroom.get(restroom.id) ?? []
	}));
}

function demoRestrooms(): RestroomWithReports[] {
	const imported = seedRestrooms as Restroom[];
	const restrooms = imported.length > 0 ? imported : (demoRestroomData as Restroom[]);
	initializeDemoReports(restrooms);
	return restrooms.map((restroom) => ({
		restroom,
		reports: [...(demoReports.get(restroom.id) ?? [])].sort(
			(left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
		)
	}));
}

export async function listRestroomsWithReports(): Promise<RestroomWithReports[]> {
	return databaseEnabled ? databaseRestrooms() : demoRestrooms();
}

export async function insertReport(
	restroomId: string,
	status: ReportStatus
): Promise<RestroomReport> {
	if (databaseEnabled) {
		const result = await query<ReportRow>(
			`INSERT INTO reports (restroom_id, status, metadata)
			 VALUES ($1, $2, $3::jsonb)
			 RETURNING id, restroom_id, status, created_at, metadata`,
			[restroomId, status, JSON.stringify({ origin: 'web' })]
		);
		return mapReport(result.rows[0]);
	}

	const imported = seedRestrooms as Restroom[];
	const restrooms = imported.length > 0 ? imported : (demoRestroomData as Restroom[]);
	const exists = restrooms.some((restroom) => restroom.id === restroomId);
	if (!exists) throw new Error('Restroom not found.');

	const report: RestroomReport = {
		id: `demo-${++demoSequence}`,
		restroomId,
		status,
		createdAt: new Date().toISOString(),
		metadata: { demoMode: true }
	};
	demoReports.set(restroomId, [report, ...(demoReports.get(restroomId) ?? [])]);
	return report;
}
