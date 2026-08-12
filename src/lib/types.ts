export type RestroomSource = 'gsu' | 'osm' | 'marta' | 'atlanta' | 'throne' | 'community';

export type ReportStatus =
	'accessible' | 'locked' | 'closed' | 'customer_only' | 'out_of_service' | 'not_found' | 'other';

export type AvailabilityStatus = 'confirmed' | 'likely' | 'uncertain' | 'unavailable';

export interface Restroom {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	address: string | null;
	source: RestroomSource;
	sourceId: string | null;
	sourceUrl: string | null;
	locationType: string | null;
	officiallyPublic: boolean | null;
	purchaseRequired: boolean | null;
	wheelchairAccessible: boolean | null;
	genderNeutral: boolean | null;
	changingTable: boolean | null;
	soapAvailable: boolean | null;
	toiletPaperAvailable: boolean | null;
	waterAvailable: boolean | null;
	openingHours: string | null;
	historicallyAccessible: boolean | null;
	originalAuditDate: string | null;
	lastSourceVerifiedAt: string | null;
	sourceMetadata: Record<string, unknown>;
}

export interface RestroomReport {
	id: string;
	restroomId: string;
	status: ReportStatus;
	createdAt: string;
	metadata: Record<string, unknown> | null;
}

export interface AccessConfidence {
	score: number;
	status: AvailabilityStatus;
	reason: string;
	lastConfirmedAt: string | null;
	lastReportedAt: string | null;
	reliability: number | null;
	reportCount: number;
}

export interface NearbyRestroom {
	restroom: Restroom;
	distanceMeters: number;
	estimatedWalkingMinutes: number;
	confidence: AccessConfidence;
	recentReports: RestroomReport[];
}

export interface RestroomFilters {
	wheelchairAccessible?: boolean;
	changingTable?: boolean;
	noPurchaseRequired?: boolean;
	recentlyConfirmed?: boolean;
	publicOnly?: boolean;
}

export interface Coordinates {
	latitude: number;
	longitude: number;
}
