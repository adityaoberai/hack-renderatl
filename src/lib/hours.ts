/**
 * A deliberately small opening-hours parser for the free-text hour strings in
 * the GSU audit (`Hrs_desc`) and OSM (`opening_hours`).
 *
 * It handles the shapes that actually occur in the data, e.g.
 *   "7 am - 7 pm Monday - Friday"
 *   "8 am - 4 pm Monday - Friday, 8 am - 9 pm Sat/Sun"
 *   "7:30 am - 1:30 am every day"
 *   "Mo-Fr 09:00-17:00"           (OSM syntax)
 *   "24/7"
 *
 * Anything it cannot confidently parse returns `null` so the caller treats the
 * hours as unknown rather than inventing a closure. Never guess.
 */

export interface HourSpan {
	/** Day indices, 0 = Sunday. */
	days: number[];
	/** Minutes from local midnight. `end` may exceed 1440 for overnight spans. */
	start: number;
	end: number;
}

const DAY_INDEX: Record<string, number> = {
	sun: 0,
	sunday: 0,
	su: 0,
	mon: 1,
	monday: 1,
	mo: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	tu: 2,
	wed: 3,
	weds: 3,
	wednesday: 3,
	we: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	th: 4,
	fri: 5,
	friday: 5,
	fr: 5,
	sat: 6,
	saturday: 6,
	sa: 6
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseClock(raw: string): number | null {
	const m = /^\s*(\d{1,2})(?:(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(raw);
	if (!m) return null;
	let hour = Number(m[1]);
	const minute = m[2] ? Number(m[2]) : 0;
	const meridiem = m[3]?.toLowerCase().replace(/\./g, '');
	if (minute > 59) return null;
	if (meridiem) {
		if (hour < 1 || hour > 12) return null;
		if (meridiem === 'pm' && hour !== 12) hour += 12;
		if (meridiem === 'am' && hour === 12) hour = 0;
	} else if (hour > 24) return null;
	return hour * 60 + minute;
}

/** Expand a day expression ("Monday - Friday", "Sat/Sun", "Mo,We") to indices. */
function parseDays(raw: string): number[] | null {
	const text = raw.toLowerCase().trim();
	if (!text || /every ?day|daily|all week|7 days/.test(text)) return ALL_DAYS;
	if (/weekday/.test(text)) return [1, 2, 3, 4, 5];
	if (/weekend/.test(text)) return [0, 6];

	const out = new Set<number>();
	for (const chunk of text.split(/[,/&]|\band\b/)) {
		const part = chunk.trim().replace(/\.$/, '');
		if (!part) continue;
		const range = /^([a-z]+)\s*(?:-|-|: |through|to)\s*([a-z]+)$/.exec(part);
		if (range) {
			const from = DAY_INDEX[range[1]];
			const to = DAY_INDEX[range[2]];
			if (from === undefined || to === undefined) return null;
			for (let i = 0; i < 7; i++) {
				const d = (from + i) % 7;
				out.add(d);
				if (d === to) break;
			}
			continue;
		}
		const single = DAY_INDEX[part];
		if (single === undefined) return null;
		out.add(single);
	}
	return out.size ? [...out].sort() : null;
}

export function parseOpeningHours(text: string | null | undefined): HourSpan[] | null {
	if (!text) return null;
	const raw = text.trim();
	if (!raw || /don'?t know|unknown|varies|n\/?a/i.test(raw)) return null;
	if (/24\s*\/\s*7|24 ?hours|open 24|always open/i.test(raw)) {
		return [{ days: ALL_DAYS, start: 0, end: 1440 }];
	}

	const spans: HourSpan[] = [];
	for (const segment of raw.split(/[;,]/)) {
		const part = segment.trim();
		if (!part) continue;

		// "<days> <start>-<end>"  (OSM style) or "<start>-<end> <days>" (GSU style)
		const timeRange =
			/(\d{1,2}(?:\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*(?:-|-|: |to)\s*(\d{1,2}(?:\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i.exec(
				part
			);
		if (!timeRange) continue;

		const start = parseClock(timeRange[1]);
		let end = parseClock(timeRange[2]);
		if (start === null || end === null) continue;
		if (end <= start) end += 1440; // overnight, e.g. 7:30 am - 1:30 am

		const dayText = (
			part.slice(0, timeRange.index) +
			' ' +
			part.slice(timeRange.index + timeRange[0].length)
		)
			.replace(/\b(open|closed|hours?)\b/gi, '')
			.trim();
		const days = parseDays(dayText);
		if (!days) continue;
		spans.push({ days, start, end });
	}

	return spans.length ? spans : null;
}

/** Atlanta wall-clock weekday + minutes-since-midnight for an instant. */
export function atlantaLocalTime(at: Date): { day: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(at);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const day = DAY_INDEX[get('weekday').toLowerCase()] ?? 0;
	const hour = Number(get('hour')) % 24;
	return { day, minutes: hour * 60 + Number(get('minute')) };
}

/**
 * `true` / `false` when the hours are parseable, `null` when they are not.
 * Null means "we don't know" and must never be rendered as "closed".
 */
export function isOpenAt(spans: HourSpan[] | null, at: Date): boolean | null {
	if (!spans || !spans.length) return null;
	const { day, minutes } = atlantaLocalTime(at);
	for (const span of spans) {
		// Same-day match.
		if (span.days.includes(day) && minutes >= span.start && minutes < span.end) return true;
		// A span that started yesterday and runs past midnight.
		if (span.end > 1440) {
			const yesterday = (day + 6) % 7;
			if (span.days.includes(yesterday) && minutes + 1440 < span.end) return true;
		}
	}
	return false;
}

/** Short "Open until 8:00 PM" / "Closed · opens 7:00 AM" summary, or null. */
export function describeHoursNow(spans: HourSpan[] | null, at: Date): string | null {
	if (!spans || !spans.length) return null;
	if (
		spans.length === 1 &&
		spans[0].days.length === 7 &&
		spans[0].start === 0 &&
		spans[0].end === 1440
	) {
		return 'Open 24 hours';
	}
	const { day, minutes } = atlantaLocalTime(at);
	const fmt = (m: number) => {
		const total = ((m % 1440) + 1440) % 1440;
		const h24 = Math.floor(total / 60);
		const mm = String(total % 60).padStart(2, '0');
		const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
		return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
	};

	for (const span of spans) {
		if (span.days.includes(day) && minutes >= span.start && minutes < span.end) {
			return `Open until ${fmt(span.end)}`;
		}
		if (span.end > 1440 && span.days.includes((day + 6) % 7) && minutes + 1440 < span.end) {
			return `Open until ${fmt(span.end)}`;
		}
	}

	// Find the next opening within the next week.
	for (let ahead = 0; ahead < 8; ahead++) {
		const d = (day + ahead) % 7;
		const candidates = spans
			.filter((s) => s.days.includes(d))
			.map((s) => s.start)
			.filter((start) => ahead > 0 || start > minutes)
			.sort((a, b) => a - b);
		if (candidates.length) {
			const when = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : null;
			return when
				? `Closed · opens ${fmt(candidates[0])} ${when}`
				: `Closed · opens ${fmt(candidates[0])}`;
		}
	}
	return 'Closed';
}
