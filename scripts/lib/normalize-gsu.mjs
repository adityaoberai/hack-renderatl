/**
 * Normalises the GSU / OSF "Full dataset.xlsx" into the Relief ATL schema.
 *
 * The published file contains 207 individual restroom audits at 117 distinct
 * locations — these are the locations where researchers found an accessible
 * restroom. (The study screened 262 candidate locations in total; the other 145
 * had no usable restroom and therefore have no audit rows.)
 *
 * Relief ATL is a location-finder, so we roll the per-restroom audits up to one
 * record per physical location, keeping every original row in `source_metadata`.
 *
 * Variable meanings were verified against the published paper:
 *   Permiss  — staff permission needed (91/117 locations = 77.8% need none,
 *              which reproduces Table 1 of the paper exactly)
 *   Code     — follow-up asked only when Permiss = Yes: is it a code/key lock?
 *   Access   — entry via a gate, turnstile or security checkpoint
 *   Pref     — auditor judged access was discretionary / they may have been refused
 *   Hrs      — open 24 hours a day, 7 days a week?  (Hrs_desc holds posted hours)
 *   Fac_pubpriv — publicly funded/managed facility vs. private
 */

import { createHash } from 'node:crypto';

export const OSF_URL = 'https://osf.io/fm9by';
export const PAPER_URL = 'https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574';

/** Fixed namespace so re-running the importer produces identical ids. */
const NAMESPACE = 'b6bfe1c4-8a1a-4f0e-9e6a-1a2b3c4d5e6f';

export function uuidv5(name, namespace = NAMESPACE) {
	const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
	const hash = createHash('sha1')
		.update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')]))
		.digest();
	const bytes = Buffer.from(hash.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const FACILITY_TYPE = {
	University: 'University building',
	'Restaurant or Coffee Shop (fast food, chain)': 'Restaurant or coffee shop',
	'Park or Recreation Center': 'Park or recreation center',
	'Retail Store (e.g., Home Depot, Target)': 'Retail store',
	'Tourist Attraction': 'Tourist attraction',
	'Grocery Store or Convenience Store': 'Grocery or convenience store',
	'Government Building': 'Government building',
	'Health Facility or Clinic': 'Health facility or clinic',
	Library: 'Library',
	'Shopping Mall or Multi-Purpose Building': 'Shopping mall',
	'Transit Station': 'Transit station',
	Pharmacy: 'Pharmacy',
	'Church, Mosque, or other religious building': 'Place of worship',
	'Gas Station': 'Gas station',
	Market: 'Market'
};

const yes = (v) => v === 'Yes';
const num = (v) => (typeof v === 'number' ? v : v === null || v === '' ? null : Number(v));

/** true if any row says yes; false if at least one row answered and none said yes; null if nobody answered. */
function anyYes(rows, column, positive = yes) {
	let answered = false;
	for (const r of rows) {
		const v = r[column];
		if (v === null || v === '' || /^Don't know/i.test(String(v))) continue;
		answered = true;
		if (positive(v)) return true;
	}
	return answered ? false : null;
}

/** true if any row reports a positive count; false if every answered row is zero. */
function anyPositiveCount(rows, columns) {
	let answered = false;
	for (const r of rows) {
		for (const c of columns) {
			const v = num(r[c]);
			if (v === null || Number.isNaN(v)) continue;
			answered = true;
			if (v > 0) return true;
		}
	}
	return answered ? false : null;
}

function sumCount(rows, column) {
	let total = null;
	for (const r of rows) {
		const v = num(r[column]);
		if (v === null || Number.isNaN(v)) continue;
		total = (total ?? 0) + v;
	}
	return total;
}

function mostCommon(values) {
	const counts = new Map();
	for (const v of values) {
		if (v === null || v === undefined || v === '') continue;
		counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	if (!counts.size) return null;
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function parseGps(raw) {
	const m = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/.exec(String(raw ?? ''));
	if (!m) return null;
	const latitude = Number(m[1]);
	const longitude = Number(m[2]);
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	return { latitude, longitude };
}

function toIso(value) {
	if (!value) return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Restroom-type flags come from `Type` (facility level) and `Toil_typ` (row level). */
function restroomTypes(rows) {
	const codes = new Set();
	for (const r of rows) {
		for (const t of String(r.Type ?? '').split(',')) {
			const code = t.trim();
			if (code) codes.add(code);
		}
	}
	return {
		womens: codes.has('TypeW'),
		mens: codes.has('TypeM'),
		/** Explicitly signed as gender-neutral. */
		genderNeutral: codes.has('TypeGN'),
		/** Family room or simply unlabeled — usable by anyone in practice. */
		familyOrUnlabeled: codes.has('TypeN')
	};
}

/**
 * Turn one GPS group into a Relief ATL restroom record.
 * `names` is an optional { [gpsKey]: { name, address } } lookup from reverse geocoding.
 */
export function normalizeLocation(gpsKey, rows, names = {}) {
	const coords = parseGps(gpsKey);
	if (!coords) return null;

	const first = rows[0];
	const studyArea = first.Site ?? null;
	const rawFacilityType = first.Fac_loc ?? null;
	const facilityType =
		FACILITY_TYPE[rawFacilityType] ??
		mostCommon(rows.map((r) => r.Fac_loc_17_TEXT)) ??
		rawFacilityType;

	const auditDates = rows
		.map((r) => toIso(r['RecordedDate.meta']))
		.filter(Boolean)
		.sort();
	const auditDate = auditDates[0] ?? null;

	const types = restroomTypes(rows);

	// Access restrictions. `Code` is only asked when `Permiss` is Yes.
	const permissionRequired = anyYes(rows, 'Permiss');
	const codeOrKeyRequired = anyYes(rows, 'Code');
	const gateOrTurnstile = anyYes(rows, 'Access');
	const discretionaryAccess = anyYes(rows, 'Pref');
	const purchaseRequired = anyYes(rows, 'Purchase');

	// Wheelchair access needs both an ADA stall and room to manoeuvre.
	let wheelchairAccessible = null;
	{
		let answered = false;
		for (const r of rows) {
			const ada = r.ADA;
			const chair = r.Whlchair;
			if ((ada === 'Yes' || ada === 'No') && (chair === 'Yes' || chair === 'No')) {
				answered = true;
				if (ada === 'Yes' && chair === 'Yes') {
					wheelchairAccessible = true;
					break;
				}
			}
		}
		if (wheelchairAccessible === null && answered) wheelchairAccessible = false;
	}

	const open24h = anyYes(rows, 'Hrs');
	const postedHours = mostCommon(
		rows.map((r) =>
			typeof r.Hrs_desc === 'string' && !/^don'?t know$/i.test(r.Hrs_desc.trim())
				? r.Hrs_desc.trim()
				: null
		)
	);

	const geo = names[gpsKey] ?? {};
	const fallbackName = studyArea
		? `${facilityType ?? 'Public restroom'} · ${studyArea.replace(/\s*\(.*\)\s*$/, '')}`
		: (facilityType ?? 'Public restroom');

	const notes = [
		...new Set(
			rows
				.flatMap((r) => [r.Descrp, r.Pref_exp, r.Notes, r.Str_note, r.Stall_note])
				.filter((n) => typeof n === 'string' && n.trim())
				.map((n) => n.trim())
		)
	];

	return {
		id: uuidv5(`gsu:${gpsKey}`),
		name: geo.name || fallbackName,
		latitude: coords.latitude,
		longitude: coords.longitude,
		address: geo.address ?? null,

		source: 'gsu',
		sourceId: `gsu:${coords.latitude.toFixed(7)},${coords.longitude.toFixed(7)}`,
		sourceUrl: OSF_URL,

		locationType: facilityType,

		officiallyPublic: anyYes(rows, 'Fac_pubpriv', (v) => /^Public facility/i.test(String(v))),
		purchaseRequired,
		permissionRequired,
		codeOrKeyRequired,
		gateOrTurnstile,

		wheelchairAccessible,
		genderNeutral: types.genderNeutral ? true : types.womens || types.mens ? false : null,
		changingTable: anyYes(rows, 'baby'),

		soapAvailable: anyPositiveCount(rows, ['soap_disp', 'soap_bar']),
		toiletPaperAvailable: anyPositiveCount(rows, ['Paper']),
		waterAvailable: anyYes(rows, 'water_in'),

		openingHours: open24h ? 'Open 24 hours' : postedHours,
		open24h,

		// Every location in this file is one of the 117 where researchers found
		// and used an accessible restroom.
		historicallyAccessible: true,

		originalAuditDate: auditDate,
		lastSourceVerifiedAt: auditDate,

		sourceMetadata: {
			dataset: 'GSU / OSF public bathroom audit (Atlanta, Feb–Apr 2025)',
			osfUrl: OSF_URL,
			paperUrl: PAPER_URL,
			studyArea,
			rawFacilityType,
			standalone: first.Fac_alone === 'Standalone',
			gps: gpsKey,
			restroomsAudited: rows.length,
			restroomTypes: types,
			discretionaryAccess,
			feeRequired: anyYes(rows, 'Fee'),
			signageToRestroom: anyYes(rows, 'T_sign'),
			postedHours,
			totalStalls: sumCount(rows, 'Stalls'),
			totalUrinals: sumCount(rows, 'Urinal'),
			totalSinks: sumCount(rows, 'sink'),
			functionalSinks: sumCount(rows, 'sink_func'),
			grabRails: anyYes(rows, 'Rails'),
			automaticDoor: anyYes(rows, 'auto_open'),
			adaRouteToFacility: anyYes(rows, 'ADA_main'),
			handSanitizer: anyPositiveCount(rows, ['sanitizer']),
			paperTowels: anyYes(rows, 'towel_dry', (v) => /^Yes, and they are stocked/i.test(String(v))),
			handDryer: anyYes(rows, 'hand_dry', (v) =>
				/^Yes, at least one is functional/i.test(String(v))
			),
			mirror: anyYes(rows, 'mirror'),
			menstrualProducts: anyYes(rows, 'mhm_prod', (v) =>
				/^Yes, and they are stocked/i.test(String(v))
			),
			menstrualDisposal: anyYes(rows, 'MHM_Disp'),
			waterFountain: anyYes(rows, 'fountain', (v) => /^Yes and it is functional/i.test(String(v))),
			shower: anyYes(rows, 'bathe', (v) => /^Yes and it is functional/i.test(String(v))),
			babyChanging: anyYes(rows, 'baby'),
			securityCamera: anyYes(rows, 'camera'),
			stallCondition: mostCommon(rows.map((r) => r.Condition)),
			floorCondition: mostCommon(rows.map((r) => r.floor)),
			odor: mostCommon(rows.map((r) => r.odor)),
			privacy: mostCommon(rows.map((r) => r.wall)),
			auditorNotes: notes,
			audits: rows.map((r) => ({
				recordedAt: toIso(r['RecordedDate.meta']),
				restroom: r.Toil_typ,
				occupancy: r.Occ_typ,
				stalls: num(r.Stalls),
				adaStall: r.ADA,
				wheelchairTurning: r.Whlchair,
				stallsWithPaper: num(r.Paper),
				soapDispensers: num(r.soap_disp),
				sinks: num(r.sink),
				changingTable: r.baby,
				condition: r.Condition
			})),
			raw: rows
		}
	};
}

/** Group the sheet by GPS and normalise every location. */
export function normalizeGsuRows(rows, names = {}) {
	const groups = new Map();
	for (const row of rows) {
		const key = String(row.GPS ?? '').trim();
		if (!key) continue;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}

	const out = [];
	const skipped = [];
	for (const [key, group] of groups) {
		const record = normalizeLocation(key, group, names);
		if (record) out.push(record);
		else skipped.push(key);
	}
	// Stable order: north-to-south keeps diffs readable between runs.
	out.sort((a, b) => b.latitude - a.latitude || a.longitude - b.longitude);
	return { restrooms: out, skipped, groupCount: groups.size };
}
