import { calculateAccessConfidence } from '$lib/confidence';
import { distanceInMeters, estimatedWalkingMinutes } from '$lib/geo';
import type { Coordinates, NearbyRestroom, ReportStatus, RestroomFilters } from '$lib/types';
import {
	insertReport,
	listRestroomsWithReports,
	type RestroomWithReports
} from './restroom-repository';

export const ATLANTA_CENTER: Coordinates = {
	latitude: 33.755,
	longitude: -84.39
};

function matchesFilters(result: NearbyRestroom, filters: RestroomFilters): boolean {
	const restroom = result.restroom;
	if (filters.wheelchairAccessible && restroom.wheelchairAccessible !== true) return false;
	if (filters.changingTable && restroom.changingTable !== true) return false;
	if (filters.noPurchaseRequired && restroom.purchaseRequired !== false) return false;
	if (filters.publicOnly && restroom.officiallyPublic !== true) return false;
	if (filters.recentlyConfirmed && result.confidence.status !== 'confirmed') return false;
	return true;
}

function rankingScore(result: NearbyRestroom): number {
	const statusAdjustment =
		result.confidence.status === 'confirmed'
			? 18
			: result.confidence.status === 'unavailable'
				? -45
				: 0;
	const distancePenalty = Math.min(35, result.distanceMeters / 300);
	return result.confidence.score + statusAdjustment - distancePenalty;
}

function toNearbyResult(
	entry: RestroomWithReports,
	location: Coordinates,
	now = new Date()
): NearbyRestroom {
	const distanceMeters = distanceInMeters(location, entry.restroom);
	return {
		restroom: entry.restroom,
		distanceMeters: Math.round(distanceMeters),
		estimatedWalkingMinutes: estimatedWalkingMinutes(distanceMeters),
		confidence: calculateAccessConfidence(entry.restroom, entry.reports, now),
		recentReports: entry.reports.slice(0, 8)
	};
}

export async function findNearbyRestrooms(
	location: Coordinates,
	filters: RestroomFilters = {},
	limit = 80
): Promise<NearbyRestroom[]> {
	const entries = await listRestroomsWithReports();
	return entries
		.map((entry) => toNearbyResult(entry, location))
		.filter((result) => matchesFilters(result, filters))
		.sort((left, right) => rankingScore(right) - rankingScore(left))
		.slice(0, Math.min(Math.max(limit, 1), 200));
}

export async function findRestroom(
	restroomId: string,
	location: Coordinates
): Promise<NearbyRestroom | null> {
	const entries = await listRestroomsWithReports();
	const entry = entries.find((candidate) => candidate.restroom.id === restroomId);
	return entry ? toNearbyResult(entry, location) : null;
}

export async function addRestroomReport(
	restroomId: string,
	status: ReportStatus,
	location: Coordinates
): Promise<NearbyRestroom> {
	const existing = await findRestroom(restroomId, location);
	if (!existing) throw new Error('Restroom not found.');

	await insertReport(restroomId, status);
	const updated = await findRestroom(restroomId, location);
	if (!updated) throw new Error('Restroom not found after report was saved.');
	return updated;
}
