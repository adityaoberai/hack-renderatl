/**
 * Service layer: the only place the app reasons about restrooms.
 *
 * Picks a store (Tiger Data when configured, in-memory otherwise), pulls the
 * recent event history for the candidate set, runs the confidence engine, and
 * ranks the result. Every route below this is thin.
 */

import { calculateAccessConfidence, calculateReliability } from '../confidence.ts';
import { degreeBox, haversineMeters, rankScore, walkingMinutes } from '../geo.ts';
import type {
	Filters,
	NearbyRestroom,
	Report,
	ReportStatus,
	Restroom,
	RestroomDetail
} from '../types.ts';
import { getSql, type StoreMode } from './db.ts';
import { getMemoryStore } from './memory-store.ts';
import { TigerDataStore } from './pg-store.ts';
import type { NewReport, RestroomStore, StoreSummary } from './store.ts';

/** How much history the confidence engine sees. Enough for the 30-day reliability window. */
const HISTORY_DAYS = 30;

let cachedStore: RestroomStore | null = null;
let cachedMode: StoreMode | null = null;

export function getStore(): RestroomStore {
	const sql = getSql();
	const mode: StoreMode = sql ? 'tigerdata' : 'memory';
	if (cachedStore && cachedMode === mode) return cachedStore;
	cachedMode = mode;
	cachedStore = sql ? new TigerDataStore(sql) : getMemoryStore();
	return cachedStore;
}

/**
 * Tiger Data is preferred, but a database hiccup mid-demo must not take the app
 * down. If a query throws we fall back to the bundled public datasets and say so.
 */
async function withFallback<T>(run: (store: RestroomStore) => Promise<T>): Promise<T> {
	const store = getStore();
	try {
		return await run(store);
	} catch (error) {
		if (store.mode === 'memory') throw error;
		console.error('[relief-atl] Tiger Data query failed, serving from bundled public data:', error);
		return run(getMemoryStore());
	}
}

export interface NearbyQuery {
	latitude?: number;
	longitude?: number;
	radiusMeters?: number;
	limit?: number;
	filters?: Partial<Filters>;
	/** Restrict to a viewport instead of a radius (used when panning the map). */
	bbox?: { south: number; west: number; north: number; east: number };
}

function passesFilters(entry: NearbyRestroom, filters: Partial<Filters>): boolean {
	const r = entry.restroom;
	if (filters.wheelchair && r.wheelchairAccessible !== true) return false;
	if (filters.changingTable && r.changingTable !== true) return false;
	if (filters.noPurchase && r.purchaseRequired !== false) return false;
	if (filters.publicOnly && r.officiallyPublic !== true) return false;
	if (filters.recentlyConfirmed && entry.availabilityStatus !== 'confirmed') return false;
	return true;
}

/** Assemble the full picture for one restroom: static facts + event history. */
function assemble(
	restroom: Restroom,
	reports: Report[],
	origin: { latitude: number; longitude: number } | null,
	now: Date
): NearbyRestroom {
	const confidence = calculateAccessConfidence(restroom, reports, { now });

	const distanceMeters = origin ? haversineMeters(origin, restroom) : null;
	const dayAgo = now.getTime() - 86_400_000;
	const last24 = reports.filter((r) => Date.parse(r.createdAt) >= dayAgo);

	return {
		restroom,
		distanceMeters,
		estimatedWalkingMinutes: distanceMeters === null ? null : walkingMinutes(distanceMeters),
		confidenceScore: confidence.score,
		availabilityStatus: confidence.status,
		confidenceReason: confidence.reason,
		lastConfirmedAt: confidence.lastConfirmedAt,
		lastReportAt: confidence.lastReportAt,
		source: restroom.source,
		reportCount24h: last24.length,
		positiveCount24h: last24.filter((r) => r.status === 'accessible').length,
		negativeCount24h: last24.filter((r) => r.status !== 'accessible').length,
		reliability: calculateReliability(reports, { now })
	};
}

export async function findNearby(query: NearbyQuery = {}): Promise<NearbyRestroom[]> {
	const now = new Date();
	const limit = Math.min(query.limit ?? 40, 200);
	const hasOrigin = query.latitude !== undefined && query.longitude !== undefined;
	const origin = hasOrigin
		? { latitude: query.latitude as number, longitude: query.longitude as number }
		: null;

	return withFallback(async (store) => {
		let bbox = query.bbox;
		if (!bbox && origin) {
			// Cheap bounding-box prefilter before the exact haversine pass.
			const radius = query.radiusMeters ?? 3200;
			const { latDelta, lonDelta } = degreeBox(origin.latitude, radius);
			bbox = {
				south: origin.latitude - latDelta,
				north: origin.latitude + latDelta,
				west: origin.longitude - lonDelta,
				east: origin.longitude + lonDelta
			};
		}

		let restrooms = await store.listRestrooms(bbox);

		// Nothing within the radius (user is outside the covered areas): widen to
		// everything we have rather than showing an empty map.
		if (!restrooms.length) restrooms = await store.listRestrooms();

		if (origin && query.radiusMeters) {
			const withinRadius = restrooms.filter(
				(r) => haversineMeters(origin, r) <= (query.radiusMeters as number)
			);
			if (withinRadius.length) restrooms = withinRadius;
		}

		const reportsByRestroom = await store.recentReportsFor(
			restrooms.map((r) => r.id),
			HISTORY_DAYS
		);

		const entries = restrooms.map((restroom) =>
			assemble(restroom, reportsByRestroom.get(restroom.id) ?? [], origin, now)
		);

		const filters = query.filters ?? {};
		const filtered = entries.filter((entry) => passesFilters(entry, filters));

		filtered.sort((a, b) => {
			// Confidence leads, distance is the tie-breaker. A restroom you cannot
			// get into is not "nearby" in any useful sense.
			const byRank =
				rankScore({
					confidenceScore: b.confidenceScore,
					walkingMinutes: b.estimatedWalkingMinutes,
					availabilityStatus: b.availabilityStatus
				}) -
				rankScore({
					confidenceScore: a.confidenceScore,
					walkingMinutes: a.estimatedWalkingMinutes,
					availabilityStatus: a.availabilityStatus
				});
			if (Math.abs(byRank) > 0.001) return byRank;
			return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
		});

		return filtered.slice(0, limit);
	});
}

export async function getRestroomDetail(
	id: string,
	origin?: { latitude: number; longitude: number } | null
): Promise<RestroomDetail | null> {
	const now = new Date();

	return withFallback(async (store) => {
		const restroom = await store.getRestroom(id);
		if (!restroom) return null;

		const [reports, timeline] = await Promise.all([
			store.reportsFor(id, 200),
			store.hourlyTimeline(id, 24)
		]);

		const base = assemble(restroom, reports, origin ?? null, now);
		const confidence = calculateAccessConfidence(restroom, reports, { now });

		return {
			...base,
			confidenceFactors: confidence.factors,
			recentReports: reports.slice(0, 20),
			timeline
		};
	});
}

export async function submitReport(
	input: NewReport,
	origin?: { latitude: number; longitude: number } | null
): Promise<{ report: Report; detail: RestroomDetail | null }> {
	const report = await withFallback((store) => store.addReport(input));
	// Recompute immediately so the client can swap in a real, server-derived
	// status rather than optimistically guessing what the score became.
	const detail = await getRestroomDetail(input.restroomId, origin);
	return { report, detail };
}

export async function getSummary(): Promise<StoreSummary> {
	return withFallback((store) => store.summary());
}

export const REPORT_STATUSES: ReportStatus[] = [
	'accessible',
	'locked',
	'closed',
	'customer_only',
	'out_of_service',
	'not_found',
	'other'
];
