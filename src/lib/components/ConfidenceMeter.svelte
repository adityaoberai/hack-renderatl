<script lang="ts">
	import { STATUS_STYLE } from '$lib/status';
	import type { AvailabilityStatus } from '$lib/types';

	interface Props {
		score: number;
		status: AvailabilityStatus;
		size?: 'sm' | 'md';
	}

	let { score, status, size = 'sm' }: Props = $props();

	const style = $derived(STATUS_STYLE[status]);
</script>

<div class="flex items-center gap-2">
	<div
		class="relative {size === 'md'
			? 'h-2'
			: 'h-1.5'} w-full overflow-hidden rounded-full bg-surface-sunken"
		role="meter"
		aria-valuenow={score}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label="Access confidence"
	>
		<div
			class="h-full rounded-full transition-[width] duration-500 {style.bar}"
			style:width="{Math.max(3, score)}%"
		></div>
	</div>
	<span class="tabular shrink-0 {size === 'md' ? 'text-sm' : 'text-xs'} font-bold {style.text}">
		{score}%
	</span>
</div>
