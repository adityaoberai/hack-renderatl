import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface NominatimResult {
	display_name: string;
	lat: string;
	lon: string;
}

export const GET: RequestHandler = async ({ fetch, url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 2 || query.length > 120) {
		return json({ message: 'Enter an Atlanta address or neighborhood.' }, { status: 400 });
	}

	const endpoint = new URL('https://nominatim.openstreetmap.org/search');
	endpoint.searchParams.set('q', `${query}, Atlanta, Georgia`);
	endpoint.searchParams.set('format', 'jsonv2');
	endpoint.searchParams.set('limit', '5');
	endpoint.searchParams.set('countrycodes', 'us');
	endpoint.searchParams.set('viewbox', '-84.55,33.9,-84.28,33.6');
	endpoint.searchParams.set('bounded', '1');

	try {
		const response = await fetch(endpoint, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'Relief-ATL/1.0 (https://github.com/adityaoberai/hack-renderatl)'
			},
			signal: AbortSignal.timeout(6_000)
		});
		if (!response.ok) throw new Error(`Geocoder returned ${response.status}.`);

		const matches = (await response.json()) as NominatimResult[];
		const results = matches
			.map((match) => ({
				label: match.display_name,
				latitude: Number(match.lat),
				longitude: Number(match.lon)
			}))
			.filter(
				(match) =>
					Number.isFinite(match.latitude) &&
					Number.isFinite(match.longitude) &&
					match.latitude >= 33.6 &&
					match.latitude <= 33.9 &&
					match.longitude >= -84.55 &&
					match.longitude <= -84.28
			);
		return json({ results });
	} catch (error) {
		console.error('Atlanta address search failed.', error);
		return json({ message: 'Address search is temporarily unavailable.' }, { status: 502 });
	}
};
