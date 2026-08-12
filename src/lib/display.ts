import type { AvailabilityStatus, ReportStatus, Restroom } from './types';

export const STATUS_LABELS: Record<AvailabilityStatus, string> = {
	confirmed: 'Confirmed accessible',
	likely: 'Likely available',
	uncertain: 'Unverified / stale',
	unavailable: 'Reported unavailable'
};

export const REPORT_LABELS: Record<ReportStatus, string> = {
	accessible: 'Accessible',
	locked: 'Locked',
	closed: 'Closed',
	customer_only: 'Customer only',
	out_of_service: 'Out of service',
	not_found: "Couldn't find it",
	other: 'Other'
};

export function formatRelativeTime(timestamp: string | null, now = new Date()): string | null {
	if (!timestamp) return null;
	const time = new Date(timestamp).getTime();
	if (Number.isNaN(time)) return null;
	const minutes = Math.max(0, Math.round((now.getTime() - time) / 60_000));
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hr ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
	const months = Math.round(days / 30);
	return `${months} month${months === 1 ? '' : 's'} ago`;
}

export function formatAuditDate(timestamp: string | null): string | null {
	if (!timestamp) return null;
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
}

export function sourceName(restroom: Restroom, full = false): string {
	const labels: Record<Restroom['source'], [string, string]> = {
		gsu: ['GSU restroom audit', 'Georgia State University public restroom audit'],
		osm: ['OpenStreetMap', 'OpenStreetMap'],
		marta: ['MARTA', 'MARTA'],
		atlanta: ['City of Atlanta', 'City of Atlanta'],
		throne: ['Throne', 'Throne'],
		community: ['Community', 'Relief ATL community']
	};
	return labels[restroom.source][full ? 1 : 0];
}

export function provenance(restroom: Restroom, lastConfirmedAt: string | null): string {
	const recent = formatRelativeTime(lastConfirmedAt);
	if (recent) return `${sourceName(restroom)} · Community confirmed ${recent}`;
	const auditDate = formatAuditDate(restroom.originalAuditDate ?? restroom.lastSourceVerifiedAt);
	return auditDate
		? `${sourceName(restroom)} · ${auditDate}`
		: `${sourceName(restroom)} · No recent confirmation`;
}

export function knownAttributes(restroom: Restroom): string[] {
	const attributes: string[] = [];
	if (restroom.officiallyPublic === true) attributes.push('Public');
	if (restroom.purchaseRequired === false) attributes.push('No purchase required');
	if (restroom.wheelchairAccessible === true) attributes.push('Wheelchair accessible');
	if (restroom.changingTable === true) attributes.push('Changing table');
	if (restroom.genderNeutral === true) attributes.push('Gender neutral');
	if (restroom.soapAvailable === true) attributes.push('Soap available');
	if (restroom.waterAvailable === true) attributes.push('Running water');
	if (restroom.toiletPaperAvailable === true) attributes.push('Toilet paper');
	return attributes;
}
