import { json } from '@sveltejs/kit';
import { ATLANTA_BBOX } from '$lib/geo';
import type { RequestHandler } from './$types';

/**
 * GET /api/geocode?q=: "Search an area in Atlanta".
 *
 * Proxied server-side so we can send a proper User-Agent (Nominatim's usage
 * policy) and keep results bounded to metro Atlanta. Failures return an empty
 * list rather than an error: search is a convenience, and the map must keep
 * working when the geocoder is unreachable.
 */

const USER_AGENT = 'ReliefATL/1.0 (Atlanta civic-tech restroom finder)';

export interface GeocodeResult {
	label: string;
	latitude: number;
	longitude: number;
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 2) return json({ results: [] });

	const endpoint = new URL('https://nominatim.openstreetmap.org/search');
	endpoint.searchParams.set('format', 'jsonv2');
	endpoint.searchParams.set('q', query);
	endpoint.searchParams.set('limit', '6');
	endpoint.searchParams.set('countrycodes', 'us');
	endpoint.searchParams.set('bounded', '1');
	endpoint.searchParams.set(
		'viewbox',
		`${ATLANTA_BBOX.west},${ATLANTA_BBOX.north},${ATLANTA_BBOX.east},${ATLANTA_BBOX.south}`
	);

	try {
		const response = await fetch(endpoint, {
			headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
			signal: AbortSignal.timeout(6000)
		});
		if (!response.ok) return json({ results: [] });

		const raw = (await response.json()) as Array<{
			display_name?: string;
			name?: string;
			lat?: string;
			lon?: string;
		}>;

		const results: GeocodeResult[] = raw
			.map((item) => {
				const latitude = Number(item.lat);
				const longitude = Number(item.lon);
				if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
				// Nominatim's display_name is long; keep the first three components.
				const label =
					item.display_name?.split(',').slice(0, 3).join(',').trim() || item.name || query;
				return { label, latitude, longitude };
			})
			.filter((item): item is GeocodeResult => item !== null);

		return json({ results });
	} catch {
		return json({ results: [] });
	}
};
