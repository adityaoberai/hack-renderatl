/**
 * Storage contract shared by the Tiger Data store and the in-memory fallback.
 *
 * Both implementations return exactly the same shapes, so every ranking,
 * confidence and UI decision lives in one place and behaves identically no
 * matter where the rows came from.
 */

import type { Report, ReportStatus, Restroom, SourceId, TimelineBucket } from '../types.ts';
import type { StoreMode } from './db.ts';

export interface BBox {
	south: number;
	west: number;
	north: number;
	east: number;
}

export interface NewReport {
	restroomId: string;
	status: ReportStatus;
	metadata?: Record<string, unknown> | null;
}

export interface StoreSummary {
	mode: StoreMode;
	restrooms: number;
	bySource: Partial<Record<SourceId, number>>;
	reports: number;
	reports24h: number;
	positive24h: number;
	negative24h: number;
	restroomsWithReports: number;
	latestReportAt: string | null;
}

export interface RestroomStore {
	readonly mode: StoreMode;
	/** All restrooms, optionally pre-filtered to a bounding box. */
	listRestrooms(bbox?: BBox): Promise<Restroom[]>;
	getRestroom(id: string): Promise<Restroom | null>;
	/** Recent reports for many restrooms at once, newest first per restroom. */
	recentReportsFor(ids: string[], sinceDays: number): Promise<Map<string, Report[]>>;
	/** Newest-first report history for a single restroom. */
	reportsFor(id: string, limit: number): Promise<Report[]>;
	addReport(input: NewReport): Promise<Report>;
	/** Hour-bucketed positive/negative counts, oldest first. */
	hourlyTimeline(id: string, hours: number): Promise<TimelineBucket[]>;
	summary(): Promise<StoreSummary>;
}

export function inBBox(restroom: Restroom, bbox: BBox): boolean {
	return (
		restroom.latitude >= bbox.south &&
		restroom.latitude <= bbox.north &&
		restroom.longitude >= bbox.west &&
		restroom.longitude <= bbox.east
	);
}

/** Group a flat, newest-first report list by restroom id. */
export function groupReports(reports: Report[]): Map<string, Report[]> {
	const grouped = new Map<string, Report[]>();
	for (const report of reports) {
		const list = grouped.get(report.restroomId);
		if (list) list.push(report);
		else grouped.set(report.restroomId, [report]);
	}
	return grouped;
}

/** Bucket raw reports into hourly slots. Used by the in-memory store; Tiger Data uses `time_bucket`. */
export function bucketHourly(reports: Report[], hours: number, now: Date): TimelineBucket[] {
	const HOUR = 3_600_000;
	const end = Math.floor(now.getTime() / HOUR) * HOUR + HOUR;
	const start = end - hours * HOUR;

	const buckets = new Map<number, TimelineBucket>();
	for (let t = start; t < end; t += HOUR) {
		buckets.set(t, { bucket: new Date(t).toISOString(), positive: 0, negative: 0 });
	}

	for (const report of reports) {
		const ts = Date.parse(report.createdAt);
		if (Number.isNaN(ts) || ts < start || ts >= end) continue;
		const slot = buckets.get(Math.floor(ts / HOUR) * HOUR);
		if (!slot) continue;
		if (report.status === 'accessible') slot.positive++;
		else slot.negative++;
	}

	return [...buckets.values()];
}
