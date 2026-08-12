import { error, json } from '@sveltejs/kit';
import { getRestroomDetail, REPORT_STATUSES, submitReport } from '$lib/server/restrooms';
import type { ReportStatus } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * POST /api/reports: anonymous community confirmation.
 *
 * No account, no session, no identity. The body is just:
 *   { restroomId, status, note? }
 *
 * Each call appends one immutable, timestamped row to the Tiger Data
 * hypertable. Nothing is ever updated in place, so the location keeps its full
 * availability history and the confidence score is always re-derived from
 * events rather than read from a mutable status column.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Expected a JSON body');
	}

	const { restroomId, status, note, latitude, longitude } = (body ?? {}) as {
		restroomId?: unknown;
		status?: unknown;
		note?: unknown;
		latitude?: unknown;
		longitude?: unknown;
	};

	if (typeof restroomId !== 'string' || !restroomId) {
		throw error(400, 'restroomId is required');
	}
	if (typeof status !== 'string' || !REPORT_STATUSES.includes(status as ReportStatus)) {
		throw error(400, `status must be one of: ${REPORT_STATUSES.join(', ')}`);
	}

	// The caller's position, so the recomputed detail keeps its walking time.
	const origin =
		typeof latitude === 'number' &&
		typeof longitude === 'number' &&
		Number.isFinite(latitude) &&
		Number.isFinite(longitude)
			? { latitude, longitude }
			: null;

	// Confirm the location exists before recording an event against it.
	const existing = await getRestroomDetail(restroomId);
	if (!existing) throw error(404, 'Restroom not found');

	const { report, detail } = await submitReport(
		{
			restroomId,
			status: status as ReportStatus,
			metadata: {
				source: 'relief-atl-web',
				...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 280) } : {})
			}
		},
		origin
	);

	return json({ report, detail }, { status: 201, headers: { 'cache-control': 'no-store' } });
};
