/**
 * Secondary source: OpenStreetMap `amenity=toilets` across metro Atlanta.
 *
 *   node scripts/fetch-osm.mjs
 *
 * These records expand coverage beyond the 15 areas the GSU researchers walked,
 * but they carry a fundamentally weaker claim. Nobody physically checked them,
 * so `historically_accessible` stays NULL and the app renders them as
 * "no recent verification" until a real community report arrives.
 *
 * Where an OSM toilet sits on top of a GSU-audited location we keep the GSU
 * record — a physical audit beats a map listing — and cross-reference the OSM
 * id inside the GSU record's provenance rather than throwing it away.
 *
 * Output: src/lib/server/data/osm-restrooms.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuidv5 } from './lib/normalize-gsu.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GSU_PATH = path.join(root, 'src/lib/server/data/gsu-restrooms.json');
const OUT_PATH = path.join(root, 'src/lib/server/data/osm-restrooms.json');

const BBOX = { south: 33.62, west: -84.56, north: 33.89, east: -84.24 };
/** An OSM toilet this close to an audited location is the same restroom. */
const DEDUPE_METERS = 45;

const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

const haversine = (a, b) => {
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
	return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** OSM yes/no/limited → boolean | null. "Unknown" must never become "no". */
function tri(value, { limitedIsTrue = false } = {}) {
	if (value === undefined || value === null) return null;
	const v = String(value).toLowerCase();
	if (['yes', 'designated', 'official', 'public', 'true'].includes(v)) return true;
	if (['no', 'private', 'false'].includes(v)) return false;
	if (v === 'limited') return limitedIsTrue ? true : false;
	return null;
}

async function overpass(query) {
	let lastError;
	for (const endpoint of ENDPOINTS) {
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'ReliefATL/1.0 (Atlanta civic-tech restroom finder)'
				},
				body: new URLSearchParams({ data: query })
			});
			if (!res.ok) throw new Error(`${endpoint} → ${res.status}`);
			return await res.json();
		} catch (error) {
			lastError = error;
			console.warn(`  ! ${error.message}`);
		}
	}
	throw lastError;
}

function toRestroom(element) {
	const lat = element.lat ?? element.center?.lat;
	const lon = element.lon ?? element.center?.lon;
	if (lat === undefined || lon === undefined) return null;

	const t = element.tags ?? {};
	const osmId = `${element.type}/${element.id}`;

	// `access` carries the strongest signal about who may use it.
	const access = String(t.access ?? '').toLowerCase();
	const customersOnly = access === 'customers' || t['toilets:access'] === 'customers';
	const feeRequired = tri(t.fee);

	const name =
		t.name?.trim() ||
		(t.operator ? `Public restroom · ${t.operator.trim()}` : null) ||
		'Public restroom';

	return {
		id: uuidv5(`osm:${osmId}`),
		name,
		latitude: lat,
		longitude: lon,
		address:
			[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || t['addr:city'] || null,

		source: 'osm',
		sourceId: osmId,
		sourceUrl: `https://www.openstreetmap.org/${osmId}`,

		locationType: t.building || t.amenity === 'toilets' ? 'Dedicated public restroom' : null,

		officiallyPublic: access ? tri(access) : null,
		// Fee or customers-only both mean "you have to spend money to get in".
		purchaseRequired: customersOnly ? true : feeRequired,
		permissionRequired: access === 'permissive' ? true : null,
		codeOrKeyRequired: tri(t['toilets:code'] ?? t.code) ?? null,
		gateOrTurnstile: null,

		wheelchairAccessible: tri(t.wheelchair ?? t['toilets:wheelchair']),
		genderNeutral: tri(t.unisex) ?? (t.gender === 'unisex' ? true : null),
		changingTable: tri(t.changing_table ?? t['diaper']),

		soapAvailable: tri(t['toilets:soap']),
		toiletPaperAvailable: tri(t['toilets:paper_supplied'] ?? t.toilets_paper),
		waterAvailable: tri(t['toilets:handwashing'] ?? t.handwashing),

		openingHours: t.opening_hours ?? null,
		open24h: t.opening_hours === '24/7' ? true : null,

		// The whole point: an OSM listing is not a verification.
		historicallyAccessible: null,

		originalAuditDate: null,
		lastSourceVerifiedAt: t.check_date ?? t['survey:date'] ?? null,

		sourceMetadata: {
			dataset: 'OpenStreetMap (amenity=toilets)',
			osmId,
			osmUrl: `https://www.openstreetmap.org/${osmId}`,
			operator: t.operator ?? null,
			fee: t.fee ?? null,
			access: t.access ?? null,
			customersOnly: customersOnly || null,
			description: t.description ?? null,
			neverPhysicallyVerified: true,
			tags: t
		}
	};
}

async function main() {
	console.log('Querying Overpass for amenity=toilets across metro Atlanta…');
	const query = `[out:json][timeout:120];
(
  nwr["amenity"="toilets"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out center tags;`;

	const data = await overpass(query);
	const raw = (data.elements ?? []).map(toRestroom).filter(Boolean);
	console.log(`Overpass returned ${raw.length} toilets.`);

	// Drop OSM duplicates of each other (same spot mapped as node + way).
	const deduped = [];
	for (const candidate of raw) {
		const clash = deduped.find(
			(existing) =>
				haversine(
					{ lat: existing.latitude, lon: existing.longitude },
					{ lat: candidate.latitude, lon: candidate.longitude }
				) < 20
		);
		if (clash) continue;
		deduped.push(candidate);
	}
	console.log(`After collapsing OSM-internal duplicates: ${deduped.length}`);

	// Defer to the GSU physical audit wherever the two sources overlap.
	let gsu = [];
	try {
		gsu = JSON.parse(fs.readFileSync(GSU_PATH, 'utf8'));
	} catch {
		console.warn('No GSU dataset found — skipping cross-source dedupe.');
	}

	const kept = [];
	const crossReferences = new Map();
	for (const candidate of deduped) {
		const match = gsu.find(
			(g) =>
				haversine(
					{ lat: g.latitude, lon: g.longitude },
					{ lat: candidate.latitude, lon: candidate.longitude }
				) < DEDUPE_METERS
		);
		if (match) {
			const list = crossReferences.get(match.id) ?? [];
			list.push({
				osmId: candidate.sourceId,
				osmUrl: candidate.sourceUrl,
				name: candidate.name,
				tags: candidate.sourceMetadata.tags
			});
			crossReferences.set(match.id, list);
			continue;
		}
		kept.push(candidate);
	}

	console.log(`Superseded by a GSU audit record: ${deduped.length - kept.length}`);
	console.log(`New OSM-only locations: ${kept.length}`);

	// Preserve the overlap as provenance on the GSU side rather than discarding it.
	if (crossReferences.size && gsu.length) {
		for (const record of gsu) {
			const refs = crossReferences.get(record.id);
			record.sourceMetadata.alsoListedIn = refs ? { openstreetmap: refs } : undefined;
			if (!refs) delete record.sourceMetadata.alsoListedIn;
		}
		fs.writeFileSync(GSU_PATH, JSON.stringify(gsu, null, '\t') + '\n');
		console.log(`Cross-referenced ${crossReferences.size} GSU records with their OSM entries.`);
	}

	const withHours = kept.filter((r) => r.openingHours).length;
	const withWheelchair = kept.filter((r) => r.wheelchairAccessible !== null).length;
	console.log(`\nAttribute coverage (OSM):`);
	console.log(`  named            : ${kept.filter((r) => r.name !== 'Public restroom').length}`);
	console.log(`  opening hours    : ${withHours}`);
	console.log(`  wheelchair known : ${withWheelchair}`);
	console.log(`  changing table   : ${kept.filter((r) => r.changingTable === true).length}`);
	console.log(`  fee / customers  : ${kept.filter((r) => r.purchaseRequired === true).length}`);

	fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
	fs.writeFileSync(OUT_PATH, JSON.stringify(kept, null, '\t') + '\n');
	console.log(`\nWrote ${kept.length} records → ${path.relative(root, OUT_PATH)}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
