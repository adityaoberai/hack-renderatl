import type {
	AccessConfidence,
	AvailabilityStatus,
	ReportStatus,
	Restroom,
	RestroomReport
} from './types';

const NEGATIVE_STATUSES = new Set<ReportStatus>([
	'locked',
	'closed',
	'customer_only',
	'out_of_service',
	'not_found',
	'other'
]);

function clamp(value: number): number {
	return Math.min(100, Math.max(0, Math.round(value)));
}

function hoursSince(timestamp: string, now: Date): number {
	return Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 3_600_000);
}

function positiveWeight(ageHours: number): number {
	if (ageHours <= 0.5) return 45;
	if (ageHours <= 3) return 35;
	if (ageHours <= 24) return 20;
	if (ageHours <= 24 * 7) return 8;
	if (ageHours <= 24 * 30) return 3;
	return 0;
}

function negativeWeight(ageHours: number): number {
	if (ageHours <= 0.5) return -55;
	if (ageHours <= 3) return -45;
	if (ageHours <= 24) return -25;
	if (ageHours <= 24 * 7) return -10;
	if (ageHours <= 24 * 30) return -4;
	return 0;
}

function relativeReportReason(report: RestroomReport, now: Date): string {
	const minutes = Math.max(
		0,
		Math.round((now.getTime() - new Date(report.createdAt).getTime()) / 60_000)
	);
	const age =
		minutes < 1
			? 'just now'
			: minutes < 60
				? `${minutes} min ago`
				: minutes < 24 * 60
					? `${Math.round(minutes / 60)} hr ago`
					: `${Math.round(minutes / (24 * 60))} days ago`;

	if (report.status === 'accessible') return `Successfully used ${age}`;

	const labels: Record<Exclude<ReportStatus, 'accessible'>, string> = {
		locked: 'Reported locked',
		closed: 'Reported closed',
		customer_only: 'Reported customer only',
		out_of_service: 'Reported out of service',
		not_found: "Someone couldn't find it",
		other: 'An access issue was reported'
	};

	return `${labels[report.status]} ${age}`;
}

function sourceAgeScore(restroom: Restroom, now: Date): number {
	if (!restroom.lastSourceVerifiedAt) return 0;
	const ageDays = hoursSince(restroom.lastSourceVerifiedAt, now) / 24;
	if (ageDays <= 30) return 8;
	if (ageDays <= 180) return 5;
	if (ageDays <= 730) return 2;
	return 0;
}

function openingHoursSignal(
	openingHours: string | null,
	now: Date
): { score: number; closed: boolean } | null {
	const hours = openingHours?.trim();
	if (!hours) return null;
	if (hours === '24/7') return { score: 5, closed: false };
	if (hours.toLowerCase() === 'closed') return { score: -40, closed: true };

	const clockParts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const weekdayMap: Record<string, string> = {
		Mon: 'Mo',
		Tue: 'Tu',
		Wed: 'We',
		Thu: 'Th',
		Fri: 'Fr',
		Sat: 'Sa',
		Sun: 'Su'
	};
	const weekday = weekdayMap[clockParts.find((part) => part.type === 'weekday')?.value ?? ''];
	const hour = Number(clockParts.find((part) => part.type === 'hour')?.value);
	const minute = Number(clockParts.find((part) => part.type === 'minute')?.value);
	if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

	const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
	const dayIndex = weekdays.indexOf(weekday);
	let parsedAnyRule = false;

	for (const segment of hours.split(';')) {
		const match = segment
			.trim()
			.match(
				/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+(?:(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})|off)$/i
			);
		if (!match) continue;
		parsedAnyRule = true;
		const startDay = weekdays.findIndex((day) => day.toLowerCase() === match[1].toLowerCase());
		const endDay = match[2]
			? weekdays.findIndex((day) => day.toLowerCase() === match[2]?.toLowerCase())
			: startDay;
		const dayMatches =
			startDay <= endDay
				? dayIndex >= startDay && dayIndex <= endDay
				: dayIndex >= startDay || dayIndex <= endDay;
		if (!dayMatches) continue;
		if (!match[3]) return { score: -40, closed: true };

		const currentMinutes = hour * 60 + minute;
		const startMinutes = Number(match[3]) * 60 + Number(match[4]);
		const endMinutes = Number(match[5]) * 60 + Number(match[6]);
		const isOpen =
			endMinutes >= startMinutes
				? currentMinutes >= startMinutes && currentMinutes < endMinutes
				: currentMinutes >= startMinutes || currentMinutes < endMinutes;
		if (isOpen) return { score: 5, closed: false };
	}

	return parsedAnyRule ? { score: -30, closed: true } : null;
}

function deriveReliability(reports: RestroomReport[], now: Date): number | null {
	const cutoff = now.getTime() - 90 * 24 * 3_600_000;
	const recent = reports.filter((report) => new Date(report.createdAt).getTime() >= cutoff);
	if (recent.length < 5) return null;
	const successful = recent.filter((report) => report.status === 'accessible').length;
	return Math.round((successful / recent.length) * 100);
}

export function calculateAccessConfidence(
	restroom: Restroom,
	reports: RestroomReport[],
	now = new Date()
): AccessConfidence {
	const orderedReports = [...reports]
		.filter((report) => !Number.isNaN(new Date(report.createdAt).getTime()))
		.sort(
			(left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
		);

	let score = 33;
	if (restroom.historicallyAccessible === true) score += 18;
	if (restroom.historicallyAccessible === false) score -= 14;
	if (restroom.officiallyPublic === true) score += 10;
	if (restroom.officiallyPublic === false) score -= 6;
	if (restroom.purchaseRequired === false) score += 6;
	if (restroom.purchaseRequired === true) score -= 12;
	const hoursSignal = openingHoursSignal(restroom.openingHours, now);
	score += hoursSignal?.score ?? 0;
	score += sourceAgeScore(restroom, now);

	for (const report of orderedReports.slice(0, 20)) {
		const ageHours = hoursSince(report.createdAt, now);
		score += report.status === 'accessible' ? positiveWeight(ageHours) : negativeWeight(ageHours);
	}

	const latestReport = orderedReports[0] ?? null;
	const latestAgeHours = latestReport ? hoursSince(latestReport.createdAt, now) : Infinity;
	let status: AvailabilityStatus;

	if (latestReport?.status === 'accessible' && latestAgeHours <= 3) {
		status = 'confirmed';
	} else if (latestReport && NEGATIVE_STATUSES.has(latestReport.status) && latestAgeHours <= 6) {
		status = 'unavailable';
	} else if (hoursSignal?.closed) {
		status = 'unavailable';
	} else if (score >= 60) {
		status = 'likely';
	} else {
		status = 'uncertain';
	}

	const lastConfirmation =
		orderedReports.find((report) => report.status === 'accessible')?.createdAt ?? null;
	let reason: string;

	if (latestReport && NEGATIVE_STATUSES.has(latestReport.status) && latestAgeHours <= 6) {
		reason = relativeReportReason(latestReport, now);
	} else if (
		hoursSignal?.closed &&
		!(latestReport?.status === 'accessible' && latestAgeHours <= 3)
	) {
		reason = 'Published hours indicate this location is closed now';
	} else if (latestReport && latestAgeHours <= 24 * 30) {
		reason = relativeReportReason(latestReport, now);
	} else if (restroom.source === 'gsu' && restroom.historicallyAccessible === true) {
		reason = 'GSU audit found an accessible restroom; no recent confirmation';
	} else if (restroom.source === 'gsu') {
		reason = 'GSU audit record; no recent community confirmation';
	} else {
		reason = 'No recent community confirmation';
	}

	return {
		score: clamp(score),
		status,
		reason,
		lastConfirmedAt: lastConfirmation,
		lastReportedAt: latestReport?.createdAt ?? null,
		reliability: deriveReliability(orderedReports, now),
		reportCount: orderedReports.length
	};
}
