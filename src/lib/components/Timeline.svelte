<script lang="ts">
	import type { TimelineBucket } from '$lib/types';

	interface Props {
		buckets: TimelineBucket[];
	}

	let { buckets }: Props = $props();

	/** Show a readable strip: every third hour gets a label. */
	const cells = $derived(
		buckets.map((bucket, index) => {
			const date = new Date(bucket.bucket);
			const hour = Number(
				new Intl.DateTimeFormat('en-US', {
					timeZone: 'America/New_York',
					hour: 'numeric',
					hour12: false
				}).format(date)
			);
			const tone =
				bucket.negative > bucket.positive ? 'negative' : bucket.positive > 0 ? 'positive' : 'empty';
			const label = new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/New_York',
				hour: 'numeric',
				hour12: true
			}).format(date);
			return {
				key: bucket.bucket,
				tone,
				hour,
				label,
				showLabel: index % 4 === 0 || index === buckets.length - 1,
				title: `${label}: ${bucket.positive} accessible, ${bucket.negative} problem${bucket.negative === 1 ? '' : 's'}`
			};
		})
	);

	const hasActivity = $derived(buckets.some((b) => b.positive > 0 || b.negative > 0));
</script>

{#if hasActivity}
	<div>
		<div class="flex items-end gap-[3px]">
			{#each cells as cell (cell.key)}
				<div class="flex-1" title={cell.title}>
					<div
						class="h-7 rounded-[3px] {cell.tone === 'positive'
							? 'bg-ok'
							: cell.tone === 'negative'
								? 'bg-bad'
								: 'bg-surface-sunken'}"
					></div>
				</div>
			{/each}
		</div>
		<div class="mt-1 flex gap-[3px]">
			{#each cells as cell (cell.key)}
				<div class="flex-1 text-center text-[9px] leading-none text-ink-subtle">
					{cell.showLabel ? cell.label.replace(' ', '') : ''}
				</div>
			{/each}
		</div>
	</div>
{:else}
	<p class="text-sm text-ink-muted">No reports in the last 24 hours.</p>
{/if}
