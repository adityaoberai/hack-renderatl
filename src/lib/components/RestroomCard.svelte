<script lang="ts">
	import { formatDistance } from '$lib/geo';
	import { knownAttributes, provenance } from '$lib/display';
	import type { NearbyRestroom } from '$lib/types';
	import StatusBadge from './StatusBadge.svelte';

	let {
		result,
		selected = false,
		onselect,
		ondetails
	}: {
		result: NearbyRestroom;
		selected?: boolean;
		onselect: () => void;
		ondetails: () => void;
	} = $props();

	let attributes = $derived(knownAttributes(result.restroom).slice(0, 4));

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onselect();
		}
	}

	function directionsUrl(): string {
		const { latitude, longitude } = result.restroom;
		return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
	}
</script>

<div
	class={`group cursor-pointer rounded-2xl border bg-white p-4 transition duration-200 ${selected ? 'border-emerald-600 shadow-[0_0_0_2px_rgba(5,150,105,0.12)]' : 'border-stone-200 shadow-sm hover:border-stone-300 hover:shadow-md'}`}
	role="button"
	tabindex="0"
	aria-label={`View ${result.restroom.name}`}
	onclick={onselect}
	onkeydown={handleKeydown}
>
	<div class="mb-3 flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h3 class="truncate text-[17px] leading-tight font-bold text-stone-950">
				{result.restroom.name}
			</h3>
			<p class="mt-1 text-sm font-medium text-stone-500">
				{result.estimatedWalkingMinutes} min walk
				<span aria-hidden="true"> · </span>
				{formatDistance(result.distanceMeters)}
			</p>
		</div>
		<div class="shrink-0 rounded-xl bg-stone-950 px-2.5 py-2 text-center text-white">
			<strong class="block text-lg leading-none">{result.confidence.score}%</strong>
			<span class="mt-1 block text-[9px] font-semibold tracking-wide text-stone-300 uppercase"
				>confidence</span
			>
		</div>
	</div>

	<StatusBadge status={result.confidence.status} compact />
	<p class="mt-2 text-xs leading-relaxed font-medium text-stone-500">
		{result.confidence.reason}
	</p>

	{#if attributes.length}
		<div class="mt-3 flex flex-wrap gap-1.5">
			{#each attributes as attribute (attribute)}
				<span class="rounded-md bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-700">
					{attribute}
				</span>
			{/each}
		</div>
	{/if}

	<p class="mt-3 border-t border-stone-100 pt-3 text-[11px] font-medium text-stone-500">
		{provenance(result.restroom, result.confidence.lastConfirmedAt)}
	</p>

	<div class="mt-3 grid grid-cols-2 gap-2">
		<a
			class="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-800 hover:bg-stone-50"
			href={directionsUrl()}
			target="_blank"
			rel="external noreferrer"
			onclick={(event) => event.stopPropagation()}
		>
			<span aria-hidden="true">↗</span> Directions
		</a>
		<button
			class="min-h-10 rounded-xl bg-stone-950 px-3 text-sm font-bold text-white hover:bg-stone-800"
			type="button"
			onclick={(event) => {
				event.stopPropagation();
				ondetails();
			}}
		>
			View details
		</button>
	</div>
</div>
