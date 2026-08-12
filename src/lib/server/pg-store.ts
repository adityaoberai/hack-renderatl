/**
 * Tiger Data implementation of `RestroomStore`.
 *
 * `restrooms` is ordinary relational data. `reports` is a hypertable, and the
 * only thing we ever do to it is INSERT: statuses are never overwritten, so
 * the full history of every location stays queryable.
 */

import type postgres from 'postgres';
import type { Report, ReportStatus, Restroom, SourceId, TimelineBucket } from '../types.ts';
import {
	groupReports,
	type BBox,
	type NewReport,
	type RestroomStore,
	type StoreSummary
} from './store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function iso(value: unknown): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();
	const parsed = new Date(String(value));
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function rowToRestroom(row: any): Restroom {
	return {
		id: row.id,
		name: row.name,
		latitude: Number(row.latitude),
		longitude: Number(row.longitude),
		address: row.address ?? null,
		source: row.source as SourceId,
		sourceId: row.source_id ?? null,
		sourceUrl: row.source_url ?? null,
		locationType: row.location_type ?? null,
		officiallyPublic: row.officially_public ?? null,
		purchaseRequired: row.purchase_required ?? null,
		permissionRequired: row.permission_required ?? null,
		codeOrKeyRequired: row.code_or_key_required ?? null,
		gateOrTurnstile: row.gate_or_turnstile ?? null,
		wheelchairAccessible: row.wheelchair_accessible ?? null,
		genderNeutral: row.gender_neutral ?? null,
		changingTable: row.changing_table ?? null,
		soapAvailable: row.soap_available ?? null,
		toiletPaperAvailable: row.toilet_paper_available ?? null,
		waterAvailable: row.water_available ?? null,
		openingHours: row.opening_hours ?? null,
		open24h: row.open_24h ?? null,
		historicallyAccessible: row.historically_accessible ?? null,
		originalAuditDate: iso(row.original_audit_date),
		lastSourceVerifiedAt: iso(row.last_source_verified_at),
		sourceMetadata: row.source_metadata ?? null
	};
}

function rowToReport(row: any): Report {
	return {
		id: typeof row.id === 'bigint' ? Number(row.id) : row.id,
		restroomId: row.restroom_id,
		status: row.status as ReportStatus,
		createdAt: iso(row.created_at) ?? new Date().toISOString(),
		metadata: row.metadata ?? null
	};
}

export class TigerDataStore implements RestroomStore {
	readonly mode = 'tigerdata' as const;

	constructor(private readonly sql: postgres.Sql) {}

	async listRestrooms(bbox?: BBox): Promise<Restroom[]> {
		const rows = bbox
			? await this.sql`
					SELECT * FROM restrooms
					WHERE latitude BETWEEN ${bbox.south} AND ${bbox.north}
					  AND longitude BETWEEN ${bbox.west} AND ${bbox.east}
				`
			: await this.sql`SELECT * FROM restrooms`;
		return rows.map(rowToRestroom);
	}

	async getRestroom(id: string): Promise<Restroom | null> {
		const rows = await this.sql`SELECT * FROM restrooms WHERE id = ${id} LIMIT 1`;
		return rows.length ? rowToRestroom(rows[0]) : null;
	}

	async recentReportsFor(ids: string[], sinceDays: number): Promise<Map<string, Report[]>> {
		if (!ids.length) return new Map();
		const rows = await this.sql`
			SELECT * FROM reports
			WHERE restroom_id = ANY(${this.sql.array(ids)}::uuid[])
			  AND created_at > NOW() - (${sinceDays} || ' days')::interval
			ORDER BY created_at DESC
		`;
		return groupReports(rows.map(rowToReport));
	}

	async reportsFor(id: string, limit: number): Promise<Report[]> {
		const rows = await this.sql`
			SELECT * FROM reports
			WHERE restroom_id = ${id}
			ORDER BY created_at DESC
			LIMIT ${limit}
		`;
		return rows.map(rowToReport);
	}

	/** The only write path in the product. Append-only, by design. */
	async addReport(input: NewReport): Promise<Report> {
		const rows = await this.sql`
			INSERT INTO reports ${this.sql({
				restroom_id: input.restroomId,
				status: input.status,
				metadata: this.sql.json((input.metadata ?? {}) as never)
			})}
			RETURNING *
		`;
		return rowToReport(rows[0]);
	}

	/**
	 * Hourly buckets straight out of Tiger Data. `time_bucket` + `generate_series`
	 * gives us a gap-free strip, including the hours where nothing happened.
	 */
	async hourlyTimeline(id: string, hours: number): Promise<TimelineBucket[]> {
		const rows = await this.sql`
			WITH slots AS (
				SELECT generate_series(
					date_trunc('hour', NOW()) - (${hours - 1} || ' hours')::interval,
					date_trunc('hour', NOW()),
					INTERVAL '1 hour'
				) AS bucket
			),
			events AS (
				SELECT
					time_bucket(INTERVAL '1 hour', created_at) AS bucket,
					COUNT(*) FILTER (WHERE status = 'accessible')  AS positive,
					COUNT(*) FILTER (WHERE status <> 'accessible') AS negative
				FROM reports
				WHERE restroom_id = ${id}
				  AND created_at > NOW() - (${hours} || ' hours')::interval
				GROUP BY 1
			)
			SELECT slots.bucket,
			       COALESCE(events.positive, 0) AS positive,
			       COALESCE(events.negative, 0) AS negative
			FROM slots
			LEFT JOIN events ON events.bucket = slots.bucket
			ORDER BY slots.bucket
		`;
		return rows.map((row: any) => ({
			bucket: iso(row.bucket) ?? new Date().toISOString(),
			positive: Number(row.positive),
			negative: Number(row.negative)
		}));
	}

	async summary(): Promise<StoreSummary> {
		const [restroomCounts, reportStats] = await Promise.all([
			this.sql`SELECT source, COUNT(*)::int AS count FROM restrooms GROUP BY source`,
			this.sql`
				SELECT
					COUNT(*)::int                                                              AS total,
					COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int      AS last24,
					COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'
					                   AND status = 'accessible')::int                         AS positive24,
					COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'
					                   AND status <> 'accessible')::int                        AS negative24,
					COUNT(*) FILTER (WHERE metadata->>'seeded' = 'true')::int                   AS seeded,
					COUNT(DISTINCT restroom_id)::int                                           AS distinct_restrooms,
					MAX(created_at)                                                            AS latest
				FROM reports
			`
		]);

		const bySource: Partial<Record<SourceId, number>> = {};
		let restrooms = 0;
		for (const row of restroomCounts as any[]) {
			bySource[row.source as SourceId] = row.count;
			restrooms += row.count;
		}

		const stats = (reportStats as any[])[0] ?? {};
		return {
			mode: this.mode,
			restrooms,
			bySource,
			reports: stats.total ?? 0,
			reports24h: stats.last24 ?? 0,
			positive24h: stats.positive24 ?? 0,
			negative24h: stats.negative24 ?? 0,
			restroomsWithReports: stats.distinct_restrooms ?? 0,
			latestReportAt: iso(stats.latest)
		};
	}
}
