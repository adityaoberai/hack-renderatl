import { databaseEnabled } from '$lib/server/db';
import { ATLANTA_CENTER, findNearbyRestrooms } from '$lib/server/restrooms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });

	return {
		results: await findNearbyRestrooms(ATLANTA_CENTER),
		initialLocation: ATLANTA_CENTER,
		databaseEnabled
	};
};
