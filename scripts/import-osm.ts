import { createHash } from 'node:crypto';
import { Client } from 'pg';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const ATLANTA_BOUNDS = '33.647,-84.55,33.887,-84.289';

interface OsmElement {
	type: 'node' | 'way' | 'relation';
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
	timestamp?: string;
	version?: number;
	changeset?: number;
}

interface OsmResponse {
	elements: OsmElement[];
}

interface OsmRestroom {
	id: string;
	sourceId: string;
	name: string;
	latitude: number;
	longitude: number;
	address: string | null;
	sourceUrl: string;
	officiallyPublic: boolean | null;
	purchaseRequired: boolean | null;
	wheelchairAccessible: boolean | null;
	genderNeutral: boolean | null;
	changingTable: boolean | null;
	openingHours: string | null;
	lastSourceVerifiedAt: string | null;
	metadata: Record<string, unknown>;
}

function stableUuid(sourceId: string): string {
	const bytes = createHash('sha256').update(`relief-atl:osm:${sourceId}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function explicitBoolean(value: string | undefined): boolean | null {
	if (value === 'yes') return true;
	if (value === 'no') return false;
	return null;
}

function address(tags: Record<string, string>): string | null {
	const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
	const locality = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']]
		.filter(Boolean)
		.join(', ');
	const combined = [street, locality].filter(Boolean).join(', ');
	return combined || null;
}

function normalizeElement(element: OsmElement): OsmRestroom | null {
	const latitude = element.lat ?? element.center?.lat;
	const longitude = element.lon ?? element.center?.lon;
	if (
		latitude === undefined ||
		longitude === undefined ||
		latitude < 33.6 ||
		latitude > 33.9 ||
		longitude < -84.55 ||
		longitude > -84.28
	) {
		return null;
	}

	const tags = element.tags ?? {};
	const sourceId = `${element.type}/${element.id}`;
	const access = tags.access?.toLowerCase();
	const fee = tags.fee?.toLowerCase();
	const publiclyAccessible =
		access === 'yes' || access === 'public'
			? true
			: access === 'no' || access === 'private'
				? false
				: null;
	const customerOnly = access === 'customers' || access === 'customer';

	return {
		id: stableUuid(sourceId),
		sourceId,
		name: tags.name?.trim() || 'Unnamed public restroom',
		latitude,
		longitude,
		address: address(tags),
		sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
		officiallyPublic: publiclyAccessible,
		purchaseRequired: customerOnly
			? true
			: publiclyAccessible === true && fee === 'no'
				? false
				: null,
		wheelchairAccessible: explicitBoolean(tags.wheelchair),
		genderNeutral: explicitBoolean(tags.unisex ?? tags['toilets:unisex']),
		changingTable: explicitBoolean(tags.changing_table),
		openingHours: tags.opening_hours?.trim() || null,
		lastSourceVerifiedAt: element.timestamp ?? null,
		metadata: {
			osmType: element.type,
			osmId: element.id,
			osmVersion: element.version,
			osmChangeset: element.changeset,
			nameGenerated: !tags.name,
			tags
		}
	};
}

async function fetchAtlantaRestrooms(): Promise<OsmRestroom[]> {
	const overpassQuery = `
		[out:json][timeout:60][bbox:${ATLANTA_BOUNDS}];
		(
			node["amenity"="toilets"];
			way["amenity"="toilets"];
			relation["amenity"="toilets"];
		);
		out center meta tags;
	`;
	const response = await fetch(OVERPASS_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'User-Agent': 'Relief-ATL-OSM-Importer/1.0'
		},
		body: new URLSearchParams({ data: overpassQuery }),
		signal: AbortSignal.timeout(90_000)
	});
	if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}.`);
	const body = (await response.json()) as OsmResponse;
	return body.elements
		.map(normalizeElement)
		.filter((restroom): restroom is OsmRestroom => restroom !== null);
}

async function importRestrooms(restrooms: OsmRestroom[]): Promise<{
	insertedOrUpdated: number;
	mergedIntoGsu: number;
}> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error('DATABASE_URL is required.');
	const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
	const client = new Client({
		connectionString,
		ssl: isLocal
			? false
			: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
	});
	let insertedOrUpdated = 0;
	let mergedIntoGsu = 0;

	await client.connect();
	try {
		await client.query('BEGIN');
		for (const restroom of restrooms) {
			const nearbyGsu = await client.query<{ id: string }>(
				`SELECT id
				 FROM restrooms
				 WHERE source = 'gsu'
				   AND ABS(latitude - $1) < 0.00045
				   AND ABS(longitude - $2) < 0.00055
				 ORDER BY
				   POWER(latitude - $1, 2) + POWER(longitude - $2, 2)
				 LIMIT 1`,
				[restroom.latitude, restroom.longitude]
			);

			if (nearbyGsu.rows[0]) {
				await client.query(
					`UPDATE restrooms
					 SET source_metadata =
					   source_metadata ||
					   jsonb_build_object(
					     'additional_sources',
					     COALESCE(source_metadata -> 'additional_sources', '{}'::jsonb) ||
					     jsonb_build_object('osm', $2::jsonb)
					   )
					 WHERE id = $1`,
					[nearbyGsu.rows[0].id, JSON.stringify(restroom.metadata)]
				);
				mergedIntoGsu += 1;
				continue;
			}

			await client.query(
				`INSERT INTO restrooms (
					id, name, latitude, longitude, address, source, source_id, source_url,
					location_type, officially_public, purchase_required, wheelchair_accessible,
					gender_neutral, changing_table, opening_hours, historically_accessible,
					last_source_verified_at, source_metadata
				) VALUES (
					$1, $2, $3, $4, $5, 'osm', $6, $7, 'Dedicated public restroom',
					$8, $9, $10, $11, $12, $13, NULL, $14, $15::jsonb
				)
				ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
				DO UPDATE SET
					name = EXCLUDED.name,
					latitude = EXCLUDED.latitude,
					longitude = EXCLUDED.longitude,
					address = EXCLUDED.address,
					source_url = EXCLUDED.source_url,
					officially_public = EXCLUDED.officially_public,
					purchase_required = EXCLUDED.purchase_required,
					wheelchair_accessible = EXCLUDED.wheelchair_accessible,
					gender_neutral = EXCLUDED.gender_neutral,
					changing_table = EXCLUDED.changing_table,
					opening_hours = EXCLUDED.opening_hours,
					last_source_verified_at = EXCLUDED.last_source_verified_at,
					source_metadata = EXCLUDED.source_metadata`,
				[
					restroom.id,
					restroom.name,
					restroom.latitude,
					restroom.longitude,
					restroom.address,
					restroom.sourceId,
					restroom.sourceUrl,
					restroom.officiallyPublic,
					restroom.purchaseRequired,
					restroom.wheelchairAccessible,
					restroom.genderNeutral,
					restroom.changingTable,
					restroom.openingHours,
					restroom.lastSourceVerifiedAt,
					JSON.stringify(restroom.metadata)
				]
			);
			insertedOrUpdated += 1;
		}
		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		await client.end();
	}

	return { insertedOrUpdated, mergedIntoGsu };
}

const restrooms = await fetchAtlantaRestrooms();
console.log(`Fetched ${restrooms.length} Atlanta amenity=toilets records from OpenStreetMap.`);
const result = await importRestrooms(restrooms);
console.log(
	`Imported or updated ${result.insertedOrUpdated} OSM records; preserved OSM provenance on ${result.mergedIntoGsu} nearby GSU records.`
);
