/**
 * Demo seed data for the community-report time series.
 *
 * The restroom *locations* are all real, imported from the GSU audit and
 * OpenStreetMap. What we cannot have on day one is a year of real community
 * traffic, so this module synthesises a plausible report history on top of
 * those real locations.
 *
 * Every generated report carries `metadata.seeded = true` so it is always
 * distinguishable from a genuine anonymous confirmation, and the About page
 * says so out loud. Generation is deterministic — seeded from each restroom's
 * UUID — so the same location tells the same story on every boot, while the
 * timestamps stay relative to "now" and therefore always look live.
 */

import type { Report, ReportStatus, Restroom } from '../types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Which demo story a location tells. */
type Profile =
	| 'fresh-confirmed' // somebody used it minutes ago
	| 'fresh-problem' // two people just found it locked
	| 'confirmed-today' // used a couple of hours ago
	| 'reliable-history' // long, mostly-successful history
	| 'flaky-evening' // fine in the morning, locked after 6pm
	| 'quiet'; // no community reports at all

const NEGATIVE_STATUSES: ReportStatus[] = ['locked', 'closed', 'customer_only', 'out_of_service'];

function pick<T>(items: T[], r: () => number): T {
	return items[Math.floor(r() * items.length)];
}

/**
 * Assign profiles so that every study area has at least one green, one red and
 * one amber story. Wherever the demo is centred in Atlanta, the map reads well.
 */
function assignProfiles(restrooms: Restroom[]): Map<string, Profile> {
	const profiles = new Map<string, Profile>();

	const areas = new Map<string, Restroom[]>();
	for (const restroom of restrooms) {
		// OpenStreetMap records stay deliberately unverified unless a real user
		// reports one — an OSM listing is not evidence that anybody got in.
		if (restroom.source !== 'gsu') {
			profiles.set(restroom.id, 'quiet');
			continue;
		}
		const area = String(restroom.sourceMetadata?.studyArea ?? 'Atlanta');
		if (!areas.has(area)) areas.set(area, []);
		areas.get(area)!.push(restroom);
	}

	for (const [area, group] of areas) {
		// Deterministic shuffle within the area.
		const r = rng(hash(area));
		const shuffled = [...group].sort(
			(a, b) => hash(a.id + area) - hash(b.id + area) || a.id.localeCompare(b.id)
		);

		const plan: Profile[] = [
			'fresh-confirmed',
			'fresh-problem',
			'confirmed-today',
			'reliable-history',
			'flaky-evening'
		];
		shuffled.forEach((restroom, index) => {
			if (index < plan.length && index < Math.max(2, Math.ceil(group.length * 0.55))) {
				profiles.set(restroom.id, plan[index]);
			} else {
				// A long tail of locations nobody has reported on yet — this is the
				// honest default, and it is what makes the confirmed ones mean something.
				profiles.set(restroom.id, r() < 0.28 ? 'reliable-history' : 'quiet');
			}
		});
	}

	return profiles;
}

interface SeedReport {
	restroomId: string;
	status: ReportStatus;
	createdAt: string;
	metadata: Record<string, unknown>;
}

function event(
	restroomId: string,
	status: ReportStatus,
	at: number,
	extra: Record<string, unknown> = {}
): SeedReport {
	return {
		restroomId,
		status,
		createdAt: new Date(at).toISOString(),
		metadata: { seeded: true, ...extra }
	};
}

/** Local Atlanta hour for a timestamp, used to keep synthetic traffic daytime-ish. */
function atlantaHour(ms: number): number {
	return (
		Number(
			new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/New_York',
				hour: '2-digit',
				hour12: false
			}).format(new Date(ms))
		) % 24
	);
}

/** Build a background history of reports over the last `days` days. */
function backgroundHistory(
	restroom: Restroom,
	r: () => number,
	now: number,
	options: { days: number; perDay: number; successRate: number }
): SeedReport[] {
	const out: SeedReport[] = [];
	for (let day = 0; day < options.days; day++) {
		// The last 24 hours carry extra traffic so the hourly timeline strip in the
		// detail view shows a pattern rather than a single lonely bar. Those extra
		// events are deliberately kept 7+ hours old: background history should fill
		// in the picture, not manufacture a fresh green pin. Only the explicit
		// profile events below are allowed to be recent.
		const boost = day === 0 ? 3 : day === 1 ? 1 : 0;
		const count = Math.floor(r() * (options.perDay + 1)) + boost;
		for (let i = 0; i < count; i++) {
			const at =
				day === 0
					? now - (7 + r() * 15) * HOUR
					: // Bias toward waking hours: 7am–9pm.
						now - day * DAY - (24 - (7 + Math.floor(r() * 14))) * HOUR + Math.floor(r() * HOUR);
			if (at > now - 7 * HOUR) continue; // the recent window belongs to the profile
			const success = r() < options.successRate;
			out.push(event(restroom.id, success ? 'accessible' : pick(NEGATIVE_STATUSES, r), at));
		}
	}
	return out;
}

export function generateSeedReports(restrooms: Restroom[], now: Date = new Date()): SeedReport[] {
	const profiles = assignProfiles(restrooms);
	const ms = now.getTime();
	const out: SeedReport[] = [];

	for (const restroom of restrooms) {
		const profile = profiles.get(restroom.id) ?? 'quiet';
		if (profile === 'quiet') continue;
		const r = rng(hash(restroom.id));

		switch (profile) {
			case 'fresh-confirmed': {
				// The hero of the demo: used minutes ago, with corroboration.
				out.push(event(restroom.id, 'accessible', ms - (8 + Math.floor(r() * 20)) * MINUTE));
				out.push(event(restroom.id, 'accessible', ms - (2 + Math.floor(r() * 3)) * HOUR));
				out.push(...backgroundHistory(restroom, r, ms, { days: 30, perDay: 2, successRate: 0.93 }));
				break;
			}
			case 'fresh-problem': {
				// Two independent people just found it shut. Recent reality wins.
				const status =
					r() < 0.62
						? 'locked'
						: pick(['closed', 'out_of_service', 'customer_only'] as ReportStatus[], r);
				out.push(event(restroom.id, status, ms - (6 + Math.floor(r() * 10)) * MINUTE));
				out.push(event(restroom.id, status, ms - (14 + Math.floor(r() * 8)) * MINUTE));
				// It worked fine earlier — which is exactly why stale data misleads.
				out.push(event(restroom.id, 'accessible', ms - (5 + Math.floor(r() * 4)) * HOUR));
				out.push(...backgroundHistory(restroom, r, ms, { days: 30, perDay: 2, successRate: 0.78 }));
				break;
			}
			case 'confirmed-today': {
				out.push(event(restroom.id, 'accessible', ms - (75 + Math.floor(r() * 150)) * MINUTE));
				out.push(...backgroundHistory(restroom, r, ms, { days: 30, perDay: 1, successRate: 0.88 }));
				break;
			}
			case 'reliable-history': {
				out.push(...backgroundHistory(restroom, r, ms, { days: 30, perDay: 2, successRate: 0.86 }));
				break;
			}
			case 'flaky-evening': {
				// Dependable in the morning, frequently locked after 6pm — the
				// time-of-day pattern only a time-series database can surface.
				for (let day = 0; day < 30; day++) {
					if (r() < 0.35) continue;
					const morning = ms - day * DAY - (24 - (8 + Math.floor(r() * 3))) * HOUR;
					if (morning < ms) out.push(event(restroom.id, 'accessible', morning));
					const evening = ms - day * DAY - (24 - (18 + Math.floor(r() * 4))) * HOUR;
					if (evening < ms && r() < 0.8) {
						out.push(event(restroom.id, r() < 0.75 ? 'locked' : 'closed', evening));
					}
				}
				// Only surface a live signal if we are actually in the relevant window.
				const hourNow = atlantaHour(ms);
				if (hourNow >= 18 || hourNow < 6) {
					out.push(event(restroom.id, 'locked', ms - (25 + Math.floor(r() * 50)) * MINUTE));
				} else if (hourNow >= 9) {
					out.push(event(restroom.id, 'accessible', ms - (40 + Math.floor(r() * 80)) * MINUTE));
				}
				break;
			}
		}
	}

	return out
		.filter((report) => Date.parse(report.createdAt) <= ms)
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Materialise seed reports as full `Report` objects for the in-memory store. */
export function generateSeedReportRows(restrooms: Restroom[], now: Date = new Date()): Report[] {
	return generateSeedReports(restrooms, now).map((report, index) => ({
		id: index + 1,
		restroomId: report.restroomId,
		status: report.status,
		createdAt: report.createdAt,
		metadata: report.metadata
	}));
}
