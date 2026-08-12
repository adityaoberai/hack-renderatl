import { getSummary } from '$lib/server/restrooms';
import type { PageServerLoad } from './$types';

/**
 * The landing screen quotes real numbers, so they come from the live store
 * rather than being hard-coded into the copy.
 */
export const load: PageServerLoad = async () => {
	const summary = await getSummary();
	return {
		summary: {
			restrooms: summary.restrooms,
			gsu: summary.bySource.gsu ?? 0,
			osm: summary.bySource.osm ?? 0,
			reports24h: summary.reports24h,
			mode: summary.mode
		}
	};
};
