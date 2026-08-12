import type { Coordinates } from './types';

const EARTH_RADIUS_METERS = 6_371_000;
const WALKING_SPEED_METERS_PER_MINUTE = 80;

function toRadians(value: number): number {
	return (value * Math.PI) / 180;
}

export function distanceInMeters(from: Coordinates, to: Coordinates): number {
	const latitudeDelta = toRadians(to.latitude - from.latitude);
	const longitudeDelta = toRadians(to.longitude - from.longitude);
	const fromLatitude = toRadians(from.latitude);
	const toLatitude = toRadians(to.latitude);

	const haversine =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function estimatedWalkingMinutes(distanceMeters: number): number {
	return Math.max(1, Math.round(distanceMeters / WALKING_SPEED_METERS_PER_MINUTE));
}

export function formatDistance(distanceMeters: number): string {
	const miles = distanceMeters / 1609.344;
	return miles < 0.1 ? `${Math.round(distanceMeters / 10) * 10} ft` : `${miles.toFixed(1)} mi`;
}
