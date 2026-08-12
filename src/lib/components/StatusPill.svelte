<script lang="ts">
	import { STATUS_STYLE } from '$lib/status';
	import type { AvailabilityStatus } from '$lib/types';

	interface Props {
		status: AvailabilityStatus;
		/** Overrides the default status wording (e.g. "Confirmed just now"). */
		label?: string;
		size?: 'sm' | 'md';
		long?: boolean;
	}

	let { status, label, size = 'sm', long = false }: Props = $props();

	const style = $derived(STATUS_STYLE[status]);
	const text = $derived(label ?? (long ? style.longLabel : style.label));
</script>

<span
	class="inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold {style.pill} {size ===
	'md'
		? 'px-3 py-1 text-sm'
		: 'px-2.5 py-0.5 text-xs'}"
>
	<span class="size-2 rounded-full {style.dot}" aria-hidden="true"></span>
	{text}
</span>
