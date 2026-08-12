<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import type { Filters } from '$lib/types';

	interface Props {
		filters: Filters;
		resultCount: number;
		ontoggle: (key: keyof Filters) => void;
		onclear: () => void;
		onclose: () => void;
	}

	let { filters, resultCount, ontoggle, onclear, onclose }: Props = $props();

	const OPTIONS: Array<{ key: keyof Filters; label: string; hint: string }> = [
		{ key: 'wheelchair', label: '♿  Wheelchair accessible', hint: 'ADA stall with room to turn' },
		{ key: 'changingTable', label: '🚼  Changing table', hint: 'Baby changing station on site' },
		{
			key: 'noPurchase',
			label: '🆓  No purchase required',
			hint: 'You do not have to buy anything'
		},
		{
			key: 'recentlyConfirmed',
			label: '🟢  Recently confirmed',
			hint: 'Someone got in within the last few hours'
		},
		{ key: 'publicOnly', label: '🏛️  Public facilities only', hint: 'Publicly funded or managed' }
	];

	const activeCount = $derived(Object.values(filters).filter(Boolean).length);
</script>

<div class="flex flex-col">
	<div class="flex items-center justify-between border-b border-line px-4 py-3">
		<h2 class="text-base font-bold text-ink">Filters</h2>
		<button
			type="button"
			class="grid size-8 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
			onclick={onclose}
			aria-label="Close filters"
		>
			<X class="size-4.5" />
		</button>
	</div>

	<ul class="p-2">
		{#each OPTIONS as option (option.key)}
			{@const active = filters[option.key]}
			<li>
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors
						{active ? 'bg-brand-soft' : 'hover:bg-surface-sunken'}"
					aria-pressed={active}
					onclick={() => ontoggle(option.key)}
				>
					<span
						class="grid size-5 shrink-0 place-items-center rounded-md border-2 transition-colors
							{active ? 'border-brand bg-brand' : 'border-line-strong bg-surface'}"
						aria-hidden="true"
					>
						{#if active}<Check class="size-3.5 text-white" />{/if}
					</span>
					<span class="min-w-0">
						<span
							class="block text-[14.5px] font-semibold {active ? 'text-brand-ink' : 'text-ink'}"
						>
							{option.label}
						</span>
						<span class="block text-[12.5px] text-ink-muted">{option.hint}</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>

	<div class="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
		<button
			type="button"
			class="cursor-pointer text-[13.5px] font-semibold text-ink-muted underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
			disabled={activeCount === 0}
			onclick={onclear}
		>
			Clear all
		</button>
		<button
			type="button"
			class="cursor-pointer rounded-xl bg-brand px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-hover"
			onclick={onclose}
		>
			Show {resultCount}
			{resultCount === 1 ? 'restroom' : 'restrooms'}
		</button>
	</div>
</div>
