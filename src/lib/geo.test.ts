import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceInMeters, estimatedWalkingMinutes, formatDistance } from './geo';
import { safeExternalUrl } from './url';

describe('geographic helpers', () => {
	it('returns zero for the same point', () => {
		const point = { latitude: 33.755, longitude: -84.39 };
		assert.equal(distanceInMeters(point, point), 0);
	});

	it('uses a practical walking-time estimate', () => {
		assert.equal(estimatedWalkingMinutes(400), 5);
		assert.equal(estimatedWalkingMinutes(0), 1);
	});

	it('formats short and longer distances legibly', () => {
		assert.equal(formatDistance(805), '0.5 mi');
		assert.match(formatDistance(100), /ft/);
	});

	it('only permits web URLs for source links', () => {
		assert.equal(safeExternalUrl('javascript:alert(1)'), null);
		assert.equal(safeExternalUrl('not a URL'), null);
		assert.equal(safeExternalUrl('https://osf.io/fm9by'), 'https://osf.io/fm9by');
	});
});
