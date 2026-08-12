import { getSummary } from '$lib/server/restrooms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const summary = await getSummary();
	return { summary };
};
