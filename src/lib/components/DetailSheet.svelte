<script lang="ts">
	import {
		Check,
		ChevronDown,
		Clock,
		Database,
		ExternalLink,
		Footprints,
		Info,
		Navigation,
		X
	} from '@lucide/svelte';
	import ConfidenceMeter from './ConfidenceMeter.svelte';
	import StatusPill from './StatusPill.svelte';
	import Timeline from './Timeline.svelte';
	import { relative } from '$lib/confidence';
	import { directionsUrl, formatDistance } from '$lib/geo';
	import { describeHoursNow, parseOpeningHours } from '$lib/hours';
	import {
		accessAttributes,
		ATTRIBUTE_TONE,
		facilityAttributes,
		sourceLabel,
		STATUS_STYLE
	} from '$lib/status';
	import { REPORT_STATUS_LABEL, type ReportStatus, type RestroomDetail } from '$lib/types';

	interface Props {
		detail: RestroomDetail | null;
		loading: boolean;
		onclose: () => void;
		onreport: (status: ReportStatus) => Promise<boolean>;
	}

	let { detail, loading, onclose, onreport }: Props = $props();

	type Mode = 'idle' | 'reasons' | 'submitting' | 'thanks';
	let mode = $state<Mode>('idle');
	let thanksMessage = $state('');
	let showFactors = $state(false);

	const NEGATIVE_REASONS: ReportStatus[] = [
		'locked',
		'closed',
		'customer_only',
		'out_of_service',
		'not_found',
		'other'
	];

	// Reset the report flow only when a *different* restroom is opened. Comparing
	// against a plain (non-reactive) variable matters: submitting a report swaps in
	// a freshly recomputed `detail` object for the same restroom, and resetting on
	// that would wipe the "Thanks!" confirmation the instant it appeared.
	let lastRestroomId: string | null = null;
	$effect(() => {
		const id = detail?.restroom.id ?? null;
		if (id === lastRestroomId) return;
		lastRestroomId = id;
		mode = 'idle';
		showFactors = false;
	});

	const r = $derived(detail?.restroom ?? null);
	const style = $derived(detail ? STATUS_STYLE[detail.availabilityStatus] : null);
	const access = $derived(r ? accessAttributes(r) : []);
	const facilities = $derived(r ? facilityAttributes(r) : []);
	const hoursNow = $derived(
		r ? describeHoursNow(parseOpeningHours(r.open24h ? '24/7' : r.openingHours), new Date()) : null
	);
	const meta = $derived((r?.sourceMetadata ?? {}) as Record<string, unknown>);
	const auditorNotes = $derived(
		Array.isArray(meta.auditorNotes) ? (meta.auditorNotes as string[]).slice(0, 3) : []
	);
	const alsoListedIn = $derived(
		(meta.alsoListedIn as { openstreetmap?: Array<{ osmUrl: string; name: string }> } | undefined)
			?.openstreetmap
	);

	async function send(status: ReportStatus) {
		mode = 'submitting';
		const ok = await onreport(status);
		if (!ok) {
			mode = 'idle';
			return;
		}
		thanksMessage =
			status === 'accessible'
				? "Thanks! You've helped the next person find a restroom."
				: 'Thanks — everyone nearby now sees that warning.';
		mode = 'thanks';
	}
</script>

{#if loading && !detail}
	<div class="grid place-items-center px-6 py-16">
		<p class="text-sm font-medium text-ink-subtle">Loading details…</p>
	</div>
{:else if detail && r && style}
	{@const walk = detail.estimatedWalkingMinutes}
	<div class="flex h-full flex-col">
		<!-- Header -->
		<header class="shrink-0 border-b border-line bg-surface px-4 pt-3 pb-4 sm:px-5">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="text-lg leading-tight font-bold text-ink sm:text-xl">{r.name}</h2>
					<p class="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
						{#if walk !== null}
							<span class="inline-flex items-center gap-1 font-medium text-ink">
								<Footprints class="size-3.5" aria-hidden="true" />
								{walk} min walk
							</span>
							{#if detail.distanceMeters !== null}
								<span aria-hidden="true">·</span>
								<span class="tabular">{formatDistance(detail.distanceMeters)}</span>
							{/if}
						{/if}
						{#if r.locationType}
							{#if walk !== null}<span aria-hidden="true">·</span>{/if}
							<span>{r.locationType}</span>
						{/if}
					</p>
					{#if r.address}
						<p class="mt-0.5 truncate text-[13px] text-ink-subtle">{r.address}</p>
					{/if}
				</div>
				<button
					type="button"
					class="-mt-1 -mr-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
					onclick={onclose}
					aria-label="Close details"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="mt-3 flex items-center gap-3">
				<StatusPill status={detail.availabilityStatus} size="md" long />
				<div class="min-w-0 flex-1">
					<ConfidenceMeter
						score={detail.confidenceScore}
						status={detail.availabilityStatus}
						size="md"
					/>
				</div>
			</div>
			<p class="mt-1.5 text-sm font-medium {style.text}">{detail.confidenceReason}</p>

			<a
				class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-hover"
				href={directionsUrl(r.latitude, r.longitude, r.name)}
				target="_blank"
				rel="noopener noreferrer"
			>
				<Navigation class="size-4" aria-hidden="true" />
				Directions
			</a>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-5">
			<!-- Community confirmation -->
			<section class="mt-4 rounded-card border border-line bg-surface-sunken p-3.5">
				{#if mode === 'thanks'}
					<div class="flex items-start gap-2.5">
						<span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ok">
							<Check class="size-3.5 text-white" aria-hidden="true" />
						</span>
						<div>
							<p class="text-sm font-semibold text-ink">{thanksMessage}</p>
							<button
								type="button"
								class="mt-1 cursor-pointer text-[13px] font-medium text-brand underline underline-offset-2"
								onclick={() => (mode = 'idle')}
							>
								Report something else
							</button>
						</div>
					</div>
				{:else if mode === 'reasons'}
					<h3 class="text-sm font-bold text-ink">What happened?</h3>
					<div class="mt-2.5 grid grid-cols-2 gap-2">
						{#each NEGATIVE_REASONS as reason (reason)}
							<button
								type="button"
								class="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-bad-line hover:bg-bad-soft"
								onclick={() => send(reason)}
							>
								{REPORT_STATUS_LABEL[reason]}
							</button>
						{/each}
					</div>
					<button
						type="button"
						class="mt-2 cursor-pointer text-[13px] font-medium text-ink-muted underline underline-offset-2"
						onclick={() => (mode = 'idle')}
					>
						Cancel
					</button>
				{:else}
					<h3 class="text-sm font-bold text-ink">Was this information accurate?</h3>
					<p class="mt-0.5 text-[12.5px] text-ink-muted">
						Anonymous. No account, no sign-in — it takes one tap.
					</p>
					<div class="mt-2.5 grid grid-cols-2 gap-2">
						<button
							type="button"
							disabled={mode === 'submitting'}
							class="cursor-pointer rounded-xl border-2 border-ok-line bg-ok-soft px-3 py-3 text-sm font-bold text-ok transition-colors hover:bg-ok hover:text-white disabled:opacity-60"
							onclick={() => send('accessible')}
						>
							✅ I used it
						</button>
						<button
							type="button"
							disabled={mode === 'submitting'}
							class="cursor-pointer rounded-xl border-2 border-bad-line bg-bad-soft px-3 py-3 text-sm font-bold text-bad transition-colors hover:bg-bad hover:text-white disabled:opacity-60"
							onclick={() => (mode = 'reasons')}
						>
							❌ Couldn't access
						</button>
					</div>
				{/if}
			</section>

			<!-- Current status -->
			<section class="mt-5">
				<h3 class="text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase">
					Current status
				</h3>
				<p class="mt-1.5 text-[15px] font-semibold text-ink">{style.longLabel}</p>
				<p class="text-[13px] text-ink-muted">
					{#if detail.lastConfirmedAt}
						Last successful use {relative(detail.lastConfirmedAt)}
					{:else if detail.lastReportAt}
						Last community report {relative(detail.lastReportAt)}
					{:else}
						No community reports yet
					{/if}
				</p>

				<button
					type="button"
					class="mt-2 inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-brand"
					onclick={() => (showFactors = !showFactors)}
					aria-expanded={showFactors}
				>
					<Info class="size-3.5" aria-hidden="true" />
					How is {detail.confidenceScore}% calculated?
					<ChevronDown
						class="size-3.5 transition-transform {showFactors ? 'rotate-180' : ''}"
						aria-hidden="true"
					/>
				</button>

				{#if showFactors}
					<ul class="mt-2 space-y-1 rounded-lg border border-line bg-surface p-3">
						{#each detail.confidenceFactors as factor (factor.label)}
							<li class="flex items-baseline justify-between gap-3 text-[13px]">
								<span class="text-ink-muted">
									{factor.label}
									{#if factor.detail}
										<span class="block text-[11.5px] text-ink-subtle">{factor.detail}</span>
									{/if}
								</span>
								<span
									class="tabular shrink-0 font-semibold {factor.delta > 0
										? 'text-ok'
										: factor.delta < 0
											? 'text-bad'
											: 'text-ink-subtle'}"
								>
									{factor.delta > 0 ? '+' : ''}{factor.delta}
								</span>
							</li>
						{/each}
						<li
							class="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13px] font-bold"
						>
							<span class="text-ink">Access confidence</span>
							<span class="tabular {style.text}">{detail.confidenceScore}%</span>
						</li>
					</ul>
				{/if}
			</section>

			<!-- Access -->
			{#if access.length}
				<section class="mt-5">
					<h3 class="text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase">Access</h3>
					<ul class="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
						{#each access as item (item.label)}
							<li
								class="flex items-center justify-between gap-2 border-b border-line/70 py-1.5 text-[13.5px] last:border-0"
							>
								<span class="text-ink-muted">{item.label}</span>
								<span class="shrink-0 font-semibold {ATTRIBUTE_TONE[item.tone]}"
									>{item.display}</span
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Facilities -->
			{#if facilities.length}
				<section class="mt-5">
					<h3 class="text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase">
						Facilities
					</h3>
					<ul class="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
						{#each facilities as item (item.label)}
							<li
								class="flex items-center justify-between gap-2 border-b border-line/70 py-1.5 text-[13.5px] last:border-0"
							>
								<span class="text-ink-muted">{item.label}</span>
								<span class="shrink-0 font-semibold {ATTRIBUTE_TONE[item.tone]}"
									>{item.display}</span
								>
							</li>
						{/each}
					</ul>
					<p class="mt-1.5 text-[11.5px] text-ink-subtle">
						Only attributes the source actually recorded are listed. Anything missing was not
						measured.
					</p>
				</section>
			{/if}

			<!-- Hours -->
			{#if hoursNow || r.openingHours}
				<section class="mt-5">
					<h3 class="text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase">Hours</h3>
					<p class="mt-1.5 inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink">
						<Clock class="size-4 text-ink-muted" aria-hidden="true" />
						{hoursNow ?? r.openingHours}
					</p>
					{#if hoursNow && r.openingHours && hoursNow !== r.openingHours}
						<p class="text-[13px] text-ink-muted">{r.openingHours}</p>
					{/if}
				</section>
			{/if}

			<!-- Tiger Data: the time series -->
			<section class="mt-5 rounded-card border border-line bg-surface p-3.5">
				<div class="flex items-center justify-between gap-2">
					<h3
						class="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase"
					>
						<Database class="size-3.5" aria-hidden="true" />
						Availability over time
					</h3>
					{#if detail.reliability}
						<span class="tabular text-[13px] font-bold text-ink">
							{detail.reliability.percent}% reliable
						</span>
					{/if}
				</div>

				{#if detail.reliability}
					<p class="mt-0.5 text-[12px] text-ink-muted">
						{detail.reliability.percent}% of {detail.reliability.sampleSize} reports in the last
						{detail.reliability.windowDays} days successfully accessed this restroom.
					</p>
				{/if}

				<div class="mt-3">
					<Timeline buckets={detail.timeline} />
				</div>

				{#if detail.recentReports.length}
					<ol class="mt-3 space-y-1 border-t border-line pt-2.5">
						{#each detail.recentReports.slice(0, 6) as report (report.id)}
							<li class="flex items-center gap-2 text-[12.5px]">
								<span
									class="size-1.5 shrink-0 rounded-full {report.status === 'accessible'
										? 'bg-ok'
										: 'bg-bad'}"
									aria-hidden="true"
								></span>
								<span class="font-medium text-ink">{REPORT_STATUS_LABEL[report.status]}</span>
								<span class="ml-auto tabular text-ink-subtle">{relative(report.createdAt)}</span>
							</li>
						{/each}
					</ol>
					<p class="mt-2 text-[11.5px] leading-snug text-ink-subtle">
						Every confirmation is stored as its own timestamped event — nothing is overwritten, so
						this location keeps its full history.
					</p>
				{/if}
			</section>

			<!-- Provenance -->
			<section class="mt-5">
				<h3 class="text-[11px] font-bold tracking-[0.07em] text-ink-subtle uppercase">
					Data source
				</h3>
				<p class="mt-1.5 text-[14px] font-semibold text-ink">{sourceLabel(r.source)}</p>

				{#if r.source === 'gsu'}
					<p class="text-[13px] text-ink-muted">
						{#if r.originalAuditDate}
							Physically audited
							{new Date(r.originalAuditDate).toLocaleDateString('en-US', {
								month: 'long',
								day: 'numeric',
								year: 'numeric'
							})}
						{:else}
							Physically audited in 2025
						{/if}
						{#if meta.studyArea}· {meta.studyArea}{/if}
					</p>
					{#if meta.restroomsAudited}
						<p class="text-[13px] text-ink-muted">
							{meta.restroomsAudited}
							{Number(meta.restroomsAudited) === 1 ? 'restroom' : 'restrooms'} audited at this location
						</p>
					{/if}
				{:else if r.source === 'osm'}
					<p class="text-[13px] text-ink-muted">
						Community-maintained map listing. Nobody has physically verified this restroom for
						Relief ATL.
					</p>
				{/if}

				{#if auditorNotes.length}
					<ul class="mt-2 space-y-1">
						{#each auditorNotes as note (note)}
							<li
								class="rounded-lg border-l-2 border-line-strong bg-surface-sunken px-2.5 py-1.5 text-[12.5px] text-ink-muted"
							>
								“{note}”
							</li>
						{/each}
					</ul>
					<p class="mt-1 text-[11px] text-ink-subtle">
						Auditor notes from the original field visit.
					</p>
				{/if}

				<div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
					{#if r.sourceUrl}
						<a
							class="inline-flex items-center gap-1 text-[13px] font-medium text-brand underline underline-offset-2"
							href={r.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							View source data
							<ExternalLink class="size-3" aria-hidden="true" />
						</a>
					{/if}
					{#if alsoListedIn?.length}
						<a
							class="inline-flex items-center gap-1 text-[13px] font-medium text-brand underline underline-offset-2"
							href={alsoListedIn[0].osmUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							Also listed in OpenStreetMap
							<ExternalLink class="size-3" aria-hidden="true" />
						</a>
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}
