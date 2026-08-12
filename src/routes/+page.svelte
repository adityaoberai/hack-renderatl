<script lang="ts">
	import RestroomCard from '$lib/components/RestroomCard.svelte';
	import RestroomMap from '$lib/components/RestroomMap.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { resolve } from '$app/paths';
	import {
		REPORT_LABELS,
		formatAuditDate,
		formatRelativeTime,
		knownAttributes,
		sourceName
	} from '$lib/display';
	import { formatDistance } from '$lib/geo';
	import type { Coordinates, NearbyRestroom, ReportStatus, RestroomFilters } from '$lib/types';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	let { data }: { data: PageData } = $props();
	const initialData = untrack(() => data);

	type ActiveFilters = Required<RestroomFilters>;

	let results = $state<NearbyRestroom[]>(initialData.results);
	let location = $state<Coordinates>(initialData.initialLocation);
	let mapCenter = $state<Coordinates>(initialData.initialLocation);
	let userLocation = $state<Coordinates | null>(null);
	let selectedId = $state<string | null>(null);
	let started = $state(false);
	let locationLoading = $state(false);
	let searching = $state(false);
	let reporting = $state(false);
	let filtersOpen = $state(false);
	let detailOpen = $state(false);
	let issuePickerOpen = $state(false);
	let sheetExpanded = $state(false);
	let searchQuery = $state('');
	let notice = $state('');
	let toast = $state('');
	let dragStartY = 0;

	let filters = $state<ActiveFilters>({
		wheelchairAccessible: false,
		changingTable: false,
		noPurchaseRequired: false,
		recentlyConfirmed: false,
		publicOnly: false
	});

	let selected = $derived(results.find((result) => result.restroom.id === selectedId) ?? null);
	let activeFilterCount = $derived(Object.values(filters).filter(Boolean).length);

	const negativeStatuses: ReportStatus[] = [
		'locked',
		'closed',
		'customer_only',
		'out_of_service',
		'not_found',
		'other'
	];

	function queryParameters(point: Coordinates): URLSearchParams {
		const parameters = new SvelteURLSearchParams({
			lat: String(point.latitude),
			lng: String(point.longitude),
			limit: '100'
		});
		if (filters.wheelchairAccessible) parameters.set('wheelchair', 'true');
		if (filters.changingTable) parameters.set('changingTable', 'true');
		if (filters.noPurchaseRequired) parameters.set('noPurchase', 'true');
		if (filters.recentlyConfirmed) parameters.set('confirmed', 'true');
		if (filters.publicOnly) parameters.set('publicOnly', 'true');
		return parameters;
	}

	async function refreshResults(point = location): Promise<void> {
		const response = await fetch(`/api/restrooms?${queryParameters(point)}`);
		const body = (await response.json()) as {
			results?: NearbyRestroom[];
			message?: string;
		};
		if (!response.ok || !body.results) {
			throw new Error(body.message ?? 'Nearby restrooms could not be loaded.');
		}
		results = body.results;
		location = point;
		mapCenter = point;
		if (selectedId && !results.some((result) => result.restroom.id === selectedId)) {
			selectedId = null;
			detailOpen = false;
		}
	}

	function useCurrentLocation(): void {
		started = true;
		notice = '';
		if (!navigator.geolocation) {
			notice = 'Location is not supported by this browser. Showing central Atlanta.';
			return;
		}

		locationLoading = true;
		navigator.geolocation.getCurrentPosition(
			async (position) => {
				const point = {
					latitude: position.coords.latitude,
					longitude: position.coords.longitude
				};
				userLocation = point;
				try {
					await refreshResults(point);
				} catch (error) {
					notice = error instanceof Error ? error.message : 'Nearby restrooms could not be loaded.';
				} finally {
					locationLoading = false;
				}
			},
			() => {
				locationLoading = false;
				notice = 'Location access was unavailable. Showing results near central Atlanta.';
				mapCenter = initialData.initialLocation;
			},
			{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
		);
	}

	async function searchAddress(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		const query = searchQuery.trim();
		if (!query) return;
		started = true;
		searching = true;
		notice = '';

		const localMatch = results.find((result) => {
			const searchable = `${result.restroom.name} ${result.restroom.address ?? ''}`.toLowerCase();
			return searchable.includes(query.toLowerCase());
		});

		try {
			if (localMatch) {
				const point = {
					latitude: localMatch.restroom.latitude,
					longitude: localMatch.restroom.longitude
				};
				await refreshResults(point);
				selectedId = localMatch.restroom.id;
				return;
			}

			const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
			const body = (await response.json()) as {
				results?: Array<Coordinates & { label: string }>;
				message?: string;
			};
			if (!response.ok) throw new Error(body.message ?? 'Address search failed.');
			const match = body.results?.[0];
			if (!match) throw new Error('No matching Atlanta address was found.');
			userLocation = null;
			await refreshResults(match);
		} catch (error) {
			notice = error instanceof Error ? error.message : 'Address search failed.';
		} finally {
			searching = false;
		}
	}

	function selectResult(id: string, openDetails = false): void {
		selectedId = id;
		const result = results.find((candidate) => candidate.restroom.id === id);
		if (result) {
			mapCenter = {
				latitude: result.restroom.latitude,
				longitude: result.restroom.longitude
			};
		}
		if (openDetails) {
			detailOpen = true;
			issuePickerOpen = false;
		}
	}

	async function applyFilters(): Promise<void> {
		filtersOpen = false;
		try {
			await refreshResults();
		} catch (error) {
			notice = error instanceof Error ? error.message : 'Filters could not be applied.';
		}
	}

	async function resetFilters(): Promise<void> {
		for (const key of Object.keys(filters) as Array<keyof ActiveFilters>) filters[key] = false;
		await applyFilters();
	}

	async function submitReport(status: ReportStatus): Promise<void> {
		if (!selected || reporting) return;
		reporting = true;
		toast = '';
		try {
			const response = await fetch(`/api/restrooms/${selected.restroom.id}/reports`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					status,
					latitude: location.latitude,
					longitude: location.longitude
				})
			});
			const body = (await response.json()) as { result?: NearbyRestroom; message?: string };
			if (!response.ok || !body.result) {
				throw new Error(body.message ?? 'Your report could not be saved.');
			}
			results = results.map((result) =>
				result.restroom.id === body.result?.restroom.id ? body.result : result
			);
			issuePickerOpen = false;
			toast =
				status === 'accessible'
					? "Thanks! You've helped the next person find a restroom."
					: 'Thanks. Your report is now helping nearby visitors.';
		} catch (error) {
			toast = error instanceof Error ? error.message : 'Your report could not be saved.';
		} finally {
			reporting = false;
		}
	}

	function directionsUrl(result: NearbyRestroom): string {
		return `https://www.google.com/maps/dir/?api=1&destination=${result.restroom.latitude},${result.restroom.longitude}`;
	}

	function startSheetDrag(event: PointerEvent): void {
		dragStartY = event.clientY;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function endSheetDrag(event: PointerEvent): void {
		const movement = event.clientY - dragStartY;
		if (movement < -35) sheetExpanded = true;
		if (movement > 35) sheetExpanded = false;
	}

	function showDetails(id: string): void {
		selectResult(id);
		detailOpen = true;
		issuePickerOpen = false;
	}

	function closeFiltersFromBackdrop(event: MouseEvent): void {
		if (event.target === event.currentTarget) filtersOpen = false;
	}

	function closeDetailsFromBackdrop(event: MouseEvent): void {
		if (event.target === event.currentTarget) detailOpen = false;
	}
</script>

<svelte:head>
	<title>Relief ATL · Find an accessible restroom</title>
	<meta
		name="description"
		content="Find Atlanta restrooms you can actually use with public GSU audit data and recent community confirmations."
	/>
</svelte:head>

<div class="app-shell">
	<aside class:started class:expanded={sheetExpanded} class="results-panel">
		<button
			type="button"
			class="sheet-handle"
			aria-label={sheetExpanded ? 'Collapse nearby results' : 'Expand nearby results'}
			aria-expanded={sheetExpanded}
			onpointerdown={startSheetDrag}
			onpointerup={endSheetDrag}
			onclick={() => (sheetExpanded = !sheetExpanded)}
		>
			<span></span>
		</button>

		<header class="brand-header">
			<a class="brand-lockup" href={resolve('/')} aria-label="Relief ATL home">
				<span class="brand-mark" aria-hidden="true">R</span>
				<span>
					<strong>Relief ATL</strong>
					<small>Atlanta restroom access</small>
				</span>
			</a>
			<a class="about-link" href={resolve('/about')}>About the data</a>
		</header>

		{#if !started}
			<section class="desktop-intro">
				<p class="eyebrow">Public data, made useful</p>
				<h1>Find a restroom you can <em>actually use.</em></h1>
				<p class="intro-copy">
					Public restroom information is often incomplete or outdated. Relief ATL combines Atlanta
					public data with recent community confirmations.
				</p>

				<button class="primary-cta" type="button" onclick={useCurrentLocation}>
					<span class="target-icon" aria-hidden="true">⌖</span>
					Find restrooms near me
				</button>

				<div class="or-divider"><span>or search Atlanta</span></div>
				<form class="intro-search" onsubmit={searchAddress}>
					<label class="sr-only" for="intro-address">Search an Atlanta address</label>
					<input
						id="intro-address"
						bind:value={searchQuery}
						placeholder="Address or neighborhood"
						autocomplete="street-address"
					/>
					<button type="submit" aria-label="Search" disabled={searching}>→</button>
				</form>

				<div class="study-proof">
					<div><strong>262</strong><span>places audited</span></div>
					<div><strong>15</strong><span>Atlanta areas</span></div>
					<div><strong>117</strong><span>accessible then</span></div>
				</div>
				<p class="research-note">
					Built using Georgia State University restroom research + community reports.
				</p>
			</section>
		{:else}
			<div class="desktop-controls">
				<form class="search-bar" onsubmit={searchAddress}>
					<span aria-hidden="true">⌕</span>
					<label class="sr-only" for="desktop-search">Search an area in Atlanta</label>
					<input
						id="desktop-search"
						bind:value={searchQuery}
						placeholder="Search an area in Atlanta"
					/>
					{#if searching}<span class="spinner" aria-label="Searching"></span>{/if}
				</form>
				<div class="control-row">
					<button class="control-button" type="button" onclick={useCurrentLocation}>
						<span aria-hidden="true">⌖</span>
						{locationLoading ? 'Locating…' : 'My location'}
					</button>
					<button class="control-button" type="button" onclick={() => (filtersOpen = true)}>
						<span aria-hidden="true">≡</span>
						Filters
						{#if activeFilterCount}
							<span class="filter-count">{activeFilterCount}</span>
						{/if}
					</button>
				</div>
			</div>

			<div class="results-heading">
				<div>
					<p class="eyebrow">Best options first</p>
					<h2>Nearby restrooms</h2>
				</div>
				<span>{results.length} shown</span>
			</div>

			{#if notice}
				<p class="notice" role="status">{notice}</p>
			{/if}

			<div class="results-scroll">
				{#each results as result (result.restroom.id)}
					<RestroomCard
						{result}
						selected={selectedId === result.restroom.id}
						onselect={() => selectResult(result.restroom.id)}
						ondetails={() => showDetails(result.restroom.id)}
					/>
				{:else}
					<div class="empty-state">
						<span aria-hidden="true">⌕</span>
						<h3>No restrooms match these filters</h3>
						<p>Try clearing a filter or searching another Atlanta area.</p>
						<button type="button" onclick={resetFilters}>Clear filters</button>
					</div>
				{/each}
			</div>

			<footer class="data-footer">
				<span class={data.databaseEnabled ? 'live-dot' : 'demo-dot'}></span>
				{data.databaseEnabled
					? 'Live confirmations stored as Tiger Data events'
					: 'Demo reports reset when the server restarts'}
			</footer>
		{/if}
	</aside>

	<main class="map-region">
		<RestroomMap
			{results}
			center={mapCenter}
			{selectedId}
			{userLocation}
			onselect={(id) => selectResult(id, true)}
		/>

		<div class="mobile-brand">
			<a class="brand-lockup" href={resolve('/')} aria-label="Relief ATL home">
				<span class="brand-mark" aria-hidden="true">R</span>
				<span><strong>Relief ATL</strong><small>Restroom access</small></span>
			</a>
			<a href={resolve('/about')} aria-label="About the data">ⓘ</a>
		</div>

		{#if started}
			<div class="mobile-controls">
				<form class="search-bar" onsubmit={searchAddress}>
					<span aria-hidden="true">⌕</span>
					<label class="sr-only" for="mobile-search">Search an area in Atlanta</label>
					<input
						id="mobile-search"
						bind:value={searchQuery}
						placeholder="Search an area in Atlanta"
					/>
				</form>
				<div class="mobile-control-row">
					<button type="button" aria-label="Use my location" onclick={useCurrentLocation}>⌖</button>
					<button type="button" onclick={() => (filtersOpen = true)}>
						≡ <span>Filters</span>
						{#if activeFilterCount}<b>{activeFilterCount}</b>{/if}
					</button>
				</div>
			</div>
		{:else}
			<section class="mobile-intro">
				<p class="eyebrow">Atlanta public restroom access</p>
				<h1>Find a restroom you can <em>actually use.</em></h1>
				<p>Public data + recent community confirmations.</p>
				<button class="primary-cta" type="button" onclick={useCurrentLocation}>
					<span aria-hidden="true">⌖</span>
					Find restrooms near me
				</button>
				<form class="intro-search" onsubmit={searchAddress}>
					<label class="sr-only" for="mobile-intro-address">Search an Atlanta address</label>
					<input
						id="mobile-intro-address"
						bind:value={searchQuery}
						placeholder="Search an Atlanta address"
					/>
					<button type="submit" aria-label="Search">→</button>
				</form>
				<a href={resolve('/about')}>Built using GSU public research →</a>
			</section>
		{/if}

		<div class="map-legend" aria-label="Map marker legend">
			<span><i class="confirmed"></i> Recent</span>
			<span><i class="likely"></i> Likely</span>
			<span><i class="unavailable"></i> Unavailable</span>
			<span><i class="uncertain"></i> Unverified</span>
		</div>
	</main>
</div>

{#if filtersOpen}
	<div class="modal-backdrop" role="presentation" onclick={closeFiltersFromBackdrop}>
		<div
			class="filter-sheet"
			role="dialog"
			aria-modal="true"
			aria-labelledby="filter-title"
			tabindex="-1"
		>
			<div class="sheet-title">
				<div>
					<p class="eyebrow">Only show what you need</p>
					<h2 id="filter-title">Filter restrooms</h2>
				</div>
				<button type="button" aria-label="Close filters" onclick={() => (filtersOpen = false)}
					>×</button
				>
			</div>

			<div class="filter-options">
				<label>
					<span><b aria-hidden="true">♿</b> Wheelchair accessible</span>
					<input type="checkbox" bind:checked={filters.wheelchairAccessible} />
				</label>
				<label>
					<span><b aria-hidden="true">♙</b> Changing table</span>
					<input type="checkbox" bind:checked={filters.changingTable} />
				</label>
				<label>
					<span><b aria-hidden="true">$</b> No purchase required</span>
					<input type="checkbox" bind:checked={filters.noPurchaseRequired} />
				</label>
				<label>
					<span><b aria-hidden="true">●</b> Recently confirmed</span>
					<input type="checkbox" bind:checked={filters.recentlyConfirmed} />
				</label>
				<label>
					<span><b aria-hidden="true">P</b> Public only</span>
					<input type="checkbox" bind:checked={filters.publicOnly} />
				</label>
			</div>

			<div class="sheet-actions">
				<button class="secondary-button" type="button" onclick={resetFilters}>Clear all</button>
				<button class="apply-button" type="button" onclick={applyFilters}>
					Show matching restrooms
				</button>
			</div>
		</div>
	</div>
{/if}

{#if detailOpen && selected}
	<div class="detail-backdrop" role="presentation" onclick={closeDetailsFromBackdrop}>
		<div
			class="detail-sheet"
			role="dialog"
			aria-modal="true"
			aria-labelledby="detail-title"
			tabindex="-1"
		>
			<div class="detail-topbar">
				<span>Restroom details</span>
				<button type="button" aria-label="Close details" onclick={() => (detailOpen = false)}
					>×</button
				>
			</div>
			<div class="detail-content">
				<div class="detail-heading">
					<p>{selected.restroom.locationType ?? 'Atlanta restroom'}</p>
					<h2 id="detail-title">{selected.restroom.name}</h2>
					{#if selected.restroom.address}<address>{selected.restroom.address}</address>{/if}
					<div class="detail-summary">
						<StatusBadge status={selected.confidence.status} />
						<strong>{selected.confidence.score}% <span>access confidence</span></strong>
					</div>
					<p class="detail-distance">
						{selected.estimatedWalkingMinutes} min walk ·
						{formatDistance(selected.distanceMeters)}
					</p>
				</div>

				<section class="current-status">
					<div class={`status-icon ${selected.confidence.status}`} aria-hidden="true">
						{selected.confidence.status === 'confirmed'
							? '✓'
							: selected.confidence.status === 'unavailable'
								? '!'
								: '?'}
					</div>
					<div>
						<h3>Current status</h3>
						<strong>{selected.confidence.reason}</strong>
						{#if selected.confidence.lastReportedAt}
							<span>Latest report {formatRelativeTime(selected.confidence.lastReportedAt)}</span>
						{:else}
							<span>No recent community report</span>
						{/if}
					</div>
				</section>

				{#if knownAttributes(selected.restroom).length}
					<section class="detail-section">
						<h3>Known access & facilities</h3>
						<div class="attribute-grid">
							{#each knownAttributes(selected.restroom) as attribute (attribute)}
								<span><i aria-hidden="true">✓</i>{attribute}</span>
							{/each}
						</div>
					</section>
				{/if}

				{#if selected.restroom.openingHours}
					<section class="detail-section">
						<h3>Hours</h3>
						<p class="hours-row">
							<span aria-hidden="true">◷</span>{selected.restroom.openingHours}
						</p>
					</section>
				{/if}

				<section class="detail-section source-section">
					<h3>Data source</h3>
					<strong>{sourceName(selected.restroom, true)}</strong>
					{#if formatAuditDate(selected.restroom.lastSourceVerifiedAt)}
						<p>
							Last source verification:
							{formatAuditDate(selected.restroom.lastSourceVerifiedAt)}
						</p>
					{/if}
					{#if selected.restroom.sourceUrl}
						<a href={selected.restroom.sourceUrl} target="_blank" rel="external noreferrer"
							>View public source ↗</a
						>
					{/if}
				</section>

				{#if selected.recentReports.length}
					<section class="detail-section">
						<div class="timeline-heading">
							<h3>Recent availability</h3>
							<span>Timestamped events</span>
						</div>
						<ol class="timeline">
							{#each selected.recentReports.slice(0, 5) as report (report.id)}
								<li class:negative={report.status !== 'accessible'}>
									<i aria-hidden="true">{report.status === 'accessible' ? '✓' : '×'}</i>
									<span>
										<strong>{REPORT_LABELS[report.status]}</strong>
										<small>{formatRelativeTime(report.createdAt)}</small>
									</span>
								</li>
							{/each}
						</ol>
					</section>
				{/if}

				<section class="confirmation-card">
					<p class="eyebrow">Help the next person</p>
					<h3>Was this information accurate?</h3>
					{#if !issuePickerOpen}
						<div class="confirmation-buttons">
							<button
								class="used-button"
								type="button"
								disabled={reporting}
								onclick={() => submitReport('accessible')}
							>
								<span aria-hidden="true">✓</span>
								I used it
							</button>
							<button
								class="failed-button"
								type="button"
								disabled={reporting}
								onclick={() => (issuePickerOpen = true)}
							>
								<span aria-hidden="true">×</span>
								Couldn't access
							</button>
						</div>
					{:else}
						<div class="issue-picker">
							<p>What happened? <span>Optional detail, one tap.</span></p>
							<div>
								{#each negativeStatuses as status (status)}
									<button type="button" disabled={reporting} onclick={() => submitReport(status)}>
										{REPORT_LABELS[status]}
									</button>
								{/each}
							</div>
							<button class="cancel-issue" type="button" onclick={() => (issuePickerOpen = false)}>
								Back
							</button>
						</div>
					{/if}
					<small>No account needed. Every report is stored as a new event.</small>
				</section>
			</div>

			<div class="detail-actions">
				<a href={directionsUrl(selected)} target="_blank" rel="external noreferrer"
					>↗ Get directions</a
				>
			</div>
		</div>
	</div>
{/if}

{#if toast}
	<div class="toast" role="status">
		<span aria-hidden="true">✓</span>
		{toast}
		<button type="button" aria-label="Dismiss message" onclick={() => (toast = '')}>×</button>
	</div>
{/if}
