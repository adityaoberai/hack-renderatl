/**
 * Client-side application state.
 *
 * One object drives the whole screen: where the user is, what we found, what is
 * selected, and which filters are on. The map and the list are two views of the
 * same list, so selecting in one always highlights the other.
 */

import { ATLANTA_CENTER } from './geo';
import {
	EMPTY_FILTERS,
	type Filters,
	type NearbyRestroom,
	type ReportStatus,
	type RestroomDetail
} from './types';

export interface Origin {
	latitude: number;
	longitude: number;
	/** What to call this place in the UI: "Your location" or a searched address. */
	label: string;
	/** True only for a real device fix: controls whether we draw the "you" dot. */
	isDeviceLocation: boolean;
}

export type Phase = 'landing' | 'app';

export class ReliefState {
	phase = $state<Phase>('landing');

	origin = $state<Origin | null>(null);
	locating = $state(false);
	locationError = $state<string | null>(null);

	results = $state<NearbyRestroom[]>([]);
	loading = $state(false);
	loadError = $state<string | null>(null);

	selectedId = $state<string | null>(null);
	detail = $state<RestroomDetail | null>(null);
	detailLoading = $state(false);

	filters = $state<Filters>({ ...EMPTY_FILTERS });
	filtersOpen = $state(false);

	/** Mobile only: desktop always shows both panes. */
	mobileView = $state<'map' | 'list'>('list');

	/** Confirmation toast after a report is stored. */
	toast = $state<{ message: string; tone: 'ok' | 'bad' } | null>(null);

	/** Which restroom the map should fly to. Bumped to retrigger the same target. */
	flyTo = $state<{ latitude: number; longitude: number; zoom?: number; nonce: number } | null>(
		null
	);

	private requestToken = 0;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;

	get activeFilterCount(): number {
		return Object.values(this.filters).filter(Boolean).length;
	}

	get selected(): NearbyRestroom | null {
		return this.results.find((r) => r.restroom.id === this.selectedId) ?? null;
	}

	get center(): { latitude: number; longitude: number } {
		return this.origin ?? ATLANTA_CENTER;
	}

	/* ------------------------------------------------------------ location */

	async useMyLocation(): Promise<void> {
		if (!('geolocation' in navigator)) {
			this.locationError = 'This browser cannot share a location. Search for an address instead.';
			this.browseAtlanta();
			return;
		}

		this.locating = true;
		this.locationError = null;

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 10_000,
					maximumAge: 60_000
				});
			});

			this.origin = {
				latitude: position.coords.latitude,
				longitude: position.coords.longitude,
				label: 'Your location',
				isDeviceLocation: true
			};
			this.phase = 'app';
			this.flyTo = { ...this.origin, zoom: 15, nonce: Date.now() };
			await this.refresh();
		} catch (error) {
			const code = (error as GeolocationPositionError)?.code;
			this.locationError =
				code === 1
					? 'Location permission was declined. Search an address instead: everything else still works.'
					: 'Could not get a location fix. Showing central Atlanta instead.';
			// Never dead-end: fall through to the map centred on downtown.
			this.browseAtlanta();
		} finally {
			this.locating = false;
		}
	}

	/** Enter the app without a location fix, centred on downtown Atlanta. */
	browseAtlanta(): void {
		if (!this.origin) {
			this.origin = { ...ATLANTA_CENTER, label: 'Downtown Atlanta', isDeviceLocation: false };
			this.flyTo = { ...ATLANTA_CENTER, zoom: 14, nonce: Date.now() };
		}
		this.phase = 'app';
		void this.refresh();
	}

	setOrigin(origin: Origin, zoom = 15): void {
		this.origin = origin;
		this.phase = 'app';
		this.locationError = null;
		this.flyTo = {
			latitude: origin.latitude,
			longitude: origin.longitude,
			zoom,
			nonce: Date.now()
		};
		void this.refresh();
	}

	/* -------------------------------------------------------------- search */

	async searchArea(query: string): Promise<{ label: string } | null> {
		const trimmed = query.trim();
		if (!trimmed) return null;

		this.loading = true;
		try {
			const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
			const data = (await response.json()) as {
				results: Array<{ label: string; latitude: number; longitude: number }>;
			};
			const first = data.results?.[0];
			if (!first) {
				this.loadError = `No match for “${trimmed}” in Atlanta.`;
				return null;
			}
			this.loadError = null;
			this.setOrigin(
				{
					latitude: first.latitude,
					longitude: first.longitude,
					label: first.label,
					isDeviceLocation: false
				},
				15
			);
			return { label: first.label };
		} catch {
			this.loadError = 'Address search is unavailable right now.';
			return null;
		} finally {
			this.loading = false;
		}
	}

	/* --------------------------------------------------------------- data */

	async refresh(): Promise<void> {
		const token = ++this.requestToken;
		this.loading = true;
		this.loadError = null;

		const params = new URLSearchParams();
		const center = this.center;
		params.set('lat', String(center.latitude));
		params.set('lon', String(center.longitude));
		params.set('radius', '4000');
		// Generous enough that low-ranked results: especially the ones reported
		// unavailable: still reach the map. Silently dropping a red pin would hide
		// exactly the information the user most needs.
		params.set('limit', '150');
		for (const [key, value] of Object.entries(this.filters)) {
			if (value) params.set(key, '1');
		}

		try {
			const response = await fetch(`/api/restrooms?${params}`);
			if (!response.ok) throw new Error(String(response.status));
			const data = (await response.json()) as { results: NearbyRestroom[] };
			if (token !== this.requestToken) return; // a newer request already landed
			this.results = data.results;

			// Keep the open sheet in sync with refreshed scores.
			if (this.selectedId && !this.results.some((r) => r.restroom.id === this.selectedId)) {
				this.selectedId = null;
				this.detail = null;
			}
		} catch {
			if (token !== this.requestToken) return;
			this.loadError = 'Could not load restrooms. Check your connection and try again.';
		} finally {
			if (token === this.requestToken) this.loading = false;
		}
	}

	toggleFilter(key: keyof Filters): void {
		this.filters = { ...this.filters, [key]: !this.filters[key] };
		void this.refresh();
	}

	clearFilters(): void {
		this.filters = { ...EMPTY_FILTERS };
		void this.refresh();
	}

	/* ------------------------------------------------------------ selection */

	async select(id: string | null, options: { fly?: boolean } = {}): Promise<void> {
		this.selectedId = id;
		if (!id) {
			this.detail = null;
			return;
		}

		const entry = this.results.find((r) => r.restroom.id === id);
		if (options.fly && entry) {
			this.flyTo = {
				latitude: entry.restroom.latitude,
				longitude: entry.restroom.longitude,
				zoom: 16,
				nonce: Date.now()
			};
		}

		this.detailLoading = true;
		this.detail = null;
		try {
			const params = new URLSearchParams();
			const center = this.center;
			params.set('lat', String(center.latitude));
			params.set('lon', String(center.longitude));
			const response = await fetch(`/api/restrooms/${id}?${params}`);
			if (!response.ok) throw new Error(String(response.status));
			const detail = (await response.json()) as RestroomDetail;
			if (this.selectedId !== id) return;
			this.detail = detail;
		} catch {
			if (this.selectedId === id) this.detail = null;
		} finally {
			if (this.selectedId === id) this.detailLoading = false;
		}
	}

	closeDetail(): void {
		this.selectedId = null;
		this.detail = null;
	}

	/* ------------------------------------------------------------- reports */

	/**
	 * Submit an anonymous confirmation. The server stores a new timestamped
	 * event and returns the recomputed detail, so the UI shows a real
	 * server-derived status rather than a guess.
	 */
	async submitReport(status: ReportStatus, note?: string): Promise<boolean> {
		const id = this.selectedId;
		if (!id) return false;

		try {
			const center = this.center;
			const response = await fetch('/api/reports', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					restroomId: id,
					status,
					note,
					// So the recomputed detail keeps its distance and walking time.
					latitude: center.latitude,
					longitude: center.longitude
				})
			});
			if (!response.ok) throw new Error(String(response.status));

			const data = (await response.json()) as { detail: RestroomDetail | null };
			if (data.detail) {
				if (this.selectedId === id) this.detail = data.detail;
				// Patch the list entry in place so the card and marker update instantly.
				this.results = this.results.map((entry) =>
					entry.restroom.id === id ? { ...entry, ...stripDetail(data.detail!) } : entry
				);
			}

			this.showToast(
				status === 'accessible'
					? "Thanks! You've helped the next person find a restroom."
					: 'Thanks: that warning is live for everyone right now.',
				status === 'accessible' ? 'ok' : 'bad'
			);
			return true;
		} catch {
			this.showToast('Could not save that report. Try again in a moment.', 'bad');
			return false;
		}
	}

	showToast(message: string, tone: 'ok' | 'bad'): void {
		this.toast = { message, tone };
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = null), 4200);
	}
}

/** Narrow a detail payload back down to the list-entry shape. */
function stripDetail(detail: RestroomDetail): NearbyRestroom {
	const { confidenceFactors: _f, recentReports: _r, timeline: _t, ...rest } = detail;
	return rest;
}
