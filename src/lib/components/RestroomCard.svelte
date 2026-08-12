<script lang="ts">
	import { ArrowUpRight, Footprints, Navigation } from '@lucide/svelte';
	import ConfidenceMeter from './ConfidenceMeter.svelte';
	import StatusPill from './StatusPill.svelte';
	import { cardAttributes, provenanceLine, STATUS_STYLE } from '$lib/status';
	import { directionsUrl, formatDistance } from '$lib/geo';
	import type { NearbyRestroom } from '$lib/types';

	interface Props {
		entry: NearbyRestroom;
		selected?: boolean;
		onselect: (id: string) => void;
	}

	let { entry, selected = false, onselect }: Props = $props();

	const r = $derived(entry.restroom);
	const style = $derived(STATUS_STYLE[entry.availabilityStatus]);
	const chips = $derived(cardAttributes(r));
	const provenance = $derived(provenanceLine(entry));
</script>

<article
	class="group relative rounded-card border bg-surface transition-shadow
		{selected ? 'border-brand shadow-lift ring-1 ring-brand' : 'border-line hover:shadow-lift'}"
>
	<!-- The status stripe makes the colour readable at arm's length outdoors. -->
	<span class="absolute inset-y-0 left-0 w-1 rounded-l-card {style.bar}" aria-hidden="true"></span>

	<button
		type="button"
		class="block w-full cursor-pointer px-4 py-3.5 pl-5 text-left"
		onclick={() => onselect(r.id)}
		aria-expanded={selected}
	>
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-[15px] leading-snug font-semibold text-ink">{r.name}</h3>
				<p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
					{#if entry.estimatedWalkingMinutes !== null}
						<span class="inline-flex items-center gap-1 font-medium text-ink">
							<Footprints class="size-3.5" aria-hidden="true" />
							{entry.estimatedWalkingMinutes} min walk
						</span>
						{#if entry.distanceMeters !== null}
							<span aria-hidden="true">·</span>
							<span class="tabular">{formatDistance(entry.distanceMeters)}</span>
						{/if}
					{/if}
					{#if r.locationType}
						{#if entry.estimatedWalkingMinutes !== null}<span aria-hidden="true">·</span>{/if}
						<span class="truncate">{r.locationType}</span>
					{/if}
				</p>
			</div>
			<StatusPill status={entry.availabilityStatus} />
		</div>

		<div class="mt-3">
			<ConfidenceMeter score={entry.confidenceScore} status={entry.availabilityStatus} />
			<p class="mt-1.5 text-[13px] font-medium {style.text}">{entry.confidenceReason}</p>
		</div>

		{#if chips.length}
			<ul class="mt-2.5 flex flex-wrap gap-1.5">
				{#each chips as chip (chip)}
					<li
						class="rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-muted"
					>
						{chip}
					</li>
				{/each}
			</ul>
		{/if}

		<p class="mt-2.5 text-[11.5px] leading-tight text-ink-subtle">{provenance}</p>
	</button>

	<div class="flex items-center gap-2 border-t border-line px-4 py-2 pl-5">
		<a
			class="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-hover"
			href={directionsUrl(r.latitude, r.longitude, r.name)}
			target="_blank"
			rel="noopener noreferrer"
		>
			<Navigation class="size-3.5" aria-hidden="true" />
			Directions
		</a>
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
			onclick={() => onselect(r.id)}
		>
			View details
			<ArrowUpRight class="size-3.5" aria-hidden="true" />
		</button>
	</div>
</article>
