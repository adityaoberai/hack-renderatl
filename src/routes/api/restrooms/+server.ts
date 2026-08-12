import { json } from '@sveltejs/kit';
import { findNearby } from '$lib/server/restrooms';
import type { Filters } from '$lib/types';
import type { RequestHandler } from './$types';

const num = (value: string | null): number | undefined => {
	if (value === null || value.trim() === '') return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const flag = (params: URLSearchParams, key: string) =>
	params.get(key) === '1' || params.get(key) === 'true';

/** GET /api/restrooms?lat=&lon=&radius=&limit=&wheelchair=1… */
export const GET: RequestHandler = async ({ url }) => {
	const latitude = num(url.searchParams.get('lat'));
	const longitude = num(url.searchParams.get('lon'));

	const filters: Partial<Filters> = {
		wheelchair: flag(url.searchParams, 'wheelchair'),
		changingTable: flag(url.searchParams, 'changingTable'),
		noPurchase: flag(url.searchParams, 'noPurchase'),
		recentlyConfirmed: flag(url.searchParams, 'recentlyConfirmed'),
		publicOnly: flag(url.searchParams, 'publicOnly')
	};

	const results = await findNearby({
		latitude,
		longitude,
		radiusMeters: num(url.searchParams.get('radius')),
		limit: num(url.searchParams.get('limit')),
		filters
	});

	return json(
		{ results, count: results.length, generatedAt: new Date().toISOString() },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
