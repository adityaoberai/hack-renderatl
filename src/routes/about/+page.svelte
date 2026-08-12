<script lang="ts">
	import { ArrowLeft, Database, ExternalLink, FileText, MapPin } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { STATUS_ORDER, STATUS_STYLE } from '$lib/status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const PAPER_URL = 'https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574';
	const OSF_URL = 'https://osf.io/fm9by';

	const STUDY = [
		{ value: '262', label: 'potential restroom locations audited', small: false },
		{ value: '15', label: 'areas of Atlanta', small: false },
		{ value: 'Feb–Apr 2025', label: 'field work window', small: true },
		{ value: '117', label: 'locations had an accessible restroom when visited', small: false }
	];
</script>

<svelte:head>
	<title>About the data — Relief ATL</title>
	<meta
		name="description"
		content="Relief ATL is built on a Georgia State University audit of 262 potential public restroom locations across Atlanta, layered with anonymous community confirmations."
	/>
</svelte:head>

<div class="min-h-dvh bg-paper">
	<header class="border-b border-line bg-surface">
		<div class="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3.5">
			<a
				href={resolve('/')}
				class="inline-flex items-center gap-2 text-[14px] font-semibold text-ink"
			>
				<ArrowLeft class="size-4" aria-hidden="true" />
				Relief ATL
			</a>
			<span class="text-[12.5px] text-ink-subtle">Data transparency</span>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-5 pb-20">
		<h1 class="mt-9 text-[2rem] leading-[1.12] font-extrabold text-ink sm:text-[2.4rem]">
			Knowing that a restroom exists is not enough.
		</h1>
		<p class="mt-4 text-[16px] leading-relaxed text-ink-muted">
			Relief ATL starts with public data from a Georgia State University study of restroom
			accessibility in Atlanta. Researchers physically visited candidate locations instead of
			relying on map listings — and what they found is the reason this app exists.
		</p>

		<!-- Headline study numbers -->
		<section class="mt-8">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">The study</h2>
			<dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each STUDY as item (item.label)}
					<div class="rounded-card border border-line bg-surface p-3.5">
						<dt
							class="font-extrabold text-ink {item.small
								? 'text-[17px] leading-tight sm:text-[19px]'
								: 'text-[22px] leading-none sm:text-[26px]'}"
						>
							{item.value}
						</dt>
						<dd class="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{item.label}</dd>
					</div>
				{/each}
			</dl>
			<p class="mt-3 text-[14px] leading-relaxed text-ink-muted">
				Of the 262 locations, <span class="font-semibold text-ink">145 were inaccessible</span> — no public
				restroom at all, "customers only" signage, locked doors, or occupied for more than ten minutes.
				That is the gap between a restroom appearing on a map and a person being able to use it.
			</p>
		</section>

		<!-- Three different things -->
		<section class="mt-9">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">
				Three different questions
			</h2>
			<div class="mt-3 space-y-2.5">
				<div class="rounded-card border border-line bg-surface p-4">
					<h3 class="text-[15px] font-bold text-ink">Existence</h3>
					<p class="mt-1 text-[14px] leading-relaxed text-ink-muted">
						A dataset says a restroom is here. That is all an ordinary map can tell you.
					</p>
				</div>
				<div class="rounded-card border border-line bg-surface p-4">
					<h3 class="text-[15px] font-bold text-ink">Verified accessibility</h3>
					<p class="mt-1 text-[14px] leading-relaxed text-ink-muted">
						Somebody physically went there and confirmed the restroom could be used. The
						{data.summary.bySource.gsu ?? 117} GSU locations in Relief ATL all clear this bar — as of
						the 2025 field visits.
					</p>
				</div>
				<div class="rounded-card border border-line bg-surface p-4">
					<h3 class="text-[15px] font-bold text-ink">Current availability</h3>
					<p class="mt-1 text-[14px] leading-relaxed text-ink-muted">
						Somebody confirmed recently that it is accessible right now. This is the only one that
						helps when you urgently need a restroom — and it is the one that goes stale fastest.
					</p>
				</div>
			</div>
		</section>

		<!-- Why the live layer -->
		<section class="mt-9">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">
				Static data goes stale
			</h2>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-muted">
				A restroom that was accessible in April 2025 can be locked today. Relief ATL layers recent
				anonymous community confirmations on top of the public datasets so you can see whether a
				restroom is likely to be available <em>now</em>. Every confirmation is stored as its own
				timestamped event in
				<span class="font-semibold text-ink">Tiger Data</span> — nothing is ever overwritten, so each
				location accumulates a real availability history:
			</p>

			<pre
				class="mt-3 overflow-x-auto rounded-card border border-line bg-surface p-4 font-mono text-[12.5px] leading-relaxed text-ink-muted"><code
					>9:12 AM   ✅ Accessible
10:44 AM  ✅ Accessible
1:03 PM   ❌ Locked
1:29 PM   ❌ Locked
3:18 PM   ✅ Accessible</code
				></pre>

			<p class="mt-3 text-[15px] leading-relaxed text-ink-muted">
				That history is what lets the app decide whether older information should still be trusted.
				A 2025 audit is good evidence — right up until two people report a locked door in the last
				twenty minutes.
			</p>
		</section>

		<!-- Confidence -->
		<section class="mt-9">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">
				How access confidence works
			</h2>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-muted">
				Each restroom gets a 0–100 score answering one question: how confident are we that someone
				can use this restroom right now? It is a deterministic calculation — no machine learning, no
				guessing — and you can open any restroom's detail view to see the exact factors that
				produced its number.
			</p>
			<ul class="mt-3 space-y-1.5">
				{#each STATUS_ORDER as status (status)}
					<li class="flex items-start gap-2.5 text-[14px]">
						<span
							class="mt-1.5 size-2.5 shrink-0 rounded-full {STATUS_STYLE[status].dot}"
							aria-hidden="true"
						></span>
						<span>
							<span class="font-semibold text-ink">{STATUS_STYLE[status].longLabel}</span>
							<span class="text-ink-muted">
								{#if status === 'confirmed'}
									— someone reported successfully using it within the last few hours.
								{:else if status === 'likely'}
									— physically audited as usable, but not confirmed lately.
								{:else if status === 'uncertain'}
									— listed somewhere, never verified on the ground, or known to be restricted.
								{:else}
									— recent reports say people could not get in. This overrides older evidence.
								{/if}
							</span>
						</span>
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-[14px] leading-relaxed text-ink-muted">
				Green is never awarded just because a restroom appears in a dataset. It has to be earned by
				recent evidence.
			</p>
		</section>

		<!-- Sources -->
		<section class="mt-9">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">
				Where each restroom comes from
			</h2>
			<div class="mt-3 space-y-2.5">
				<div class="rounded-card border border-line bg-surface p-4">
					<div class="flex items-baseline justify-between gap-3">
						<h3 class="text-[15px] font-bold text-ink">Georgia State University restroom audit</h3>
						<span class="tabular shrink-0 text-[15px] font-bold text-ink"
							>{data.summary.bySource.gsu ?? 0}</span
						>
					</div>
					<p class="mt-1 text-[14px] leading-relaxed text-ink-muted">
						Locations where researchers found and used an accessible restroom between February and
						April 2025. Each record keeps its original audit fields — access restrictions, ADA
						stalls, soap, toilet paper, changing tables, posted hours and the auditors' own notes.
					</p>
				</div>
				<div class="rounded-card border border-line bg-surface p-4">
					<div class="flex items-baseline justify-between gap-3">
						<h3 class="text-[15px] font-bold text-ink">OpenStreetMap</h3>
						<span class="tabular shrink-0 text-[15px] font-bold text-ink"
							>{data.summary.bySource.osm ?? 0}</span
						>
					</div>
					<p class="mt-1 text-[14px] leading-relaxed text-ink-muted">
						Locations tagged <code
							class="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[12.5px]"
							>amenity=toilets</code
						>
						across metro Atlanta. These extend coverage beyond the 15 studied areas, but nobody has physically
						verified them — so they stay grey until a community report arrives. Where an OpenStreetMap
						entry overlaps an audited location, the physical audit wins and the map listing is kept as
						a cross-reference.
					</p>
				</div>
			</div>
			<p class="mt-3 text-[14px] leading-relaxed text-ink-muted">
				Community-derived information is never presented as official city data. Planned additions:
				MARTA, City of Atlanta parks and recreation, Atlanta public libraries, dedicated public
				facilities, Throne, and community-submitted locations.
			</p>
		</section>

		<!-- Honesty about seeded reports -->
		<section class="mt-9 rounded-card border border-warn-line bg-warn-soft p-4">
			<h2 class="inline-flex items-center gap-1.5 text-[13px] font-bold text-warn">
				<Database class="size-4" aria-hidden="true" />
				About the community reports you see today
			</h2>
			<p class="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
				Every restroom <em>location</em> in Relief ATL is real, imported from the public datasets above.
				The community report history is currently demonstration data generated on top of those real locations,
				and each seeded event is tagged as such in the database. Reports you submit are stored as genuine,
				untagged events alongside them.
			</p>
		</section>

		<!-- Links -->
		<section class="mt-9">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">
				Read the source
			</h2>
			<div class="mt-3 grid gap-2.5 sm:grid-cols-2">
				<a
					class="group rounded-card border border-line bg-surface p-4 transition-shadow hover:shadow-lift"
					href={PAPER_URL}
					target="_blank"
					rel="noopener noreferrer"
				>
					<FileText class="size-5 text-brand" aria-hidden="true" />
					<h3 class="mt-2 text-[14.5px] font-bold text-ink">
						Public bathrooms as public goods: Assessing availability and accessibility in Atlanta,
						Georgia
					</h3>
					<p class="mt-1 text-[13px] text-ink-muted">PLOS Water · 24 June 2026</p>
					<span class="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand">
						Read the paper
						<ExternalLink class="size-3" aria-hidden="true" />
					</span>
				</a>
				<a
					class="group rounded-card border border-line bg-surface p-4 transition-shadow hover:shadow-lift"
					href={OSF_URL}
					target="_blank"
					rel="noopener noreferrer"
				>
					<MapPin class="size-5 text-brand" aria-hidden="true" />
					<h3 class="mt-2 text-[14.5px] font-bold text-ink">Full public dataset on OSF</h3>
					<p class="mt-1 text-[13px] text-ink-muted">
						207 individual restroom audits across the 117 accessible locations.
					</p>
					<span class="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand">
						osf.io/fm9by
						<ExternalLink class="size-3" aria-hidden="true" />
					</span>
				</a>
			</div>
		</section>

		<!-- System -->
		<section class="mt-9 border-t border-line pt-5">
			<h2 class="text-[11px] font-bold tracking-[0.08em] text-ink-subtle uppercase">System</h2>
			<dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-3">
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Restroom locations</dt>
					<dd class="tabular font-semibold text-ink">{data.summary.restrooms}</dd>
				</div>
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Report events</dt>
					<dd class="tabular font-semibold text-ink">{data.summary.reports}</dd>
				</div>
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Reports (24h)</dt>
					<dd class="tabular font-semibold text-ink">{data.summary.reports24h}</dd>
				</div>
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Accessible (24h)</dt>
					<dd class="tabular font-semibold text-ok">{data.summary.positive24h}</dd>
				</div>
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Problems (24h)</dt>
					<dd class="tabular font-semibold text-bad">{data.summary.negative24h}</dd>
				</div>
				<div class="flex justify-between gap-2 border-b border-line/70 py-1">
					<dt class="text-ink-muted">Event store</dt>
					<dd class="font-semibold text-ink">
						{data.summary.mode === 'tigerdata' ? 'Tiger Data' : 'Local demo store'}
					</dd>
				</div>
			</dl>
			<p class="mt-3 text-[13px] leading-relaxed text-ink-subtle">
				No accounts, no sign-in, no tracking. Reports are anonymous — the app stores the restroom,
				the status and the timestamp, and nothing about you.
			</p>
		</section>

		<a
			class="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-hover"
			href={resolve('/')}
		>
			<ArrowLeft class="size-4" aria-hidden="true" />
			Back to the map
		</a>
	</main>
</div>
