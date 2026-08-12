/** Geographic helpers. Straight-line maths only: no routing engine in the MVP. */

const EARTH_RADIUS_M = 6_371_000;

/** Rough centre of downtown Atlanta, used when we have no user location. */
export const ATLANTA_CENTER = { latitude: 33.7537, longitude: -84.3863 } as const;

/** Generous bounding box around metro Atlanta, used to bound geocoding + OSM queries. */
export const ATLANTA_BBOX = {
	south: 33.62,
	west: -84.56,
	north: 33.89,
	east: -84.24
} as const;

export function haversineMeters(
	a: { latitude: number; longitude: number },
	b: { latitude: number; longitude: number }
): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.latitude - a.latitude);
	const dLon = toRad(b.longitude - a.longitude);
	const lat1 = toRad(a.latitude);
	const lat2 = toRad(b.latitude);
	const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Walking minutes from straight-line distance.
 * 1.33 m/s ≈ 80 m/min, times a 1.3 detour factor for real street networks.
 * Deliberately approximate: the MVP spends its complexity budget on availability.
 */
export function walkingMinutes(meters: number): number {
	return Math.max(1, Math.round((meters * 1.3) / 80));
}

export function formatDistance(meters: number): string {
	const miles = meters / 1609.34;
	if (miles < 0.1) return `${Math.round(meters / 0.3048 / 10) * 10} ft`;
	return `${miles.toFixed(1)} mi`;
}

/** Degrees of latitude/longitude covering `meters`, for a cheap bounding-box prefilter. */
export function degreeBox(latitude: number, radiusMeters: number) {
	const latDelta = radiusMeters / 111_320;
	const lonDelta = radiusMeters / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
	return { latDelta, lonDelta };
}

/**
 * Ranking blend. Distance alone is the wrong answer: a restroom two minutes
 * away that you cannot get into is worth less than one five minutes away that
 * you can. Confidence leads; walking time is the tie-breaker.
 */
export function rankScore(input: {
	confidenceScore: number;
	walkingMinutes: number | null;
	availabilityStatus: string;
}): number {
	const walk = input.walkingMinutes ?? 12;
	let score = input.confidenceScore - Math.min(45, walk * 2.2);
	if (input.availabilityStatus === 'unavailable') score -= 30;
	if (input.availabilityStatus === 'confirmed') score += 6;
	return score;
}

/** Deep-link walking directions into whichever maps app the user prefers. */
export function directionsUrl(latitude: number, longitude: number, label?: string): string {
	const destination = `${latitude},${longitude}`;
	const isApple =
		typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

	if (isApple) {
		const q = label ? `&q=${encodeURIComponent(label)}` : '';
		return `https://maps.apple.com/?daddr=${destination}&dirflg=w${q}`;
	}
	return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
}
