/**
 * In-memory fallback store.
 *
 * Tiger Data is the system of record. This exists so that a missing
 * `DATABASE_URL` — or conference wifi that eats the database connection two
 * minutes before the demo — degrades into a fully working app instead of an
 * error page. It is backed by exactly the same imported public datasets and
 * implements exactly the same contract, so nothing above it can tell the
 * difference.
 *
 * Community reports submitted while running in this mode live for the lifetime
 * of the process; they are not persisted.
 */

import type { Report, Restroom, SourceId, TimelineBucket } from '../types.ts';
import gsuData from './data/gsu-restrooms.json';
import osmData from './data/osm-restrooms.json';
import { generateSeedReportRows } from './seed.ts';
import {
	bucketHourly,
	groupReports,
	inBBox,
	type BBox,
	type NewReport,
	type RestroomStore,
	type StoreSummary
} from './store.ts';

const SEED_REFRESH_MS = 10 * 60 * 1000;

const RESTROOMS: Restroom[] = [...(gsuData as Restroom[]), ...(osmData as Restroom[])];

export class MemoryStore implements RestroomStore {
	readonly mode = 'memory' as const;

	private userReports: Report[] = [];
	private seed: { generatedAt: number; reports: Report[] } | null = null;
	private nextId = 1_000_000;

	/**
	 * Seed reports are regenerated when they go stale so that "confirmed 18
	 * minutes ago" stays true however long the server has been up. Real
	 * submissions are never regenerated.
	 */
	private seedReports(): Report[] {
		const now = Date.now();
		if (!this.seed || now - this.seed.generatedAt > SEED_REFRESH_MS) {
			this.seed = { generatedAt: now, reports: generateSeedReportRows(RESTROOMS, new Date(now)) };
		}
		return this.seed.reports;
	}

	/** Newest first. */
	private allReports(): Report[] {
		return [...this.seedReports(), ...this.userReports].sort(
			(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
		);
	}

	async listRestrooms(bbox?: BBox): Promise<Restroom[]> {
		return bbox ? RESTROOMS.filter((r) => inBBox(r, bbox)) : RESTROOMS;
	}

	async getRestroom(id: string): Promise<Restroom | null> {
		return RESTROOMS.find((r) => r.id === id) ?? null;
	}

	async recentReportsFor(ids: string[], sinceDays: number): Promise<Map<string, Report[]>> {
		const wanted = new Set(ids);
		const cutoff = Date.now() - sinceDays * 86_400_000;
		return groupReports(
			this.allReports().filter((r) => wanted.has(r.restroomId) && Date.parse(r.createdAt) >= cutoff)
		);
	}

	async reportsFor(id: string, limit: number): Promise<Report[]> {
		return this.allReports()
			.filter((r) => r.restroomId === id)
			.slice(0, limit);
	}

	async addReport(input: NewReport): Promise<Report> {
		const report: Report = {
			id: this.nextId++,
			restroomId: input.restroomId,
			status: input.status,
			createdAt: new Date().toISOString(),
			metadata: input.metadata ?? null
		};
		// Append-only, exactly like the hypertable it stands in for.
		this.userReports.push(report);
		return report;
	}

	async hourlyTimeline(id: string, hours: number): Promise<TimelineBucket[]> {
		const reports = this.allReports().filter((r) => r.restroomId === id);
		return bucketHourly(reports, hours, new Date());
	}

	async summary(): Promise<StoreSummary> {
		const reports = this.allReports();
		const dayAgo = Date.now() - 86_400_000;
		const last24 = reports.filter((r) => Date.parse(r.createdAt) >= dayAgo);

		const bySource: Partial<Record<SourceId, number>> = {};
		for (const restroom of RESTROOMS) {
			bySource[restroom.source] = (bySource[restroom.source] ?? 0) + 1;
		}

		return {
			mode: this.mode,
			restrooms: RESTROOMS.length,
			bySource,
			reports: reports.length,
			reports24h: last24.length,
			positive24h: last24.filter((r) => r.status === 'accessible').length,
			negative24h: last24.filter((r) => r.status !== 'accessible').length,
			restroomsWithReports: new Set(reports.map((r) => r.restroomId)).size,
			latestReportAt: reports[0]?.createdAt ?? null
		};
	}
}

/**
 * Survive Vite HMR: without this, editing a server file during the demo would
 * silently discard every report submitted so far.
 */
const GLOBAL_KEY = Symbol.for('relief-atl.memory-store');
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: MemoryStore };

export function getMemoryStore(): MemoryStore {
	const g = globalThis as GlobalWithStore;
	if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new MemoryStore();
	return g[GLOBAL_KEY];
}
