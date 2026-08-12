import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateAccessConfidence } from './confidence';
import type { ReportStatus, Restroom, RestroomReport } from './types';

const now = new Date('2026-08-12T18:00:00.000Z');

const restroom: Restroom = {
	id: '67faf7f6-e492-50ff-9d8f-1fd5e7dac7bf',
	name: 'Test public library',
	latitude: 33.755,
	longitude: -84.39,
	address: null,
	source: 'gsu',
	sourceId: 'test-1',
	sourceUrl: null,
	locationType: 'Public library',
	officiallyPublic: true,
	purchaseRequired: false,
	wheelchairAccessible: null,
	genderNeutral: null,
	changingTable: null,
	soapAvailable: null,
	toiletPaperAvailable: null,
	waterAvailable: null,
	openingHours: null,
	historicallyAccessible: true,
	originalAuditDate: '2025-04-01T12:00:00.000Z',
	lastSourceVerifiedAt: '2025-04-01T12:00:00.000Z',
	sourceMetadata: {}
};

function report(status: ReportStatus, minutesAgo: number, id: string): RestroomReport {
	return {
		id,
		restroomId: restroom.id,
		status,
		createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
		metadata: null
	};
}

describe('calculateAccessConfidence', () => {
	it('never treats a static audit as a recent confirmation', () => {
		const result = calculateAccessConfidence(restroom, [], now);

		assert.equal(result.status, 'likely');
		assert.equal(result.lastConfirmedAt, null);
		assert.match(result.reason, /GSU audit/);
	});

	it('gives a recent successful report confirmed status', () => {
		const result = calculateAccessConfidence(restroom, [report('accessible', 18, '1')], now);

		assert.equal(result.status, 'confirmed');
		assert.equal(result.lastConfirmedAt, '2026-08-12T17:42:00.000Z');
		assert.match(result.reason, /18 min ago/);
	});

	it('lets recent negative evidence override the historic audit', () => {
		const result = calculateAccessConfidence(
			restroom,
			[report('locked', 12, '1'), report('locked', 20, '2')],
			now
		);

		assert.equal(result.status, 'unavailable');
		assert.equal(result.score, 0);
		assert.match(result.reason, /locked/);
	});

	it('decays an old successful report instead of showing green', () => {
		const result = calculateAccessConfidence(
			restroom,
			[report('accessible', 10 * 24 * 60, '1')],
			now
		);

		assert.equal(result.status, 'likely');
		assert.notEqual(result.status, 'confirmed');
	});

	it('only publishes reliability after five reports', () => {
		const tooFew = calculateAccessConfidence(
			restroom,
			[report('accessible', 10, '1'), report('locked', 20, '2')],
			now
		);
		const enough = calculateAccessConfidence(
			restroom,
			[
				report('accessible', 10, '1'),
				report('accessible', 20, '2'),
				report('accessible', 30, '3'),
				report('locked', 40, '4'),
				report('closed', 50, '5')
			],
			now
		);

		assert.equal(tooFew.reliability, null);
		assert.equal(enough.reliability, 60);
	});

	it('uses explicit opening hours as a current availability signal', () => {
		const closed = calculateAccessConfidence({ ...restroom, openingHours: 'closed' }, [], now);
		const alwaysOpen = calculateAccessConfidence({ ...restroom, openingHours: '24/7' }, [], now);

		assert.equal(closed.status, 'unavailable');
		assert.match(closed.reason, /closed now/);
		assert.ok(alwaysOpen.score > calculateAccessConfidence(restroom, [], now).score);
	});
});
