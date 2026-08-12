/**
 * Second pass at naming GSU audit locations.
 *
 * Nominatim's reverse geocoder names ~2/3 of the audited coordinates. For the
 * rest (restrooms inside parks, transit stations and campuses, where the point
 * sits between buildings) we ask Overpass for the nearest *named* feature and
 * take that, preferring real places over roads.
 *
 * Results are merged into scripts/cache/place-names.json. Re-run
 * `node scripts/import-gsu.mjs` afterwards to apply them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = path.join(root, 'scripts/cache/place-names.json');
const GSU_PATH = path.join(root, 'src/lib/server/data/gsu-restrooms.json');

const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

/** Tag families worth naming a restroom after, best first. */
const PREFERRED = [
	'leisure',
	'tourism',
	'amenity',
	'railway',
	'public_transport',
	'shop',
	'office',
	'historic',
	'building'
];

/**
 * Features that are named but are not places you walk into: statues, murals,
 * rail corridors, bus routes. Naming a restroom after them would be worse than
 * the honest generic fallback.
 */
function isNotAPlace(el) {
	const t = el.tags ?? {};
	if (t.tourism === 'artwork' || t.artwork_type || t.historic === 'memorial') return true;
	if (t.type === 'route' || t.route) return true;
	if (t.man_made && !t.building) return true;
	if (t.natural || t.waterway) return true;
	// Rail/road corridors are ways with no area and no building.
	if ((t.railway === 'rail' || t.railway === 'subway' || t.railway === 'light_rail') && !t.building)
		return true;
	if (t.power || t.barrier) return true;
	return false;
}

/**
 * Does this OSM feature look like the kind of facility the auditors recorded?
 * A type match is worth far more than raw proximity.
 */
function matchesFacility(facilityType, t) {
	const shop = Boolean(t.shop);
	switch (facilityType) {
		case 'Transit station':
			return (
				t.railway === 'station' || t.public_transport === 'station' || t.amenity === 'bus_station'
			);
		case 'Library':
			return t.amenity === 'library';
		case 'University building':
			return t.amenity === 'university' || t.amenity === 'college' || t.building === 'university';
		case 'Park or recreation center':
			return (
				['park', 'sports_centre', 'recreation_ground', 'fitness_centre', 'playground'].includes(
					t.leisure
				) || t.amenity === 'community_centre'
			);
		case 'Restaurant or coffee shop':
			return ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court'].includes(t.amenity);
		case 'Retail store':
		case 'Market':
			return shop;
		case 'Grocery or convenience store':
			return ['supermarket', 'convenience', 'greengrocer', 'general'].includes(t.shop);
		case 'Pharmacy':
			return t.amenity === 'pharmacy' || t.shop === 'chemist';
		case 'Shopping mall':
			return t.shop === 'mall' || t.building === 'retail';
		case 'Health facility or clinic':
			return ['clinic', 'hospital', 'doctors', 'health_post'].includes(t.amenity);
		case 'Government building':
			return t.office === 'government' || t.amenity === 'townhall' || t.building === 'government';
		case 'Place of worship':
			return t.amenity === 'place_of_worship';
		case 'Tourist attraction':
			return Boolean(t.tourism) || Boolean(t.historic);
		case 'Gas station':
			return t.amenity === 'fuel';
		default:
			return false;
	}
}

const haversine = (a, b) => {
	const toRad = (d) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
	return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

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

function score(tags) {
	// Roads and address-only nodes make poor restroom names.
	if (tags.highway && !['pedestrian', 'services', 'rest_area'].includes(tags.highway)) return -1;
	if (tags.boundary || tags.landuse === 'residential') return -1;
	if (tags.building === 'yes' && !tags.amenity && !tags.shop && !tags.office) return 0.5;
	for (let i = 0; i < PREFERRED.length; i++) {
		if (tags[PREFERRED[i]]) return PREFERRED.length - i + 1;
	}
	return 0;
}

async function main() {
	const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
	const restrooms = JSON.parse(fs.readFileSync(GSU_PATH, 'utf8'));

	// Overpass-derived names are recomputed every run; Nominatim names are kept.
	for (const entry of Object.values(cache)) {
		if (entry?.nameSource?.startsWith('openstreetmap')) {
			entry.name = null;
			delete entry.nameSource;
		}
	}

	const pending = restrooms.filter((r) => !cache[r.sourceMetadata.gps]?.name);
	if (!pending.length) {
		console.log('Every location already has a name. Nothing to do.');
		return;
	}
	console.log(`Looking up ${pending.length} unnamed locations via Overpass…`);

	const RADIUS = 70;
	const clauses = pending
		.map((r) => `  nwr(around:${RADIUS},${r.latitude},${r.longitude})["name"];`)
		.join('\n');
	const data = await overpass(`[out:json][timeout:180];\n(\n${clauses}\n);\nout center tags;`);

	const features = (data.elements ?? [])
		.map((el) => {
			const lat = el.lat ?? el.center?.lat;
			const lon = el.lon ?? el.center?.lon;
			if (lat === undefined || lon === undefined || !el.tags?.name) return null;
			if (isNotAPlace(el)) return null;
			return { lat, lon, name: String(el.tags.name).trim(), tags: el.tags, rank: score(el.tags) };
		})
		.filter((f) => f && f.rank > 0);
	console.log(`Overpass returned ${features.length} usable named features.`);

	/** Without a facility-type match we only trust a very close feature. */
	const UNMATCHED_RADIUS = 30;

	let resolved = 0;
	for (const restroom of pending) {
		const here = { lat: restroom.latitude, lon: restroom.longitude };
		const best = features
			.map((f) => ({
				...f,
				distance: haversine(here, f),
				affinity: matchesFacility(restroom.locationType, f.tags)
			}))
			.filter((f) => f.distance <= (f.affinity ? RADIUS : UNMATCHED_RADIUS))
			// A feature of the right kind beats a closer feature of the wrong kind.
			.sort(
				(a, b) =>
					Number(b.affinity) - Number(a.affinity) || b.rank - a.rank || a.distance - b.distance
			)[0];

		if (!best) continue;
		const key = restroom.sourceMetadata.gps;
		cache[key] = {
			...(cache[key] ?? {}),
			name: best.name,
			nameSource: `openstreetmap (${Math.round(best.distance)} m)`
		};
		resolved++;
		console.log(
			`  ${best.affinity ? '✓' : '~'} ${best.name}  ←  ${restroom.locationType}  (${Math.round(best.distance)} m)`
		);
	}

	fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, '\t') + '\n');
	console.log(`\nNamed ${resolved}/${pending.length}. Re-run: node scripts/import-gsu.mjs`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
