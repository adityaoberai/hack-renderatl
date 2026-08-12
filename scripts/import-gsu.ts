import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { Client } from 'pg';

const OSF_FILES_API = 'https://api.osf.io/v2/nodes/fm9by/files/osfstorage/';
const PAPER_URL = 'https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574';
const OSF_URL = 'https://osf.io/fm9by';

type RawValue = string | number | boolean | Date | null;
type RawRecord = Record<string, RawValue>;

interface OsfFile {
	name: string;
	downloadUrl: string;
}

interface OsfApiItem {
	attributes: {
		kind: 'file' | 'folder';
		name: string;
	};
	links: {
		download?: string;
		files?: string;
	};
}

interface OsfApiResponse {
	data: OsfApiItem[];
	links: { next: string | null };
}

interface ParsedFile {
	file: OsfFile;
	records: RawRecord[];
	headers: string[];
}

interface NormalizedRestroom {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	address: string | null;
	source: 'gsu';
	sourceId: string;
	sourceUrl: string;
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

const HEADER_ALIASES = {
	id: ['locationid', 'location_id', 'siteid', 'site_id', 'recordid', 'record_id', 'id'],
	name: [
		'locationname',
		'location_name',
		'sitename',
		'site_name',
		'facilityname',
		'facility_name',
		'businessname',
		'business_name',
		'name'
	],
	latitude: ['latitude', 'lat', 'y', 'gpslatitude', 'gps_latitude'],
	longitude: ['longitude', 'lon', 'lng', 'long', 'x', 'gpslongitude', 'gps_longitude'],
	address: ['address', 'streetaddress', 'street_address', 'locationaddress', 'location_address'],
	locationType: [
		'locationtype',
		'location_type',
		'sitetype',
		'site_type',
		'facilitytype',
		'facility_type'
	],
	public: [
		'public',
		'publicaccess',
		'public_access',
		'officiallypublic',
		'officially_public',
		'governmentfunded',
		'government_funded'
	],
	funding: ['fundingtype', 'funding_type', 'ownership', 'ownertype', 'owner_type'],
	purchase: [
		'purchaserequired',
		'purchase_required',
		'customeronly',
		'customer_only',
		'paymentrequired',
		'payment_required'
	],
	wheelchair: [
		'wheelchairaccessible',
		'wheelchair_accessible',
		'adaaccessible',
		'ada_accessible',
		'ada'
	],
	genderNeutral: ['genderneutral', 'gender_neutral', 'unisex', 'allgender', 'all_gender'],
	changingTable: [
		'changingtable',
		'changing_table',
		'babychanging',
		'baby_changing',
		'changingstation',
		'changing_station'
	],
	soap: ['soap', 'soapavailable', 'soap_available'],
	toiletPaper: ['toiletpaper', 'toilet_paper', 'toiletpaperavailable', 'toilet_paper_available'],
	water: [
		'wateravailable',
		'water_available',
		'runningwater',
		'running_water'
	],
	hours: ['openinghours', 'opening_hours', 'hours', 'hoursofoperation', 'hours_of_operation'],
	accessible: [
		'restroomavailable',
		'restroom_available',
		'bathroomavailable',
		'bathroom_available',
		'accessiblestatus',
		'accessibility_status',
		'accessible'
	],
	auditDate: [
		'auditdate',
		'audit_date',
		'visitdate',
		'visit_date',
		'observationdate',
		'observation_date',
		'date'
	]
} as const;

function normalizeHeader(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellValue(record: RawRecord, aliases: readonly string[]): RawValue {
	const normalizedAliases = new Set(aliases.map(normalizeHeader));
	for (const [header, value] of Object.entries(record)) {
		if (normalizedAliases.has(normalizeHeader(header))) return value;
	}
	return null;
}

function textValue(value: RawValue): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text.length > 0 ? text : null;
}

function numericValue(value: RawValue): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const text = textValue(value)?.replace(/,/g, '');
	if (!text) return null;
	const number = Number(text);
	return Number.isFinite(number) ? number : null;
}

function booleanValue(value: RawValue): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (value === 1) return true;
		if (value === 0) return false;
		return null;
	}
	const text = textValue(value)?.toLowerCase();
	if (!text) return null;
	if (['yes', 'y', 'true', '1', 'available', 'accessible', 'present'].includes(text)) return true;
	if (
		['no', 'n', 'false', '0', 'unavailable', 'inaccessible', 'not available', 'absent'].includes(
			text
		)
	) {
		return false;
	}
	return null;
}

function accessibilityValue(value: RawValue): boolean | null {
	const direct = booleanValue(value);
	if (direct !== null) return direct;
	const text = textValue(value)?.toLowerCase();
	if (!text) return null;
	if (text.includes('accessible') && !text.includes('inaccessible')) return true;
	if (
		['locked', 'closed', 'customer only', 'purchase required', 'no public bathroom'].some(
			(reason) => text.includes(reason)
		)
	) {
		return false;
	}
	return null;
}

function isoDate(value: RawValue): string | null {
	if (value === null) return null;
	const date =
		value instanceof Date
			? value
			: typeof value === 'number' && value > 20_000 && value < 100_000
				? new Date(Date.UTC(1899, 11, 30 + value))
				: new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableSourceId(record: RawRecord, index: number): string {
	const sourceId = textValue(cellValue(record, HEADER_ALIASES.id));
	if (sourceId) return sourceId;
	const identity = [
		textValue(cellValue(record, HEADER_ALIASES.name)),
		textValue(cellValue(record, HEADER_ALIASES.address)),
		numericValue(cellValue(record, HEADER_ALIASES.latitude)),
		numericValue(cellValue(record, HEADER_ALIASES.longitude)),
		index
	].join('|');
	return `derived-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

function stableUuid(sourceId: string): string {
	const bytes = createHash('sha256').update(`relief-atl:gsu:${sourceId}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function serializeRawRecord(record: RawRecord): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record).map(([header, value]) => [
			header,
			value instanceof Date ? value.toISOString() : value
		])
	);
}

function normalizeRecord(
	record: RawRecord,
	index: number,
	file: OsfFile
): Omit<NormalizedRestroom, 'latitude' | 'longitude'> & {
	latitude: number | null;
	longitude: number | null;
} {
	const sourceId = stableSourceId(record, index);
	const explicitPublic = booleanValue(cellValue(record, HEADER_ALIASES.public));
	const auditDate = isoDate(cellValue(record, HEADER_ALIASES.auditDate));

	return {
		id: stableUuid(sourceId),
		name:
			textValue(cellValue(record, HEADER_ALIASES.name)) ??
			textValue(cellValue(record, HEADER_ALIASES.address)) ??
			'',
		latitude: numericValue(cellValue(record, HEADER_ALIASES.latitude)),
		longitude: numericValue(cellValue(record, HEADER_ALIASES.longitude)),
		address: textValue(cellValue(record, HEADER_ALIASES.address)),
		source: 'gsu',
		sourceId,
		sourceUrl: file.downloadUrl || OSF_URL,
		locationType: textValue(cellValue(record, HEADER_ALIASES.locationType)),
		officiallyPublic: explicitPublic,
		purchaseRequired: booleanValue(cellValue(record, HEADER_ALIASES.purchase)),
		wheelchairAccessible: booleanValue(cellValue(record, HEADER_ALIASES.wheelchair)),
		genderNeutral: booleanValue(cellValue(record, HEADER_ALIASES.genderNeutral)),
		changingTable: booleanValue(cellValue(record, HEADER_ALIASES.changingTable)),
		soapAvailable: booleanValue(cellValue(record, HEADER_ALIASES.soap)),
		toiletPaperAvailable: booleanValue(cellValue(record, HEADER_ALIASES.toiletPaper)),
		waterAvailable: booleanValue(cellValue(record, HEADER_ALIASES.water)),
		openingHours: textValue(cellValue(record, HEADER_ALIASES.hours)),
		historicallyAccessible: accessibilityValue(cellValue(record, HEADER_ALIASES.accessible)),
		originalAuditDate: auditDate,
		lastSourceVerifiedAt: auditDate,
		sourceMetadata: {
			osfProject: OSF_URL,
			paper: PAPER_URL,
			sourceFile: file.name,
			raw: serializeRawRecord(record)
		}
	};
}

async function listOsfFiles(startUrl = OSF_FILES_API): Promise<OsfFile[]> {
	const discovered: OsfFile[] = [];
	let nextUrl: string | null = startUrl;
	while (nextUrl) {
		const response = await fetch(nextUrl, {
			headers: { Accept: 'application/vnd.api+json' },
			signal: AbortSignal.timeout(20_000)
		});
		if (!response.ok) throw new Error(`OSF file listing failed with HTTP ${response.status}.`);
		const page = (await response.json()) as OsfApiResponse;
		for (const item of page.data) {
			if (item.attributes.kind === 'file' && item.links.download) {
				discovered.push({
					name: item.attributes.name,
					downloadUrl: item.links.download
				});
			} else if (item.attributes.kind === 'folder' && item.links.files) {
				discovered.push(...(await listOsfFiles(item.links.files)));
			}
		}
		nextUrl = page.links.next;
	}
	return discovered;
}

function excelCellValue(cell: ExcelJS.Cell): RawValue {
	const value = cell.value;
	if (value === null || typeof value === 'string' || typeof value === 'number') return value;
	if (typeof value === 'boolean' || value instanceof Date) return value;
	if ('result' in value && value.result !== undefined) {
		const result = value.result;
		return typeof result === 'string' ||
			typeof result === 'number' ||
			typeof result === 'boolean' ||
			result instanceof Date
			? result
			: String(result);
	}
	return cell.text || null;
}

function parseWorksheet(worksheet: ExcelJS.Worksheet): RawRecord[] {
	let headerRowNumber = 1;
	let bestHeaderScore = -1;

	for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
		const row = worksheet.getRow(rowNumber);
		const values = row.values
			.slice(1)
			.map((value) => textValue(value as RawValue))
			.filter(Boolean) as string[];
		const semanticMatches = values.filter((value) =>
			Object.values(HEADER_ALIASES)
				.flat()
				.some((alias) => normalizeHeader(alias) === normalizeHeader(value))
		).length;
		const score = values.length + semanticMatches * 5;
		if (score > bestHeaderScore) {
			bestHeaderScore = score;
			headerRowNumber = rowNumber;
		}
	}

	const headerRow = worksheet.getRow(headerRowNumber);
	const headers = headerRow.values
		.slice(1)
		.map((value, index) => textValue(value as RawValue) ?? `column_${index + 1}`);
	const records: RawRecord[] = [];

	for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
		const row = worksheet.getRow(rowNumber);
		const record = Object.fromEntries(
			headers.map((header, index) => [header, excelCellValue(row.getCell(index + 1))])
		);
		if (Object.values(record).some((value) => textValue(value) !== null)) records.push(record);
	}
	return records;
}

async function parseOsfFile(file: OsfFile): Promise<ParsedFile[]> {
	const response = await fetch(file.downloadUrl, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${file.name} download failed with HTTP ${response.status}.`);
	const buffer = Buffer.from(await response.arrayBuffer());
	const extension = file.name.split('.').pop()?.toLowerCase();

	if (extension === 'csv' || extension === 'tsv') {
		const delimiter = extension === 'tsv' ? '\t' : ',';
		const records = parse(buffer, {
			columns: true,
			skip_empty_lines: true,
			relax_column_count: true,
			bom: true,
			delimiter
		}) as RawRecord[];
		return [{ file, records, headers: records.length > 0 ? Object.keys(records[0]) : [] }];
	}

	if (extension === 'json') {
		const body = JSON.parse(buffer.toString('utf8')) as unknown;
		const records = Array.isArray(body) ? (body as RawRecord[]) : [];
		return [{ file, records, headers: records.length > 0 ? Object.keys(records[0]) : [] }];
	}

	if (extension === 'xlsx') {
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(buffer);
		const parsed: ParsedFile[] = [];
		workbook.eachSheet((worksheet) => {
			const records = parseWorksheet(worksheet);
			parsed.push({
				file: { ...file, name: `${file.name}#${worksheet.name}` },
				records,
				headers: records.length > 0 ? Object.keys(records[0]) : []
			});
		});
		return parsed;
	}

	return [];
}

function mappingScore(file: ParsedFile): number {
	const normalizedHeaders = new Set(file.headers.map(normalizeHeader));
	const has = (aliases: readonly string[]): boolean =>
		aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias)));
	return (
		(has(HEADER_ALIASES.name) ? 5 : 0) +
		(has(HEADER_ALIASES.latitude) ? 5 : 0) +
		(has(HEADER_ALIASES.longitude) ? 5 : 0) +
		(has(HEADER_ALIASES.address) ? 3 : 0) +
		(has(HEADER_ALIASES.accessible) ? 3 : 0) +
		Math.min(3, file.records.length / 100)
	);
}

async function geocodeAddress(address: string): Promise<Coordinates | null> {
	const endpoint = new URL('https://nominatim.openstreetmap.org/search');
	endpoint.searchParams.set('q', `${address}, Atlanta, Georgia`);
	endpoint.searchParams.set('format', 'jsonv2');
	endpoint.searchParams.set('limit', '1');
	endpoint.searchParams.set('countrycodes', 'us');
	const response = await fetch(endpoint, {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'Relief-ATL-GSU-Importer/1.0'
		},
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) return null;
	const matches = (await response.json()) as Array<{ lat: string; lon: string }>;
	const latitude = Number(matches[0]?.lat);
	const longitude = Number(matches[0]?.lon);
	return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

interface Coordinates {
	latitude: number;
	longitude: number;
}

async function addMissingCoordinates(
	records: ReturnType<typeof normalizeRecord>[],
	geocode: boolean
): Promise<NormalizedRestroom[]> {
	const complete: NormalizedRestroom[] = [];
	for (const record of records) {
		if (!record.name) {
			console.warn(`Skipping ${record.sourceId}: no location name or address.`);
			continue;
		}
		let latitude = record.latitude;
		let longitude = record.longitude;
		if ((latitude === null || longitude === null) && geocode && record.address) {
			const coordinates = await geocodeAddress(record.address);
			latitude = coordinates?.latitude ?? null;
			longitude = coordinates?.longitude ?? null;
			await new Promise((done) => setTimeout(done, 1_100));
		}
		if (
			latitude === null ||
			longitude === null ||
			latitude < -90 ||
			latitude > 90 ||
			longitude < -180 ||
			longitude > 180
		) {
			console.warn(`Skipping ${record.sourceId}: no usable coordinates.`);
			continue;
		}
		complete.push({ ...record, latitude, longitude });
	}
	return complete;
}

async function upsertRestrooms(restrooms: NormalizedRestroom[]): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error('DATABASE_URL is required unless --write-seed is used.');
	const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
	const client = new Client({
		connectionString,
		ssl: isLocal
			? false
			: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
	});

	await client.connect();
	try {
		await client.query('BEGIN');
		for (const restroom of restrooms) {
			await client.query(
				`INSERT INTO restrooms (
					id, name, latitude, longitude, address, source, source_id, source_url,
					location_type, officially_public, purchase_required, wheelchair_accessible,
					gender_neutral, changing_table, soap_available, toilet_paper_available,
					water_available, opening_hours, historically_accessible, original_audit_date,
					last_source_verified_at, source_metadata
				) VALUES (
					$1, $2, $3, $4, $5, 'gsu', $6, $7, $8, $9, $10, $11, $12, $13, $14,
					$15, $16, $17, $18, $19, $20, $21::jsonb
				)
				ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
				DO UPDATE SET
					name = EXCLUDED.name,
					latitude = EXCLUDED.latitude,
					longitude = EXCLUDED.longitude,
					address = EXCLUDED.address,
					source_url = EXCLUDED.source_url,
					location_type = EXCLUDED.location_type,
					officially_public = EXCLUDED.officially_public,
					purchase_required = EXCLUDED.purchase_required,
					wheelchair_accessible = EXCLUDED.wheelchair_accessible,
					gender_neutral = EXCLUDED.gender_neutral,
					changing_table = EXCLUDED.changing_table,
					soap_available = EXCLUDED.soap_available,
					toilet_paper_available = EXCLUDED.toilet_paper_available,
					water_available = EXCLUDED.water_available,
					opening_hours = EXCLUDED.opening_hours,
					historically_accessible = EXCLUDED.historically_accessible,
					original_audit_date = EXCLUDED.original_audit_date,
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
					restroom.locationType,
					restroom.officiallyPublic,
					restroom.purchaseRequired,
					restroom.wheelchairAccessible,
					restroom.genderNeutral,
					restroom.changingTable,
					restroom.soapAvailable,
					restroom.toiletPaperAvailable,
					restroom.waterAvailable,
					restroom.openingHours,
					restroom.historicallyAccessible,
					restroom.originalAuditDate,
					restroom.lastSourceVerifiedAt,
					JSON.stringify(restroom.sourceMetadata)
				]
			);
		}
		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		await client.end();
	}
}

const argumentsSet = new Set(process.argv.slice(2));
const requestedFileIndex = process.argv.indexOf('--file');
const requestedFile =
	requestedFileIndex >= 0 ? process.argv[requestedFileIndex + 1]?.toLowerCase() : null;
const writeSeed = argumentsSet.has('--write-seed');
const geocode = argumentsSet.has('--geocode');

console.log(`Discovering public files from ${OSF_FILES_API}`);
const allFiles = await listOsfFiles();
console.log(`Found ${allFiles.length} OSF files: ${allFiles.map((file) => file.name).join(', ')}`);

const tabularFiles = allFiles.filter((file) => /\.(csv|tsv|json|xlsx)$/i.test(file.name));
const selectedFiles = requestedFile
	? tabularFiles.filter((file) => file.name.toLowerCase().includes(requestedFile))
	: tabularFiles;
if (selectedFiles.length === 0) {
	throw new Error('No matching CSV, TSV, JSON, or XLSX dataset was found in the OSF project.');
}

const parsedFiles = (await Promise.all(selectedFiles.map(parseOsfFile))).flat();
for (const file of parsedFiles) {
	console.log(
		`${file.file.name}: ${file.records.length} rows; headers: ${file.headers.join(', ')}`
	);
}

const candidates = parsedFiles.filter((file) => mappingScore(file) >= 10);
if (candidates.length === 0) {
	throw new Error(
		'No dataset contained a safe combination of location, coordinate, and audit fields. Review the printed headers and extend HEADER_ALIASES without inventing values.'
	);
}

const normalized = candidates.flatMap((file) =>
	file.records.map((record, index) => normalizeRecord(record, index, file.file))
);
const deduplicated = [...new Map(normalized.map((record) => [record.sourceId, record])).values()];
const complete = await addMissingCoordinates(deduplicated, geocode);
if (complete.length === 0) throw new Error('No records had usable or geocodable coordinates.');

if (writeSeed) {
	const seedPath = resolve('src/lib/data/gsu-restrooms.json');
	await writeFile(seedPath, `${JSON.stringify(complete, null, '\t')}\n`);
	console.log(`Wrote ${complete.length} normalized GSU records to ${seedPath}.`);
} else {
	await upsertRestrooms(complete);
	console.log(`Imported ${complete.length} normalized GSU records into Tiger Data.`);
}
