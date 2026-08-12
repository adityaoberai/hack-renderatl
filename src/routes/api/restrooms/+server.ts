import { findNearbyRestrooms } from '$lib/server/restrooms';
import type { RestroomFilters } from '$lib/types';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function coordinate(value: string | null, minimum: number, maximum: number): number | null {
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function enabled(value: string | null): boolean {
	return value === 'true' || value === '1';
}

export const GET: RequestHandler = async ({ url }) => {
	const latitude = coordinate(url.searchParams.get('lat'), -90, 90);
	const longitude = coordinate(url.searchParams.get('lng'), -180, 180);
	if (latitude === null || longitude === null) {
		return json({ message: 'Valid lat and lng query parameters are required.' }, { status: 400 });
	}

	const requestedLimit = Number(url.searchParams.get('limit') ?? 80);
	const limit = Number.isInteger(requestedLimit) ? requestedLimit : 80;
	const filters: RestroomFilters = {
		wheelchairAccessible: enabled(url.searchParams.get('wheelchair')),
		changingTable: enabled(url.searchParams.get('changingTable')),
		noPurchaseRequired: enabled(url.searchParams.get('noPurchase')),
		recentlyConfirmed: enabled(url.searchParams.get('confirmed')),
		publicOnly: enabled(url.searchParams.get('publicOnly'))
	};

	try {
		return json({
			results: await findNearbyRestrooms({ latitude, longitude }, filters, limit)
		});
	} catch (error) {
		console.error('Unable to retrieve nearby restrooms.', error);
		return json({ message: 'Restroom data is temporarily unavailable.' }, { status: 503 });
	}
};
