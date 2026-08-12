<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>About the data · Relief ATL</title>
	<meta
		name="description"
		content="How Relief ATL combines Georgia State University public restroom research with timestamped community reports."
	/>
</svelte:head>

<div class="about-page">
	<header>
		<a class="brand-lockup" href={resolve('/')} aria-label="Back to Relief ATL">
			<span class="brand-mark" aria-hidden="true">R</span>
			<span><strong>Relief ATL</strong><small>Atlanta restroom access</small></span>
		</a>
		<a class="back-link" href={resolve('/')}>← Back to the map</a>
	</header>

	<main>
		<section class="about-hero">
			<p class="eyebrow">About the data</p>
			<h1>A public dataset should help the public.</h1>
			<p>
				Relief ATL starts with an in-person Georgia State University audit of potential public
				restrooms across Atlanta—then adds recent, anonymous confirmations so old information does
				not masquerade as current reality.
			</p>
		</section>

		<section class="study-card">
			<div class="study-copy">
				<p class="eyebrow">The foundation</p>
				<h2>Physically audited, not just listed on a map.</h2>
				<p>
					Researchers visited each location between February and April 2025. Of 262 potential
					locations, only 117 had an accessible restroom when visited. That gap is the reason Relief
					ATL exists.
				</p>
				<div class="source-links">
					<a
						href="https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574"
						target="_blank"
						rel="external noreferrer"
					>
						Read the PLOS Water paper ↗
					</a>
					<a href="https://osf.io/fm9by" target="_blank" rel="external noreferrer">
						Explore the OSF dataset ↗
					</a>
				</div>
			</div>
			<div class="about-stats" aria-label="Study statistics">
				<div><strong>262</strong><span>potential locations audited</span></div>
				<div><strong>15</strong><span>areas across Atlanta</span></div>
				<div><strong>117</strong><span>accessible when visited</span></div>
				<div><strong>2025</strong><span>February–April audit</span></div>
			</div>
		</section>

		<section class="evidence-section">
			<p class="eyebrow">Three different claims</p>
			<h2>Existence is not availability.</h2>
			<div class="evidence-grid">
				<article>
					<span class="evidence-icon gray" aria-hidden="true">1</span>
					<h3>Exists in a dataset</h3>
					<p>A public source says a restroom may be at this location.</p>
				</article>
				<article>
					<span class="evidence-icon amber" aria-hidden="true">2</span>
					<h3>Physically verified</h3>
					<p>A researcher confirmed access during the original audit.</p>
				</article>
				<article>
					<span class="evidence-icon green" aria-hidden="true">3</span>
					<h3>Available right now</h3>
					<p>A recent visitor successfully used it and added fresh evidence.</p>
				</article>
			</div>
		</section>

		<section class="tiger-section">
			<div>
				<p class="eyebrow">Why Tiger Data</p>
				<h2>Static public data becomes a living availability record.</h2>
				<p>
					Every anonymous report is appended as a timestamped event. Previous outcomes are never
					overwritten, so recent reality can outweigh a stale source while the history remains
					available for future reliability analysis.
				</p>
			</div>
			<ol class="sample-timeline" aria-label="Example restroom availability timeline">
				<li><time>9:12 AM</time><i class="success">✓</i><span>Accessible</span></li>
				<li><time>10:44 AM</time><i class="success">✓</i><span>Accessible</span></li>
				<li><time>1:03 PM</time><i class="failure">×</i><span>Locked</span></li>
				<li><time>1:29 PM</time><i class="failure">×</i><span>Locked</span></li>
				<li><time>3:18 PM</time><i class="success">✓</i><span>Accessible</span></li>
			</ol>
		</section>

		<section class="method-note">
			<h2>Transparent by design</h2>
			<p>
				Every result names its source and the age of its evidence. Relief ATL does not infer missing
				facility attributes, does not call community data official city data, and does not show a
				green marker simply because a restroom appears in a dataset.
			</p>
			<a href={resolve('/')}>Find a restroom on the map →</a>
		</section>
	</main>

	<footer>
		<strong>Relief ATL</strong>
		<span>Public restroom data for a more accessible Atlanta.</span>
	</footer>
</div>

<style>
	.about-page {
		height: 100dvh;
		overflow-y: auto;
		background: #fafaf9;
		color: #1c1917;
	}

	header {
		position: sticky;
		z-index: 10;
		top: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px clamp(18px, 5vw, 72px);
		border-bottom: 1px solid #e7e5e4;
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(14px);
	}

	.back-link {
		color: #57534e;
		font-size: 12px;
		font-weight: 800;
		text-decoration: none;
	}

	main {
		width: min(1120px, calc(100% - 36px));
		margin: 0 auto;
	}

	.about-hero {
		max-width: 830px;
		padding: clamp(72px, 10vw, 125px) 0 clamp(55px, 8vw, 95px);
	}

	.about-hero h1 {
		margin: 0;
		font-size: clamp(47px, 8vw, 88px);
		line-height: 0.94;
		letter-spacing: -0.06em;
	}

	.about-hero > p:last-child {
		max-width: 690px;
		margin: 28px 0 0;
		color: #57534e;
		font-size: clamp(16px, 2vw, 20px);
		line-height: 1.7;
	}

	.study-card {
		display: grid;
		grid-template-columns: 1.2fr 1fr;
		gap: clamp(32px, 7vw, 90px);
		padding: clamp(34px, 6vw, 74px);
		border-radius: 28px;
		background: #1c1917;
		color: white;
	}

	.study-copy h2,
	.evidence-section h2,
	.tiger-section h2,
	.method-note h2 {
		margin: 0;
		font-size: clamp(30px, 4vw, 48px);
		line-height: 1.04;
		letter-spacing: -0.045em;
	}

	.study-copy > p:not(.eyebrow),
	.tiger-section > div > p:last-child {
		margin: 20px 0 0;
		color: #d6d3d1;
		font-size: 14px;
		line-height: 1.7;
	}

	.source-links {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 26px;
	}

	.source-links a {
		padding: 10px 13px;
		border: 1px solid #57534e;
		border-radius: 10px;
		color: white;
		font-size: 11px;
		font-weight: 800;
		text-decoration: none;
	}

	.source-links a:hover {
		border-color: #6ee7b7;
		color: #6ee7b7;
	}

	.about-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.about-stats div {
		display: flex;
		min-height: 130px;
		flex-direction: column;
		justify-content: flex-end;
		padding: 18px;
		border: 1px solid #44403c;
		border-radius: 17px;
		background: #292524;
	}

	.about-stats strong {
		color: #6ee7b7;
		font-size: clamp(30px, 4vw, 45px);
		line-height: 1;
	}

	.about-stats span {
		margin-top: 8px;
		color: #d6d3d1;
		font-size: 9px;
		font-weight: 750;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.evidence-section,
	.tiger-section {
		padding: clamp(75px, 11vw, 130px) 0;
	}

	.evidence-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px;
		margin-top: 38px;
	}

	.evidence-grid article {
		padding: 26px;
		border: 1px solid #e7e5e4;
		border-radius: 19px;
		background: white;
	}

	.evidence-icon {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border-radius: 50%;
		font-size: 15px;
		font-weight: 900;
	}

	.evidence-icon.gray {
		background: #e7e5e4;
		color: #57534e;
	}

	.evidence-icon.amber {
		background: #fef3c7;
		color: #b45309;
	}

	.evidence-icon.green {
		background: #d1fae5;
		color: #047857;
	}

	.evidence-grid h3 {
		margin: 24px 0 9px;
		font-size: 18px;
		letter-spacing: -0.025em;
	}

	.evidence-grid p {
		margin: 0;
		color: #78716c;
		font-size: 12px;
		line-height: 1.6;
	}

	.tiger-section {
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: clamp(40px, 8vw, 110px);
		align-items: center;
		border-top: 1px solid #e7e5e4;
	}

	.tiger-section > div > p:last-child {
		color: #57534e;
	}

	.sample-timeline {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 20px;
		border: 1px solid #e7e5e4;
		border-radius: 20px;
		background: white;
		box-shadow: 0 15px 50px rgba(28, 25, 23, 0.08);
		list-style: none;
	}

	.sample-timeline li {
		position: relative;
		display: grid;
		grid-template-columns: 72px 30px 1fr;
		align-items: center;
		min-height: 52px;
	}

	.sample-timeline li:not(:last-child)::after {
		position: absolute;
		top: 40px;
		bottom: -12px;
		left: 86px;
		width: 2px;
		background: #e7e5e4;
		content: '';
	}

	.sample-timeline time {
		color: #78716c;
		font-size: 10px;
		font-weight: 700;
	}

	.sample-timeline i {
		z-index: 1;
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 50%;
		font-size: 11px;
		font-style: normal;
		font-weight: 900;
	}

	.sample-timeline i.success {
		background: #d1fae5;
		color: #047857;
	}

	.sample-timeline i.failure {
		background: #fee2e2;
		color: #b91c1c;
	}

	.sample-timeline span {
		padding-left: 12px;
		font-size: 12px;
		font-weight: 800;
	}

	.method-note {
		padding: clamp(40px, 7vw, 72px);
		border-radius: 27px;
		background: #ecfdf5;
		text-align: center;
	}

	.method-note p {
		max-width: 690px;
		margin: 21px auto;
		color: #57534e;
		font-size: 14px;
		line-height: 1.75;
	}

	.method-note a {
		color: #047857;
		font-size: 13px;
		font-weight: 850;
		text-decoration: none;
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: min(1120px, calc(100% - 36px));
		margin: 90px auto 0;
		padding: 28px 0 38px;
		border-top: 1px solid #e7e5e4;
		color: #78716c;
		font-size: 10px;
	}

	footer strong {
		color: #1c1917;
		font-size: 14px;
	}

	@media (max-width: 720px) {
		header {
			padding: 12px 14px;
		}

		.back-link {
			font-size: 10px;
		}

		.about-hero {
			padding-top: 70px;
		}

		.study-card,
		.tiger-section {
			grid-template-columns: 1fr;
		}

		.study-card {
			padding: 27px 20px;
		}

		.evidence-grid {
			grid-template-columns: 1fr;
		}

		.about-stats div {
			min-height: 105px;
			padding: 14px;
		}

		.method-note {
			padding: 38px 20px;
		}

		footer {
			align-items: flex-start;
			flex-direction: column;
			gap: 6px;
			margin-top: 60px;
		}
	}
</style>
