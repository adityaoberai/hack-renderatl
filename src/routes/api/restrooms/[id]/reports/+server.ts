import { addRestroomReport } from '$lib/server/restrooms';
import type { ReportStatus } from '$lib/types';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_STATUSES = new Set<ReportStatus>([
	'accessible',
	'locked',
	'closed',
	'customer_only',
	'out_of_service',
	'not_found',
	'other'
] as ReportStatus[]);

function validCoordinate(value: unknown, minimum: number, maximum: number): value is number {
	return (
		typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
	);
}

export const POST: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ message: 'A JSON request body is required.' }, { status: 400 });
	}

	if (typeof body.status !== 'string' || !ALLOWED_STATUSES.has(body.status as ReportStatus)) {
		return json({ message: 'Choose a valid report status.' }, { status: 400 });
	}
	if (!validCoordinate(body.latitude, -90, 90) || !validCoordinate(body.longitude, -180, 180)) {
		return json({ message: 'Valid location coordinates are required.' }, { status: 400 });
	}

	try {
		const result = await addRestroomReport(params.id, body.status as ReportStatus, {
			latitude: body.latitude,
			longitude: body.longitude
		});
		return json({ result }, { status: 201 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Restroom not found.') {
			return json({ message: error.message }, { status: 404 });
		}
		console.error('Unable to save restroom report.', error);
		return json({ message: 'Your report could not be saved. Please try again.' }, { status: 503 });
	}
};
