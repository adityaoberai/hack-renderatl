<script lang="ts">
	import { onMount } from 'svelte';
	import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
	// MapLibre derives its worker URL at runtime (`new URL(\`./${name}\`, import.meta.url)`),
	// which no bundler can follow: so the worker chunk is never emitted and the map
	// silently never finishes loading. Bundle it explicitly and tell MapLibre where it is.
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { STATUS_STYLE } from '$lib/status';
	import { ATLANTA_CENTER } from '$lib/geo';
	import type { AvailabilityStatus, NearbyRestroom } from '$lib/types';

	interface Props {
		results: NearbyRestroom[];
		selectedId: string | null;
		origin: { latitude: number; longitude: number; isDeviceLocation: boolean } | null;
		flyTo: { latitude: number; longitude: number; zoom?: number; nonce: number } | null;
		onselect: (id: string) => void;
	}

	let { results, selectedId, origin, flyTo, onselect }: Props = $props();

	/** Clean, low-ink basemap with no API key. */
	const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/positron';

	/** If the vector tiles are unreachable, fall back to raster so the demo survives. */
	const RASTER_FALLBACK = {
		version: 8 as const,
		sources: {
			carto: {
				type: 'raster' as const,
				tiles: [
					'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
					'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
					'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
				],
				tileSize: 256,
				attribution: '© OpenStreetMap contributors © CARTO'
			}
		},
		layers: [
			{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#f4f3ef' } },
			{ id: 'carto', type: 'raster' as const, source: 'carto' }
		]
	};

	let container: HTMLDivElement;
	let map: MapLibreMap | null = null;
	let maplibre: typeof import('maplibre-gl') | null = null;
	let ready = $state(false);
	let usedFallback = $state(false);
	/** Set when the basemap cannot render at all (no WebGL, tiles unreachable). */
	let failed = $state(false);

	const markers = new Map<string, { marker: Marker; element: HTMLButtonElement }>();
	let originMarker: Marker | null = null;

	const GLYPH: Record<AvailabilityStatus, string> = {
		// A shape as well as a colour: status must survive colour-blindness and glare.
		confirmed:
			'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
		unavailable:
			'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
		likely: '<svg viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="5"/></svg>',
		uncertain:
			'<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'
	};

	function buildMarkerElement(entry: NearbyRestroom): HTMLButtonElement {
		const element = document.createElement('button');
		element.type = 'button';
		element.className = 'relief-pin';
		element.setAttribute(
			'aria-label',
			`${entry.restroom.name}: ${entry.confidenceScore}% access confidence`
		);
		element.addEventListener('click', (event) => {
			event.stopPropagation();
			onselect(entry.restroom.id);
		});
		return element;
	}

	function paintMarker(element: HTMLButtonElement, entry: NearbyRestroom, isSelected: boolean) {
		const style = STATUS_STYLE[entry.availabilityStatus];
		element.style.setProperty('--pin', style.pin);
		element.dataset.selected = String(isSelected);
		element.dataset.status = entry.availabilityStatus;
		element.innerHTML = `<span class="relief-pin__glyph">${GLYPH[entry.availabilityStatus]}</span>`;
		// Confirmed results sit above the noise so the best option is visible first.
		const parent = element.parentElement;
		if (parent) {
			parent.style.zIndex = String(
				isSelected
					? 40
					: entry.availabilityStatus === 'confirmed'
						? 30
						: entry.availabilityStatus === 'unavailable'
							? 10
							: 20
			);
		}
	}

	function syncMarkers() {
		if (!map || !maplibre) return;
		const seen = new Set<string>();

		for (const entry of results) {
			const id = entry.restroom.id;
			seen.add(id);
			let record = markers.get(id);

			if (!record) {
				const element = buildMarkerElement(entry);
				const marker = new maplibre.Marker({ element, anchor: 'center' })
					.setLngLat([entry.restroom.longitude, entry.restroom.latitude])
					.addTo(map);
				record = { marker, element };
				markers.set(id, record);
			} else {
				record.marker.setLngLat([entry.restroom.longitude, entry.restroom.latitude]);
			}

			paintMarker(record.element, entry, id === selectedId);
		}

		for (const [id, record] of markers) {
			if (seen.has(id)) continue;
			record.marker.remove();
			markers.delete(id);
		}
	}

	function syncOrigin() {
		if (!map || !maplibre) return;
		if (!origin?.isDeviceLocation) {
			originMarker?.remove();
			originMarker = null;
			return;
		}
		if (!originMarker) {
			const element = document.createElement('div');
			element.className = 'relief-you';
			element.innerHTML =
				'<span class="relief-you__pulse"></span><span class="relief-you__dot"></span>';
			originMarker = new maplibre.Marker({ element, anchor: 'center' })
				.setLngLat([origin.longitude, origin.latitude])
				.addTo(map);
		} else {
			originMarker.setLngLat([origin.longitude, origin.latitude]);
		}
	}

	let loadWatchdog: ReturnType<typeof setTimeout>;

	onMount(() => {
		let disposed = false;

		(async () => {
			maplibre = await import('maplibre-gl');
			await import('maplibre-gl/dist/maplibre-gl.css');
			if (disposed) return;

			maplibre.setWorkerUrl(maplibreWorkerUrl);

			map = new maplibre.Map({
				container,
				style: VECTOR_STYLE,
				center: [
					origin?.longitude ?? ATLANTA_CENTER.longitude,
					origin?.latitude ?? ATLANTA_CENTER.latitude
				],
				zoom: 14,
				minZoom: 9,
				maxZoom: 19,
				attributionControl: { compact: true },
				// A restroom finder is a glance-and-go tool; tilting adds nothing.
				pitchWithRotate: false,
				dragRotate: false,
				touchZoomRotate: true
			});
			map.touchZoomRotate.disableRotation();

			map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');

			// One bad CDN must not take the map down.
			map.once('error', (event) => {
				const message = String(event.error?.message ?? '');
				if (!usedFallback && /style|tiles?|fetch|load|network/i.test(message)) {
					usedFallback = true;
					map?.setStyle(RASTER_FALLBACK);
				}
			});

			map.on('load', () => {
				clearTimeout(loadWatchdog);
				ready = true;
				failed = false;
				syncMarkers();
				syncOrigin();
			});

			// If the basemap never comes up: no WebGL, blocked CDN, dead conference
			// wifi: stop covering the screen with a spinner. The ranked list is the
			// product; the map is the nice-to-have.
			loadWatchdog = setTimeout(() => {
				if (!ready) failed = true;
			}, 8000);

			// Re-attach markers after a style swap.
			map.on('styledata', () => {
				if (ready) {
					syncMarkers();
					syncOrigin();
				}
			});
		})();

		return () => {
			disposed = true;
			clearTimeout(loadWatchdog);
			for (const { marker } of markers.values()) marker.remove();
			markers.clear();
			originMarker?.remove();
			map?.remove();
			map = null;
		};
	});

	$effect(() => {
		// Track the reactive inputs so the effect reruns when they change.
		void results;
		void selectedId;
		if (ready) syncMarkers();
	});

	$effect(() => {
		void origin;
		if (ready) syncOrigin();
	});

	$effect(() => {
		const target = flyTo;
		if (!target || !map) return;
		map.flyTo({
			center: [target.longitude, target.latitude],
			zoom: target.zoom ?? map.getZoom(),
			duration: 900,
			essential: true
		});
	});
</script>

<div class="relative size-full">
	<div
		bind:this={container}
		class="size-full bg-surface-sunken"
		role="application"
		aria-label="Map of Atlanta restrooms"
	></div>

	{#if !ready && !failed}
		<div class="pointer-events-none absolute inset-0 grid place-items-center bg-surface-sunken">
			<p class="text-sm font-medium text-ink-subtle">Loading map…</p>
		</div>
	{:else if failed}
		<div class="pointer-events-none absolute inset-0 grid place-items-center p-6">
			<div
				class="pointer-events-auto max-w-xs rounded-card border border-line bg-surface p-4 text-center shadow-lift"
			>
				<p class="text-sm font-semibold text-ink">The map couldn't load.</p>
				<p class="mt-1 text-[13px] text-ink-muted">
					Your ranked results are still listed: they don't depend on the map.
				</p>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.relief-pin) {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 3px solid #fff;
		border-radius: 9999px;
		background: var(--pin, #77808d);
		box-shadow:
			0 1px 2px rgb(21 25 31 / 0.28),
			0 4px 10px -4px rgb(21 25 31 / 0.4);
		cursor: pointer;
		transition:
			width 140ms ease,
			height 140ms ease,
			box-shadow 140ms ease;
	}

	:global(.relief-pin[data-selected='true']) {
		width: 38px;
		height: 38px;
		border-width: 4px;
		box-shadow:
			0 0 0 4px rgb(13 91 86 / 0.28),
			0 6px 16px -4px rgb(21 25 31 / 0.5);
	}

	:global(.relief-pin__glyph) {
		display: block;
		width: 14px;
		height: 14px;
	}
	:global(.relief-pin[data-selected='true'] .relief-pin__glyph) {
		width: 19px;
		height: 19px;
	}
	:global(.relief-pin__glyph svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	:global(.relief-you) {
		position: relative;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
	}
	:global(.relief-you__dot) {
		position: absolute;
		width: 15px;
		height: 15px;
		border-radius: 9999px;
		background: #1d6ef0;
		border: 3px solid #fff;
		box-shadow: 0 1px 4px rgb(21 25 31 / 0.4);
	}
	:global(.relief-you__pulse) {
		position: absolute;
		width: 22px;
		height: 22px;
		border-radius: 9999px;
		background: rgb(29 110 240 / 0.28);
		animation: relief-pulse 2.4s ease-out infinite;
	}

	@keyframes relief-pulse {
		0% {
			transform: scale(0.7);
			opacity: 0.9;
		}
		70% {
			transform: scale(2.1);
			opacity: 0;
		}
		100% {
			opacity: 0;
		}
	}
</style>
