<script lang="ts">
	import { STATUS_LABELS } from '$lib/display';
	import type { AvailabilityStatus } from '$lib/types';

	let {
		status,
		compact = false
	}: {
		status: AvailabilityStatus;
		compact?: boolean;
	} = $props();

	const styles: Record<AvailabilityStatus, string> = {
		confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
		likely: 'bg-amber-50 text-amber-900 ring-amber-200',
		unavailable: 'bg-red-50 text-red-800 ring-red-200',
		uncertain: 'bg-stone-100 text-stone-700 ring-stone-200'
	};

	const dots: Record<AvailabilityStatus, string> = {
		confirmed: 'bg-emerald-500',
		likely: 'bg-amber-400',
		unavailable: 'bg-red-500',
		uncertain: 'bg-stone-400'
	};
</script>

<span
	class={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${styles[status]} ${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'}`}
>
	<span class={`size-2 rounded-full ${dots[status]}`}></span>
	{STATUS_LABELS[status]}
</span>
