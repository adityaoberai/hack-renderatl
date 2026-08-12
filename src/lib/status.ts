/**
 * Presentation rules for availability status and restroom attributes.
 *
 * Colour carries the single most important idea in the product, so the mapping
 * lives in exactly one place:
 *
 *   green  — recent evidence says someone got in
 *   amber  — probably fine, but nobody has confirmed lately
 *   red    — recent evidence says they could not get in
 *   grey   — we genuinely do not know
 */

import type { AvailabilityStatus, NearbyRestroom, Restroom, SourceId } from './types';
import { SOURCE_LABEL, SOURCE_SHORT } from './types';
import { relative } from './confidence';

export interface StatusStyle {
	/** Short label for pills and markers. */
	label: string;
	/** Longer label for the detail sheet. */
	longLabel: string;
	dot: string;
	pill: string;
	text: string;
	bar: string;
	ring: string;
	/** Hex used for the map marker, which is drawn outside Tailwind. */
	pin: string;
}

export const STATUS_STYLE: Record<AvailabilityStatus, StatusStyle> = {
	confirmed: {
		label: 'Confirmed',
		longLabel: 'Confirmed accessible',
		dot: 'bg-ok',
		pill: 'bg-ok-soft text-ok border-ok-line',
		text: 'text-ok',
		bar: 'bg-ok',
		ring: 'ring-ok-line',
		pin: '#17944a'
	},
	likely: {
		label: 'Likely available',
		longLabel: 'Likely available',
		dot: 'bg-warn-pin',
		pill: 'bg-warn-soft text-warn border-warn-line',
		text: 'text-warn',
		bar: 'bg-warn-pin',
		ring: 'ring-warn-line',
		pin: '#d08313'
	},
	unavailable: {
		label: 'Unavailable',
		longLabel: 'Reported unavailable',
		dot: 'bg-bad',
		pill: 'bg-bad-soft text-bad border-bad-line',
		text: 'text-bad',
		bar: 'bg-bad',
		ring: 'ring-bad-line',
		pin: '#cf3226'
	},
	uncertain: {
		label: 'Unverified',
		longLabel: 'Not recently verified',
		dot: 'bg-unknown-pin',
		pill: 'bg-unknown-soft text-unknown border-unknown-line',
		text: 'text-unknown',
		bar: 'bg-unknown-pin',
		ring: 'ring-unknown-line',
		pin: '#77808d'
	}
};

/** Order used by the legend and the filter sheet. */
export const STATUS_ORDER: AvailabilityStatus[] = [
	'confirmed',
	'likely',
	'uncertain',
	'unavailable'
];

export interface Attribute {
	label: string;
	/** What to render on the right-hand side. */
	display: string;
	/**
	 * Whether this reads as good or bad news for the user. Kept separate from the
	 * displayed value: "Gate or turnstile — Yes" is a *bad* thing, so tone cannot
	 * simply be derived from a yes/no.
	 */
	tone: 'good' | 'bad' | 'neutral';
}

/**
 * Attributes we actually have data for. A `null` in the record means the source
 * never recorded it, and it is omitted entirely — never rendered as a "no".
 */
export function accessAttributes(restroom: Restroom): Attribute[] {
	const out: Attribute[] = [];

	const yesNo = (label: string, value: boolean | null, falseTone: 'bad' | 'neutral' = 'bad') => {
		if (value === null || value === undefined) return;
		out.push({ label, display: value ? 'Yes' : 'No', tone: value ? 'good' : falseTone });
	};

	yesNo('Public facility', restroom.officiallyPublic);
	if (restroom.purchaseRequired !== null) {
		out.push({
			label: restroom.source === 'osm' ? 'Free to use' : 'No purchase required',
			display: restroom.purchaseRequired ? 'No' : 'Yes',
			tone: restroom.purchaseRequired ? 'bad' : 'good'
		});
	}
	yesNo('Wheelchair accessible', restroom.wheelchairAccessible);
	yesNo('Changing table', restroom.changingTable, 'neutral');
	yesNo('Gender neutral', restroom.genderNeutral, 'neutral');

	// Restrictions are only listed when they apply, and "Yes" here is bad news.
	if (restroom.permissionRequired === true) {
		out.push({ label: 'Staff permission needed', display: 'Yes', tone: 'bad' });
	}
	if (restroom.codeOrKeyRequired === true) {
		out.push({ label: 'Code or key required', display: 'Yes', tone: 'bad' });
	}
	if (restroom.gateOrTurnstile === true) {
		out.push({ label: 'Behind a gate or turnstile', display: 'Yes', tone: 'bad' });
	}

	return out;
}

export function facilityAttributes(restroom: Restroom): Attribute[] {
	const out: Attribute[] = [];
	const meta = (restroom.sourceMetadata ?? {}) as Record<string, unknown>;
	const push = (label: string, value: unknown) => {
		if (value === true) out.push({ label, display: 'Yes', tone: 'good' });
		else if (value === false) out.push({ label, display: 'No', tone: 'neutral' });
	};

	push('Soap', restroom.soapAvailable);
	push('Running water', restroom.waterAvailable);
	push('Toilet paper', restroom.toiletPaperAvailable);
	push('Paper towels', meta.paperTowels);
	push('Hand dryer', meta.handDryer);
	push('Grab rails', meta.grabRails);
	push('Mirror', meta.mirror);
	push('Menstrual products', meta.menstrualProducts);
	push('Water fountain', meta.waterFountain);
	push('Shower', meta.shower);

	return out;
}

/** Tailwind text colour for an attribute's tone. */
export const ATTRIBUTE_TONE: Record<Attribute['tone'], string> = {
	good: 'text-ok',
	bad: 'text-bad',
	neutral: 'text-ink-subtle'
};

/** The compact attribute chips shown on a result card — positives only, capped. */
export function cardAttributes(restroom: Restroom, limit = 4): string[] {
	const chips: string[] = [];
	if (restroom.officiallyPublic === true) chips.push('Public');
	if (restroom.purchaseRequired === false) chips.push('No purchase');
	if (restroom.wheelchairAccessible === true) chips.push('Wheelchair accessible');
	if (restroom.changingTable === true) chips.push('Changing table');
	if (restroom.genderNeutral === true) chips.push('Gender neutral');
	if (restroom.open24h === true) chips.push('Open 24h');
	if (restroom.soapAvailable === true) chips.push('Soap');
	return chips.slice(0, limit);
}

export function sourceLabel(source: SourceId): string {
	return SOURCE_LABEL[source] ?? source;
}

export function sourceShort(source: SourceId): string {
	return SOURCE_SHORT[source] ?? source;
}

/**
 * The provenance line under a card.
 *
 * A record that came from the GSU audit *and* has fresh community reports shows
 * both, because they answer different questions.
 */
export function provenanceLine(entry: NearbyRestroom, now: Date = new Date()): string {
	const parts: string[] = [];
	const audit = entry.restroom.originalAuditDate;

	if (entry.source === 'gsu') {
		parts.push(
			audit
				? `GSU audit · ${new Date(audit).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
				: 'GSU audit'
		);
	} else if (entry.source === 'osm') {
		parts.push('OpenStreetMap');
	} else {
		parts.push(sourceShort(entry.source));
	}

	if (entry.lastConfirmedAt) {
		parts.push(`Community confirmed ${relative(entry.lastConfirmedAt, now)}`);
	} else if (entry.lastReportAt) {
		parts.push(`Community reported ${relative(entry.lastReportAt, now)}`);
	} else {
		parts.push('No recent confirmation');
	}

	return parts.join(' · ');
}

/** Colour for the confidence number itself — same language as the status. */
export function scoreTone(score: number): string {
	if (score >= 70) return 'text-ok';
	if (score >= 52) return 'text-warn';
	if (score >= 30) return 'text-unknown';
	return 'text-bad';
}
