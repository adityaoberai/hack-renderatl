/**
 * Shared domain types for Relief ATL.
 *
 * The product hinges on keeping three ideas separate:
 *   existence: a dataset says a restroom is here
 *   verified accessibility: somebody physically checked it could be used
 *   current availability: somebody confirmed it recently
 */

/** Where a restroom record originally came from. Never conflate these. */
export type SourceId = 'gsu' | 'osm' | 'marta' | 'coa' | 'throne' | 'community';

/** Every status a community member can report. Stored verbatim as an event. */
export type ReportStatus =
	'accessible' | 'locked' | 'closed' | 'customer_only' | 'out_of_service' | 'not_found' | 'other';

/** Derived availability bucket. Drives every colour in the UI. */
export type AvailabilityStatus = 'confirmed' | 'likely' | 'uncertain' | 'unavailable';

export interface Restroom {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	address: string | null;

	source: SourceId;
	sourceId: string | null;
	sourceUrl: string | null;

	locationType: string | null;

	officiallyPublic: boolean | null;
	purchaseRequired: boolean | null;
	permissionRequired: boolean | null;
	codeOrKeyRequired: boolean | null;
	gateOrTurnstile: boolean | null;

	wheelchairAccessible: boolean | null;
	genderNeutral: boolean | null;
	changingTable: boolean | null;

	soapAvailable: boolean | null;
	toiletPaperAvailable: boolean | null;
	waterAvailable: boolean | null;

	openingHours: string | null;
	open24h: boolean | null;

	/** True when a physical audit found a usable restroom here. Null when unknown. */
	historicallyAccessible: boolean | null;

	originalAuditDate: string | null;
	lastSourceVerifiedAt: string | null;

	sourceMetadata: Record<string, unknown> | null;
}

export interface Report {
	id: number | string;
	restroomId: string;
	status: ReportStatus;
	createdAt: string;
	metadata: Record<string, unknown> | null;
}

/** Output of `calculateAccessConfidence`: deterministic, explainable, no LLM. */
export interface ConfidenceResult {
	score: number;
	status: AvailabilityStatus;
	reason: string;
	lastConfirmedAt: string | null;
	lastReportAt: string | null;
	/** Human-readable breakdown, shown in the detail sheet so the score is auditable. */
	factors: ConfidenceFactor[];
}

export interface ConfidenceFactor {
	label: string;
	delta: number;
	detail?: string;
}

/** A restroom plus everything the UI needs to rank and explain it. */
export interface NearbyRestroom {
	restroom: Restroom;
	distanceMeters: number | null;
	estimatedWalkingMinutes: number | null;
	confidenceScore: number;
	availabilityStatus: AvailabilityStatus;
	confidenceReason: string;
	lastConfirmedAt: string | null;
	lastReportAt: string | null;
	source: SourceId;
	reportCount24h: number;
	positiveCount24h: number;
	negativeCount24h: number;
	/** Percentage of reports in the reliability window that were successful, or null if too few. */
	reliability: { percent: number; sampleSize: number; windowDays: number } | null;
}

export interface RestroomDetail extends NearbyRestroom {
	confidenceFactors: ConfidenceFactor[];
	recentReports: Report[];
	/** Hour-bucketed availability for the last 24h, oldest first. Powers the timeline strip. */
	timeline: TimelineBucket[];
}

export interface TimelineBucket {
	/** ISO timestamp of the start of the bucket. */
	bucket: string;
	positive: number;
	negative: number;
}

export interface Filters {
	wheelchair: boolean;
	changingTable: boolean;
	noPurchase: boolean;
	recentlyConfirmed: boolean;
	publicOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
	wheelchair: false,
	changingTable: false,
	noPurchase: false,
	recentlyConfirmed: false,
	publicOnly: false
};

/** Human labels for report statuses, used in the report flow and the timeline. */
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
	accessible: 'Accessible',
	locked: 'Locked',
	closed: 'Closed',
	customer_only: 'Customer only',
	out_of_service: 'Out of service',
	not_found: "Couldn't find it",
	other: 'Other issue'
};

export const SOURCE_LABEL: Record<SourceId, string> = {
	gsu: 'Georgia State University restroom audit',
	osm: 'OpenStreetMap',
	marta: 'MARTA',
	coa: 'City of Atlanta',
	throne: 'Throne',
	community: 'Community submitted'
};

export const SOURCE_SHORT: Record<SourceId, string> = {
	gsu: 'GSU audit',
	osm: 'OpenStreetMap',
	marta: 'MARTA',
	coa: 'City of Atlanta',
	throne: 'Throne',
	community: 'Community'
};
