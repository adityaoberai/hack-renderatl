<script lang="ts">
	import {
		AlertCircle,
		Crosshair,
		List,
		Loader2,
		Map as MapIcon,
		Search,
		SlidersHorizontal
	} from '@lucide/svelte';
	import DetailSheet from '$lib/components/DetailSheet.svelte';
	import FilterSheet from '$lib/components/FilterSheet.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import RestroomCard from '$lib/components/RestroomCard.svelte';
	import { resolve } from '$app/paths';
	import { ReliefState } from '$lib/state.svelte';
	import { STATUS_ORDER, STATUS_STYLE } from '$lib/status';
	import type { ReportStatus } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const app = new ReliefState();

	let searchTerm = $state('');
	let searching = $state(false);

	async function runSearch(event: SubmitEvent) {
		event.preventDefault();
		if (!searchTerm.trim()) return;
		searching = true;
		await app.searchArea(searchTerm);
		searching = false;
	}

	/* ----------------------------------------------------- mobile bottom sheet */

	const PEEK_PX = 148;
	let sheetElement = $state<HTMLElement | null>(null);
	let sheetHeight = $state(0);
	let sheetOffset = $state(0);
	let dragging = $state(false);
	let dragStartY = 0;
	let dragStartOffset = 0;

	const snapPoints = $derived(
		sheetHeight > 0 ? [0, Math.round(sheetHeight * 0.45), Math.max(0, sheetHeight - PEEK_PX)] : [0]
	);

	$effect(() => {
		// Start at the middle detent once we know how tall the sheet is.
		if (sheetHeight > 0 && sheetOffset === 0 && !dragging) {
			sheetOffset = snapPoints[1];
		}
	});

	function snapTo(target: number) {
		sheetOffset = target;
	}

	function onHandleDown(event: PointerEvent) {
		dragging = true;
		dragStartY = event.clientY;
		dragStartOffset = sheetOffset;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onHandleMove(event: PointerEvent) {
		if (!dragging) return;
		const next = dragStartOffset + (event.clientY - dragStartY);
		sheetOffset = Math.min(Math.max(next, 0), snapPoints[2]);
	}

	function onHandleUp() {
		if (!dragging) return;
		dragging = false;
		// Snap to whichever detent is closest.
		sheetOffset = snapPoints.reduce((best, point) =>
			Math.abs(point - sheetOffset) < Math.abs(best - sheetOffset) ? point : best
		);
	}

	const sheetIsOpen = $derived(sheetOffset < snapPoints[2] - 20);

	function selectFromList(id: string) {
		void app.select(id, { fly: true });
	}

	function selectFromMap(id: string) {
		void app.select(id);
		if (sheetOffset > snapPoints[1]) snapTo(snapPoints[1]);
	}

	async function report(status: ReportStatus): Promise<boolean> {
		return app.submitReport(status);
	}

	/** Escape closes the topmost sheet, innermost first. */
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (app.filtersOpen) app.filtersOpen = false;
		else if (app.selectedId) app.closeDetail();
	}

	const statusCounts = $derived.by(() => {
		const counts = { confirmed: 0, likely: 0, uncertain: 0, unavailable: 0 };
		for (const entry of app.results) counts[entry.availabilityStatus]++;
		return counts;
	});
</script>

<svelte:head>
	<title>Relief ATL — Find a restroom you can actually use</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="relative flex h-dvh w-full flex-col overflow-hidden bg-paper">
	{#if app.phase === 'landing'}
		<!-- ------------------------------------------------------------ Landing -->
		<main class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
			<div class="w-full max-w-md">
				<div class="flex items-center gap-2">
					<span
						class="grid size-8 place-items-center rounded-lg bg-brand text-[15px] font-black text-white"
						>R</span
					>
					<span class="text-[15px] font-bold tracking-tight text-ink">Relief ATL</span>
				</div>

				<h1 class="mt-6 text-[2.1rem] leading-[1.1] font-extrabold text-ink sm:text-[2.5rem]">
					Find a restroom you can actually use.
				</h1>

				<p class="mt-4 text-[15px] leading-relaxed text-ink-muted">
					Public restroom information is often incomplete or outdated. Relief ATL combines publicly
					available Atlanta restroom data with recent community confirmations to help you find the
					best available option nearby.
				</p>

				<button
					type="button"
					class="mt-7 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-[16px] font-bold text-white transition-colors hover:bg-brand-hover disabled:opacity-70"
					onclick={() => app.useMyLocation()}
					disabled={app.locating}
				>
					{#if app.locating}
						<Loader2 class="size-5 animate-spin" aria-hidden="true" />
						Finding you…
					{:else}
						<Crosshair class="size-5" aria-hidden="true" />
						Find restrooms near me
					{/if}
				</button>

				<form class="mt-3 flex gap-2" onsubmit={runSearch}>
					<label class="sr-only" for="landing-search">Search an Atlanta address</label>
					<div class="relative flex-1">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
							aria-hidden="true"
						/>
						<input
							id="landing-search"
							bind:value={searchTerm}
							class="w-full rounded-2xl border border-line bg-surface py-3.5 pr-3 pl-9 text-[15px] text-ink placeholder:text-ink-subtle"
							placeholder="Search an Atlanta address"
							autocomplete="off"
						/>
					</div>
					<button
						type="submit"
						class="cursor-pointer rounded-2xl border border-line bg-surface px-4 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-sunken disabled:opacity-60"
						disabled={searching || !searchTerm.trim()}
					>
						{searching ? '…' : 'Go'}
					</button>
				</form>

				{#if app.locationError}
					<p class="mt-3 flex items-start gap-1.5 text-[13px] text-warn">
						<AlertCircle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
						{app.locationError}
					</p>
				{/if}

				<button
					type="button"
					class="mt-3 w-full cursor-pointer text-[14px] font-semibold text-brand underline underline-offset-2"
					onclick={() => app.browseAtlanta()}
				>
					Or browse central Atlanta
				</button>

				<p class="mt-8 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-muted">
					Built using public Atlanta restroom research and recent community confirmations —
					<span class="font-semibold text-ink">{data.summary.gsu} locations</span>
					physically audited by Georgia State University researchers, plus
					<span class="font-semibold text-ink">{data.summary.osm}</span> from OpenStreetMap.
				</p>
				<a
					class="mt-2 inline-block text-[13px] font-semibold text-brand underline underline-offset-2"
					href={resolve('/about')}>About the data</a
				>
			</div>
		</main>
	{:else}
		<!-- ---------------------------------------------------------- Application -->
		<div class="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(360px,35%)_1fr]">
			<!-- Sidebar: desktop -->
			<aside class="relative hidden min-h-0 flex-col border-r border-line bg-paper lg:flex">
				<header class="shrink-0 border-b border-line bg-surface px-4 py-3">
					<div class="flex items-center justify-between gap-2">
						<a href={resolve('/')} class="flex items-center gap-2">
							<span
								class="grid size-7 place-items-center rounded-lg bg-brand text-[13px] font-black text-white"
								>R</span
							>
							<span class="text-[14px] font-bold tracking-tight text-ink">Relief ATL</span>
						</a>
						<a
							class="text-[12.5px] font-semibold text-brand underline underline-offset-2"
							href={resolve('/about')}
						>
							About the data
						</a>
					</div>

					<form class="mt-3 flex gap-2" onsubmit={runSearch}>
						<div class="relative flex-1">
							<Search
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
								aria-hidden="true"
							/>
							<input
								bind:value={searchTerm}
								class="w-full rounded-xl border border-line bg-paper py-2.5 pr-3 pl-9 text-[14px] text-ink placeholder:text-ink-subtle"
								placeholder="Search an area in Atlanta"
								aria-label="Search an area in Atlanta"
								autocomplete="off"
							/>
						</div>
						<button
							type="button"
							class="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-surface-sunken"
							onclick={() => app.useMyLocation()}
							aria-label="Use my current location"
							title="Use my current location"
						>
							{#if app.locating}
								<Loader2 class="size-4 animate-spin" />
							{:else}
								<Crosshair class="size-4" />
							{/if}
						</button>
						<button
							type="button"
							class="relative grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border transition-colors
								{app.activeFilterCount
								? 'border-brand bg-brand-soft text-brand-ink'
								: 'border-line bg-surface text-ink hover:bg-surface-sunken'}"
							onclick={() => (app.filtersOpen = !app.filtersOpen)}
							aria-label="Filters"
							aria-expanded={app.filtersOpen}
						>
							<SlidersHorizontal class="size-4" />
							{#if app.activeFilterCount}
								<span
									class="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full bg-brand text-[10px] font-bold text-white"
								>
									{app.activeFilterCount}
								</span>
							{/if}
						</button>
					</form>

					<div class="mt-2.5 flex items-center justify-between gap-2">
						<p class="truncate text-[12.5px] text-ink-muted">
							{#if app.loading}
								Searching near {app.origin?.label ?? 'Atlanta'}…
							{:else}
								<span class="font-semibold text-ink">{app.results.length}</span>
								{app.results.length === 1 ? 'restroom' : 'restrooms'} near
								<span class="font-medium text-ink">{app.origin?.label ?? 'Atlanta'}</span>
							{/if}
						</p>
						<div class="flex shrink-0 items-center gap-1.5">
							{#each STATUS_ORDER as status (status)}
								{#if statusCounts[status] > 0}
									<span
										class="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted"
									>
										<span class="size-2 rounded-full {STATUS_STYLE[status].dot}" aria-hidden="true"
										></span>
										{statusCounts[status]}
									</span>
								{/if}
							{/each}
						</div>
					</div>
				</header>

				<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
					{#if app.loadError}
						<div class="rounded-card border border-bad-line bg-bad-soft p-3 text-[13.5px] text-bad">
							{app.loadError}
						</div>
					{/if}

					{#if !app.loading && !app.results.length && !app.loadError}
						<div class="rounded-card border border-line bg-surface p-5 text-center">
							<p class="text-[14px] font-semibold text-ink">No restrooms match those filters.</p>
							<p class="mt-1 text-[13px] text-ink-muted">
								Try clearing a filter or searching a different area.
							</p>
							{#if app.activeFilterCount}
								<button
									type="button"
									class="mt-3 cursor-pointer rounded-lg bg-brand px-3 py-2 text-[13px] font-semibold text-white"
									onclick={() => app.clearFilters()}
								>
									Clear filters
								</button>
							{/if}
						</div>
					{/if}

					<ul class="space-y-2.5">
						{#each app.results as entry (entry.restroom.id)}
							<li>
								<RestroomCard
									{entry}
									selected={app.selectedId === entry.restroom.id}
									onselect={selectFromList}
								/>
							</li>
						{/each}
					</ul>
				</div>

				<footer class="shrink-0 border-t border-line bg-surface px-4 py-2.5">
					<p class="text-[11.5px] leading-snug text-ink-subtle">
						Powered by public Atlanta restroom data — GSU restroom research + OpenStreetMap +
						anonymous community reports.
					</p>
				</footer>

				<!-- Filters slide over the list on desktop -->
				{#if app.filtersOpen}
					<div
						class="absolute inset-x-0 bottom-0 top-[132px] z-30 overflow-y-auto bg-surface shadow-lift"
					>
						<FilterSheet
							filters={app.filters}
							resultCount={app.results.length}
							ontoggle={(key) => app.toggleFilter(key)}
							onclear={() => app.clearFilters()}
							onclose={() => (app.filtersOpen = false)}
						/>
					</div>
				{/if}

				<!-- Detail slides over the sidebar so the map stays visible -->
				{#if app.selectedId}
					<div class="absolute inset-0 z-40 bg-surface shadow-lift">
						<DetailSheet
							detail={app.detail}
							loading={app.detailLoading}
							onclose={() => app.closeDetail()}
							onreport={report}
						/>
					</div>
				{/if}
			</aside>

			<!-- Map -->
			<div class="relative min-h-0">
				<MapView
					results={app.results}
					selectedId={app.selectedId}
					origin={app.origin}
					flyTo={app.flyTo}
					onselect={selectFromMap}
				/>

				<!-- Mobile top bar -->
				<div class="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 lg:hidden">
					<div class="pointer-events-auto flex gap-2">
						<form class="relative flex-1" onsubmit={runSearch}>
							<Search
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
								aria-hidden="true"
							/>
							<input
								bind:value={searchTerm}
								class="w-full rounded-2xl border border-line bg-surface py-3 pr-3 pl-9 text-[15px] text-ink shadow-lift placeholder:text-ink-subtle"
								placeholder="Search an area in Atlanta"
								aria-label="Search an area in Atlanta"
								autocomplete="off"
							/>
						</form>
						<button
							type="button"
							class="relative grid size-[46px] shrink-0 cursor-pointer place-items-center rounded-2xl border shadow-lift transition-colors
								{app.activeFilterCount ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink'}"
							onclick={() => (app.filtersOpen = true)}
							aria-label="Filters"
						>
							<SlidersHorizontal class="size-5" />
							{#if app.activeFilterCount}
								<span
									class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-[10px] font-bold text-white"
								>
									{app.activeFilterCount}
								</span>
							{/if}
						</button>
					</div>
				</div>

				<!-- Floating controls -->
				<div class="absolute right-3 bottom-[168px] z-20 flex flex-col gap-2 lg:bottom-24">
					<button
						type="button"
						class="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-brand shadow-lift transition-colors hover:bg-surface-sunken"
						onclick={() => app.useMyLocation()}
						aria-label="Recentre on my location"
						title="Recentre on my location"
					>
						{#if app.locating}
							<Loader2 class="size-5 animate-spin" />
						{:else}
							<Crosshair class="size-5" />
						{/if}
					</button>
				</div>

				<!-- Map legend: desktop -->
				<div
					class="absolute bottom-4 left-4 z-20 hidden rounded-xl border border-line bg-surface/95 px-3 py-2.5 shadow-lift lg:block"
				>
					<p class="text-[10px] font-bold tracking-[0.07em] text-ink-subtle uppercase">
						Availability
					</p>
					<ul class="mt-1.5 space-y-1">
						{#each STATUS_ORDER as status (status)}
							<li class="flex items-center gap-2 text-[12px] text-ink-muted">
								<span class="size-2.5 rounded-full {STATUS_STYLE[status].dot}" aria-hidden="true"
								></span>
								{STATUS_STYLE[status].longLabel}
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>

		<!-- ------------------------------------------------- Mobile results sheet -->
		<section
			bind:this={sheetElement}
			bind:clientHeight={sheetHeight}
			class="fixed inset-x-0 bottom-0 z-30 flex h-[88dvh] flex-col rounded-t-3xl border-t border-line bg-paper shadow-sheet lg:hidden"
			style:transform="translateY({sheetOffset}px)"
			style:transition={dragging ? 'none' : 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)'}
			aria-label="Nearby restrooms"
		>
			<div
				class="shrink-0 cursor-grab touch-none px-4 pt-2.5 pb-1 active:cursor-grabbing"
				onpointerdown={onHandleDown}
				onpointermove={onHandleMove}
				onpointerup={onHandleUp}
				onpointercancel={onHandleUp}
				role="separator"
				aria-label="Drag to resize the results panel"
			>
				<div class="mx-auto h-1.5 w-11 rounded-full bg-line-strong"></div>
			</div>

			<button
				type="button"
				class="flex w-full shrink-0 cursor-pointer items-center justify-between gap-3 px-4 pt-1 pb-3 text-left"
				onclick={() => snapTo(sheetIsOpen ? snapPoints[2] : snapPoints[1])}
				aria-label={sheetIsOpen ? 'Collapse results and show the map' : 'Expand the results list'}
			>
				<div class="min-w-0">
					<p class="flex items-center gap-1.5 text-[15px] font-bold text-ink">
						{#if app.loading}
							Searching…
						{:else}
							{app.results.length}
							{app.results.length === 1 ? 'restroom' : 'restrooms'} nearby
						{/if}
						{#if sheetIsOpen}
							<MapIcon class="size-3.5 text-ink-subtle" aria-hidden="true" />
						{/if}
					</p>
					<p class="truncate text-[12.5px] text-ink-muted">
						Ranked by whether you can get in · {app.origin?.label ?? 'Atlanta'}
					</p>
				</div>
				<span class="flex shrink-0 items-center gap-1.5">
					{#each STATUS_ORDER as status (status)}
						{#if statusCounts[status] > 0}
							<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
								<span class="size-2 rounded-full {STATUS_STYLE[status].dot}" aria-hidden="true"
								></span>
								{statusCounts[status]}
							</span>
						{/if}
					{/each}
				</span>
			</button>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-24">
				{#if app.loadError}
					<div class="rounded-card border border-bad-line bg-bad-soft p-3 text-[13.5px] text-bad">
						{app.loadError}
					</div>
				{/if}

				{#if !app.loading && !app.results.length && !app.loadError}
					<div class="rounded-card border border-line bg-surface p-5 text-center">
						<p class="text-[14px] font-semibold text-ink">No restrooms match those filters.</p>
						{#if app.activeFilterCount}
							<button
								type="button"
								class="mt-3 cursor-pointer rounded-lg bg-brand px-3 py-2 text-[13px] font-semibold text-white"
								onclick={() => app.clearFilters()}
							>
								Clear filters
							</button>
						{/if}
					</div>
				{/if}

				<ul class="space-y-2.5">
					{#each app.results as entry (entry.restroom.id)}
						<li>
							<RestroomCard
								{entry}
								selected={app.selectedId === entry.restroom.id}
								onselect={selectFromList}
							/>
						</li>
					{/each}
				</ul>
			</div>
		</section>

		<!--
			Mobile map / list affordance. It rides just above the collapsed sheet
			rather than pinning to the bottom of the screen, where it would sit on
			top of the first peeking result card. Once the sheet is open the list is
			already on screen, so the pill gets out of the way — the drag handle and
			the sheet header both collapse it again.
		-->
		{#if !sheetIsOpen}
			<div
				class="pointer-events-none fixed inset-x-0 z-40 flex justify-center lg:hidden"
				style:bottom="{PEEK_PX + 14}px"
			>
				<button
					type="button"
					class="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white shadow-lift"
					onclick={() => snapTo(snapPoints[0])}
				>
					<List class="size-4" aria-hidden="true" />
					View {app.results.length} results
				</button>
			</div>
		{/if}

		<!-- Mobile filter sheet -->
		{#if app.filtersOpen}
			<div class="fixed inset-0 z-50 lg:hidden">
				<!-- Tap-outside-to-dismiss. Keyboard users get the labelled ✕ inside the
				     sheet instead, so this stays out of the tab order. -->
				<button
					type="button"
					tabindex="-1"
					class="absolute inset-0 cursor-default bg-ink/40"
					onclick={() => (app.filtersOpen = false)}
					aria-label="Dismiss"
				></button>
				<div class="pb-safe absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface shadow-sheet">
					<FilterSheet
						filters={app.filters}
						resultCount={app.results.length}
						ontoggle={(key) => app.toggleFilter(key)}
						onclear={() => app.clearFilters()}
						onclose={() => (app.filtersOpen = false)}
					/>
				</div>
			</div>
		{/if}

		<!-- Mobile detail sheet -->
		{#if app.selectedId}
			<div class="fixed inset-0 z-50 lg:hidden">
				<button
					type="button"
					tabindex="-1"
					class="absolute inset-0 cursor-default bg-ink/40"
					onclick={() => app.closeDetail()}
					aria-label="Dismiss"
				></button>
				<div
					class="absolute inset-x-0 bottom-0 h-[92dvh] overflow-hidden rounded-t-3xl bg-surface shadow-sheet"
				>
					<DetailSheet
						detail={app.detail}
						loading={app.detailLoading}
						onclose={() => app.closeDetail()}
						onreport={report}
					/>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Toast -->
	{#if app.toast}
		<div
			class="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 lg:bottom-8"
			role="status"
			aria-live="polite"
		>
			<p
				class="rounded-xl px-4 py-3 text-[14px] font-semibold text-white shadow-lift
					{app.toast.tone === 'ok' ? 'bg-ok' : 'bg-ink'}"
			>
				{app.toast.message}
			</p>
		</div>
	{/if}
</div>
