/**
 * Access Confidence Score — the heart of Relief ATL.
 *
 * Answers one question: *how confident are we that someone can walk up to this
 * restroom right now and actually use it?*
 *
 * Two layers:
 *
 *   1. A STATIC baseline from public data (GSU physical audit, OSM listing,
 *      known restrictions, opening hours). This decays with age and is
 *      deliberately capped — static data can never earn a green pin.
 *
 *   2. An EVIDENCE layer built from timestamped community reports. Recent
 *      events overwhelm the baseline: the weight of the evidence layer
 *      saturates fast, so one confirmation from 18 minutes ago matters more
 *      than an audit from last year.
 *
 * Fully deterministic. No LLM, no randomness, no hidden state.
 */

import type {
	ConfidenceFactor,
	ConfidenceResult,
	Report,
	Restroom,
	AvailabilityStatus
} from './types';
import { isOpenAt, parseOpeningHours } from './hours';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How much a *successful* confirmation still counts, by age. */
function positiveWeight(ageMs: number): number {
	if (ageMs < 30 * MINUTE) return 1;
	if (ageMs < 3 * HOUR) return 0.72;
	if (ageMs < 12 * HOUR) return 0.42;
	if (ageMs < DAY) return 0.26;
	if (ageMs < 3 * DAY) return 0.12;
	if (ageMs < 14 * DAY) return 0.05;
	return 0.015;
}

/**
 * Negative reports bite harder and faster: a locked door 15 minutes ago is
 * near-certain information, and being wrong about it is worse for the user
 * than being wrong about a positive.
 */
function negativeWeight(ageMs: number): number {
	if (ageMs < 20 * MINUTE) return 1;
	if (ageMs < 2 * HOUR) return 0.86;
	if (ageMs < 6 * HOUR) return 0.58;
	if (ageMs < DAY) return 0.3;
	if (ageMs < 7 * DAY) return 0.1;
	return 0.02;
}

/**
 * The highest score a location may hold given how long ago its most recent
 * successful report was.
 *
 * Without this, thirty days of "it was fine" piles up into a near-perfect score
 * even when nobody has been inside since yesterday. Corroboration should raise
 * confidence; it must never substitute for recency. This is the confidence
 * decay curve made explicit.
 */
function freshnessCeiling(ageMs: number): number {
	if (ageMs < 30 * MINUTE) return 99; // very strong
	if (ageMs < 3 * HOUR) return 93; // strong
	if (ageMs < 6 * HOUR) return 86;
	if (ageMs < 12 * HOUR) return 78; // today — moderate
	if (ageMs < DAY) return 71;
	if (ageMs < 3 * DAY) return 64; // several days — weak
	if (ageMs < 14 * DAY) return 58;
	return 52; // historical evidence only
}

/** Months elapsed since a static source last physically verified the record. */
function monthsSince(iso: string | null, now: Date): number | null {
	if (!iso) return null;
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return null;
	return Math.max(0, (now.getTime() - then) / (30.44 * DAY));
}

function clamp(n: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, n));
}

interface StaticBaseline {
	score: number;
	factors: ConfidenceFactor[];
	closedNow: boolean | null;
}

/**
 * The "what public data alone can tell us" score. Capped at 68 — a dataset
 * saying a restroom exists is never enough to promise it is usable now.
 */
function staticBaseline(restroom: Restroom, now: Date): StaticBaseline {
	const factors: ConfidenceFactor[] = [];
	let score = 34;
	factors.push({ label: 'Listed in a public dataset', delta: 34 });

	const add = (label: string, delta: number, detail?: string) => {
		if (delta === 0) return;
		score += delta;
		factors.push({ label, delta, detail });
	};

	if (restroom.historicallyAccessible === true) {
		add('Physically audited and found usable', 20, 'Researchers visited and used the restroom');
	} else if (restroom.source === 'osm') {
		add('Never physically verified', -8, 'Listed in OpenStreetMap, not audited on the ground');
	}

	if (restroom.officiallyPublic === true) add('Officially a public facility', 9);
	else if (restroom.officiallyPublic === false) add('Privately operated facility', -5);

	if (restroom.purchaseRequired === true) add('Purchase required', -12);
	else if (restroom.purchaseRequired === false) add('No purchase required', 4);

	if (restroom.permissionRequired === true) add('Staff permission needed to enter', -9);
	if (restroom.codeOrKeyRequired === true) add('Locked — needs a code or key', -8);
	if (restroom.gateOrTurnstile === true) add('Behind a gate or turnstile', -6);

	// Opening hours are only a factor when we can actually parse them.
	const spans = parseOpeningHours(restroom.open24h ? '24/7' : restroom.openingHours);
	const open = isOpenAt(spans, now);
	if (open === true) add('Open at this hour', 6);
	else if (open === false) add('Listed as closed right now', -26);

	const age = monthsSince(restroom.lastSourceVerifiedAt ?? restroom.originalAuditDate, now);
	if (age !== null && age > 6) {
		const penalty = -Math.round(clamp((age - 6) * 1.1, 0, 13));
		add('Source data is ageing', penalty, `Last verified ${Math.round(age)} months ago`);
	}

	return {
		score: clamp(score, 6, 68),
		factors,
		closedNow: open === false ? true : open === null ? null : false
	};
}

export interface ConfidenceOptions {
	/** Overridable for deterministic tests. */
	now?: Date;
}

export function calculateAccessConfidence(
	restroom: Restroom,
	reports: Report[],
	options: ConfidenceOptions = {}
): ConfidenceResult {
	const now = options.now ?? new Date();
	const base = staticBaseline(restroom, now);

	let positive = 0;
	let negative = 0;
	let lastConfirmedAt: string | null = null;
	let lastReportAt: string | null = null;
	let freshestNegative: Report | null = null;
	let freshestPositive: Report | null = null;
	let positiveCount = 0;
	let negativeCount = 0;
	/** Negatives inside the corroboration window — what "3 people just said" means. */
	let corroboratingNegatives = 0;
	const CORROBORATION_WINDOW = 3 * HOUR;

	for (const report of reports) {
		const ts = Date.parse(report.createdAt);
		if (Number.isNaN(ts)) continue;
		const age = now.getTime() - ts;
		if (age < 0) continue;

		if (!lastReportAt || ts > Date.parse(lastReportAt)) lastReportAt = report.createdAt;

		if (report.status === 'accessible') {
			positive += positiveWeight(age);
			positiveCount++;
			if (!freshestPositive || ts > Date.parse(freshestPositive.createdAt))
				freshestPositive = report;
			if (!lastConfirmedAt || ts > Date.parse(lastConfirmedAt)) lastConfirmedAt = report.createdAt;
		} else {
			negative += negativeWeight(age);
			negativeCount++;
			if (age <= CORROBORATION_WINDOW) corroboratingNegatives++;
			if (!freshestNegative || ts > Date.parse(freshestNegative.createdAt))
				freshestNegative = report;
		}
	}

	const factors = [...base.factors];
	let score = base.score;

	if (positive > 0 || negative > 0) {
		// How much do we trust the community evidence over the static baseline?
		// Saturates quickly: a single fresh report already carries ~90%.
		const evidenceWeight = 1 - Math.exp(-(positive + negative) / 0.42);
		// Where the evidence itself points. Negatives count 1.35x in the balance.
		const evidenceScore = 3 + 94 * (positive / (positive + 1.35 * negative));
		const blended = base.score * (1 - evidenceWeight) + evidenceScore * evidenceWeight;

		factors.push({
			label: 'Recent community reports',
			delta: Math.round(blended - base.score),
			detail: describeEvidence(positiveCount, negativeCount, positive, negative)
		});
		score = blended;

		// Cap by recency. A pile of week-old successes cannot make us confident
		// about right now — but it must never drag a location below what the
		// static public data alone already justified.
		if (lastConfirmedAt) {
			const age = now.getTime() - Date.parse(lastConfirmedAt);
			const ceiling = freshnessCeiling(age);
			if (score > ceiling) {
				const capped = Math.max(base.score, ceiling);
				if (capped < score) {
					factors.push({
						label: 'Last confirmation is ageing',
						delta: Math.round(capped - score),
						detail: `Capped at ${ceiling}% — nobody has reported success since ${relative(lastConfirmedAt, now)}`
					});
					score = capped;
				}
			}
		}
	} else {
		factors.push({
			label: 'No community reports yet',
			delta: 0,
			detail: 'Nobody has confirmed this location through Relief ATL'
		});
	}

	score = Math.round(clamp(score, 1, 99));

	const status = deriveStatus({ score, positive, negative, lastConfirmedAt, now, base });
	const reason = deriveReason({
		status,
		restroom,
		now,
		freshestPositive,
		freshestNegative,
		positiveCount,
		negativeCount: corroboratingNegatives,
		closedNow: base.closedNow
	});

	return { score, status, reason, lastConfirmedAt, lastReportAt, factors };
}

function describeEvidence(pc: number, nc: number, p: number, n: number): string {
	const bits: string[] = [];
	if (pc) bits.push(`${pc} successful ${pc === 1 ? 'report' : 'reports'}`);
	if (nc) bits.push(`${nc} ${nc === 1 ? 'problem report' : 'problem reports'}`);
	const lean =
		p > n ? 'weighted toward recent success' : n > p ? 'dominated by recent problems' : 'mixed';
	return `${bits.join(' · ')} — ${lean}`;
}

function deriveStatus(input: {
	score: number;
	positive: number;
	negative: number;
	lastConfirmedAt: string | null;
	now: Date;
	base: StaticBaseline;
}): AvailabilityStatus {
	const { score, positive, negative, lastConfirmedAt, now } = input;

	// Recent negative evidence wins outright — this is the whole point of the
	// product. Two "locked" reports in the last 20 minutes beat a 2025 audit.
	if (negative >= 0.5 && negative > positive) return 'unavailable';

	const confirmedAge = lastConfirmedAt ? now.getTime() - Date.parse(lastConfirmedAt) : Infinity;
	if (score >= 70 && confirmedAge <= 6 * HOUR) return 'confirmed';
	if (score >= 52) return 'likely';
	return 'uncertain';
}

function deriveReason(input: {
	status: AvailabilityStatus;
	restroom: Restroom;
	now: Date;
	freshestPositive: Report | null;
	freshestNegative: Report | null;
	positiveCount: number;
	negativeCount: number;
	closedNow: boolean | null;
}): string {
	const { status, restroom, now, freshestPositive, freshestNegative, negativeCount, closedNow } =
		input;

	if (status === 'unavailable' && freshestNegative) {
		const label = NEGATIVE_REASON[freshestNegative.status] ?? 'Reported unavailable';
		const suffix = negativeCount > 1 ? ` by ${negativeCount} people` : '';
		return `${label}${suffix} ${relative(freshestNegative.createdAt, now)}`;
	}

	if (freshestPositive && (status === 'confirmed' || status === 'likely')) {
		const age = now.getTime() - Date.parse(freshestPositive.createdAt);
		if (age < 12 * HOUR) return `Successfully used ${relative(freshestPositive.createdAt, now)}`;
		return `Last successful report ${relative(freshestPositive.createdAt, now)}`;
	}

	if (closedNow) return 'Listed as closed at this hour';

	if (restroom.source === 'gsu' && restroom.historicallyAccessible) {
		return 'Audited as usable, but not confirmed recently';
	}
	if (restroom.source === 'osm') return 'Listed in OpenStreetMap · never verified on the ground';
	return 'No recent confirmation';
}

const NEGATIVE_REASON: Record<string, string> = {
	locked: 'Reported locked',
	closed: 'Reported closed',
	customer_only: 'Reported customer-only',
	out_of_service: 'Reported out of service',
	not_found: "Reported: couldn't find it",
	other: 'Problem reported'
};

/** Compact relative time — "18 min ago", "2 hours ago", "Apr 2025". */
export function relative(iso: string, now: Date = new Date()): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return 'unknown';
	const diff = now.getTime() - then;
	if (diff < 45_000) return 'just now';
	const mins = Math.round(diff / MINUTE);
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(diff / HOUR);
	if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
	const days = Math.round(diff / DAY);
	if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
	if (days < 45) return `${Math.round(days / 7)} weeks ago`;
	return new Date(then).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Share of reports in the window that successfully accessed the restroom.
 * Returns null below the minimum sample so we never publish "100%" off one report.
 */
export function calculateReliability(
	reports: Report[],
	options: { windowDays?: number; minimumSample?: number; now?: Date } = {}
): { percent: number; sampleSize: number; windowDays: number } | null {
	const windowDays = options.windowDays ?? 30;
	const minimumSample = options.minimumSample ?? 5;
	const now = options.now ?? new Date();
	const cutoff = now.getTime() - windowDays * DAY;

	const inWindow = reports.filter((r) => {
		const ts = Date.parse(r.createdAt);
		return !Number.isNaN(ts) && ts >= cutoff && ts <= now.getTime();
	});
	if (inWindow.length < minimumSample) return null;

	const good = inWindow.filter((r) => r.status === 'accessible').length;
	return {
		percent: Math.round((good / inWindow.length) * 100),
		sampleSize: inWindow.length,
		windowDays
	};
}
