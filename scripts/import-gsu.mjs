/**
 * Import the GSU / OSF public restroom dataset into Relief ATL's schema.
 *
 *   node scripts/import-gsu.mjs              # normalise using the cached place names
 *   node scripts/import-gsu.mjs --geocode    # also reverse-geocode any new coordinates
 *
 * Source: https://osf.io/fm9by  (archive committed under static/)
 * Paper:  https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574
 *
 * Output: src/lib/server/data/gsu-restrooms.json: committed to the repo so the
 * app never touches OSF at runtime, and the demo works with no network at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { normalizeGsuRows } from './lib/normalize-gsu.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = path.join(root, 'static/fm9by-osfstorage-archive/Full dataset.xlsx');
const CACHE_PATH = path.join(root, 'scripts/cache/place-names.json');
const OUT_PATH = path.join(root, 'src/lib/server/data/gsu-restrooms.json');

const shouldGeocode = process.argv.includes('--geocode');
const USER_AGENT = 'ReliefATL/1.0 (Atlanta civic-tech restroom finder; https://osf.io/fm9by)';

function readCache() {
	try {
		return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
	} catch {
		return {};
	}
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, '\t') + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull a human place name + street address out of a Nominatim reverse result. */
function extractPlace(data) {
	const a = data?.address ?? {};
	const candidates = [
		data?.name,
		a.amenity,
		a.building,
		a.shop,
		a.leisure,
		a.tourism,
		a.office,
		a.public_building,
		a.college,
		a.university,
		a.railway
	];
	const name = candidates.find((v) => typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim()));

	const street = [a.house_number, a.road].filter(Boolean).join(' ');
	const city = a.city || a.town || a.village || a.suburb || a.neighbourhood;
	const address = [street, city, a.state === 'Georgia' ? 'GA' : a.state].filter(Boolean).join(', ');

	return { name: name?.trim() || null, address: address || null };
}

async function reverseGeocode(latitude, longitude) {
	const url = new URL('https://nominatim.openstreetmap.org/reverse');
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('lat', String(latitude));
	url.searchParams.set('lon', String(longitude));
	url.searchParams.set('zoom', '18');
	url.searchParams.set('addressdetails', '1');

	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
	if (!res.ok) throw new Error(`Nominatim ${res.status}`);
	return extractPlace(await res.json());
}

async function main() {
	if (!fs.existsSync(XLSX_PATH)) {
		console.error(`Dataset not found at ${XLSX_PATH}`);
		console.error('Download the OSF archive from https://osf.io/fm9by into static/.');
		process.exit(1);
	}

	const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
	const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
	console.log(`Read ${rows.length} audit rows from "${wb.SheetNames[0]}"`);

	const cache = readCache();

	if (shouldGeocode) {
		// Discover the distinct coordinates first so we only make one request each.
		const { restrooms: preview } = normalizeGsuRows(rows, {});
		const pending = preview.filter((r) => !cache[r.sourceMetadata.gps]);
		console.log(`Reverse-geocoding ${pending.length} new coordinates (Nominatim, 1 req/s)…`);

		let done = 0;
		for (const record of pending) {
			const key = record.sourceMetadata.gps;
			try {
				cache[key] = await reverseGeocode(record.latitude, record.longitude);
			} catch (error) {
				console.warn(`  ! ${key}: ${error.message}`);
				cache[key] = { name: null, address: null };
			}
			done++;
			if (done % 10 === 0 || done === pending.length) {
				console.log(`  ${done}/${pending.length}`);
				writeJson(CACHE_PATH, cache);
			}
			await sleep(1100); // Nominatim usage policy: max 1 request per second.
		}
		writeJson(CACHE_PATH, cache);
	}

	const { restrooms, skipped, groupCount } = normalizeGsuRows(rows, cache);

	console.log(`\nDistinct GPS locations: ${groupCount}`);
	console.log(`Normalised restrooms:   ${restrooms.length}`);
	if (skipped.length) console.warn(`Skipped (unparseable GPS): ${skipped.length}`);

	const named = restrooms.filter((r) => cache[r.sourceMetadata.gps]?.name).length;
	const addressed = restrooms.filter((r) => r.address).length;
	console.log(`With a reverse-geocoded name: ${named}/${restrooms.length}`);
	console.log(`With a street address:        ${addressed}/${restrooms.length}`);

	const areas = new Set(restrooms.map((r) => r.sourceMetadata.studyArea));
	const dates = restrooms
		.map((r) => r.originalAuditDate)
		.filter(Boolean)
		.sort();
	console.log(`Study areas: ${areas.size}`);
	console.log(`Audit window: ${dates[0]?.slice(0, 10)} → ${dates[dates.length - 1]?.slice(0, 10)}`);

	const tally = (predicate) => restrooms.filter(predicate).length;
	console.log(`\nAttribute coverage:`);
	console.log(`  wheelchair accessible : ${tally((r) => r.wheelchairAccessible === true)}`);
	console.log(`  changing table        : ${tally((r) => r.changingTable === true)}`);
	console.log(`  officially public     : ${tally((r) => r.officiallyPublic === true)}`);
	console.log(`  purchase required     : ${tally((r) => r.purchaseRequired === true)}`);
	console.log(`  permission required   : ${tally((r) => r.permissionRequired === true)}`);
	console.log(`  gate or turnstile     : ${tally((r) => r.gateOrTurnstile === true)}`);
	console.log(`  open 24h              : ${tally((r) => r.open24h === true)}`);
	console.log(`  posted hours known    : ${tally((r) => !!r.openingHours)}`);

	writeJson(OUT_PATH, restrooms);
	console.log(`\nWrote ${restrooms.length} records → ${path.relative(root, OUT_PATH)}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
