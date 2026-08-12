import { error, json } from '@sveltejs/kit';
import { getRestroomDetail } from '$lib/server/restrooms';
import type { RequestHandler } from './$types';

const num = (value: string | null): number | undefined => {
	if (value === null || value.trim() === '') return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

/** GET /api/restrooms/:id?lat=&lon=: full detail plus recent event history. */
export const GET: RequestHandler = async ({ params, url }) => {
	const latitude = num(url.searchParams.get('lat'));
	const longitude = num(url.searchParams.get('lon'));
	const origin = latitude !== undefined && longitude !== undefined ? { latitude, longitude } : null;

	const detail = await getRestroomDetail(params.id, origin);
	if (!detail) throw error(404, 'Restroom not found');

	return json(detail, { headers: { 'cache-control': 'no-store' } });
};
