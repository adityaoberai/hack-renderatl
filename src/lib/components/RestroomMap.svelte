<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';
	import type { Coordinates, NearbyRestroom } from '$lib/types';

	let {
		results,
		center,
		selectedId,
		userLocation,
		onselect
	}: {
		results: NearbyRestroom[];
		center: Coordinates;
		selectedId: string | null;
		userLocation: Coordinates | null;
		onselect: (id: string) => void;
	} = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | null = null;
	let maplibre: typeof import('maplibre-gl') | null = null;
	let markers = new SvelteMap<string, Marker>();
	let userMarker: Marker | null = null;

	const mapStyle: StyleSpecification = {
		version: 8,
		sources: {
			osm: {
				type: 'raster',
				tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
				tileSize: 256,
				attribution:
					'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}
		},
		layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
	};

	function markerClass(result: NearbyRestroom): string {
		return `restroom-marker marker-${result.confidence.status}`;
	}

	function syncMarkers(): void {
		if (!map || !maplibre) return;
		const visibleIds = new Set(results.map((result) => result.restroom.id));

		for (const [id, marker] of markers) {
			if (!visibleIds.has(id)) {
				marker.remove();
				markers.delete(id);
			}
		}

		for (const result of results) {
			const id = result.restroom.id;
			let marker = markers.get(id);
			if (!marker) {
				const element = document.createElement('button');
				element.type = 'button';
				element.className = markerClass(result);
				element.setAttribute(
					'aria-label',
					`${result.restroom.name}, ${result.confidence.score}% confidence`
				);
				element.innerHTML = '<span aria-hidden="true">●</span>';
				element.addEventListener('click', () => onselect(id));
				marker = new maplibre.Marker({ element, anchor: 'bottom' })
					.setLngLat([result.restroom.longitude, result.restroom.latitude])
					.addTo(map);
				markers.set(id, marker);
			}

			const element = marker.getElement();
			element.className = `${markerClass(result)} ${id === selectedId ? 'is-selected' : ''}`;
			element.style.zIndex = id === selectedId ? '4' : '1';
		}

		userMarker?.remove();
		userMarker = null;
		if (userLocation) {
			const element = document.createElement('div');
			element.className = 'user-location-marker';
			element.setAttribute('aria-label', 'Your location');
			userMarker = new maplibre.Marker({ element })
				.setLngLat([userLocation.longitude, userLocation.latitude])
				.addTo(map);
		}
	}

	onMount(() => {
		let disposed = false;

		void import('maplibre-gl').then((module) => {
			if (disposed) return;
			maplibre = module;
			map = new module.Map({
				container,
				style: mapStyle,
				center: [center.longitude, center.latitude],
				zoom: 13.4,
				attributionControl: false
			});
			map.addControl(new module.NavigationControl({ showCompass: false }), 'bottom-right');
			map.addControl(new module.AttributionControl({ compact: true }), 'bottom-left');
			map.on('load', syncMarkers);
			syncMarkers();
		});

		return () => {
			disposed = true;
			for (const marker of markers.values()) marker.remove();
			userMarker?.remove();
			map?.remove();
			map = null;
		};
	});

	$effect(() => {
		void results;
		void selectedId;
		void userLocation;
		syncMarkers();
	});

	$effect(() => {
		const nextCenter = center;
		if (map) {
			map.easeTo({
				center: [nextCenter.longitude, nextCenter.latitude],
				duration: 700,
				zoom: Math.max(map.getZoom(), 13.8)
			});
		}
	});
</script>

<div class="map-container" bind:this={container} aria-label="Map of nearby Atlanta restrooms"></div>

<style>
	.map-container {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(rgba(230, 236, 231, 0.88), rgba(230, 236, 231, 0.88)),
			repeating-linear-gradient(45deg, #dce5de 0, #dce5de 1px, transparent 1px, transparent 12px);
	}

	:global(.restroom-marker) {
		display: grid;
		width: 36px;
		height: 42px;
		place-items: center;
		border: 3px solid white;
		border-radius: 50% 50% 50% 12%;
		box-shadow: 0 3px 12px rgb(28 25 23 / 25%);
		color: white;
		cursor: pointer;
		font-size: 13px;
		transform: rotate(-45deg);
		transition:
			scale 150ms ease,
			box-shadow 150ms ease;
	}

	:global(.restroom-marker > span) {
		transform: rotate(45deg);
	}

	:global(.restroom-marker:hover),
	:global(.restroom-marker.is-selected) {
		scale: 1.22;
		box-shadow: 0 5px 18px rgb(28 25 23 / 35%);
	}

	:global(.marker-confirmed) {
		background: #059669;
	}

	:global(.marker-likely) {
		background: #f59e0b;
	}

	:global(.marker-unavailable) {
		background: #dc2626;
	}

	:global(.marker-uncertain) {
		background: #78716c;
	}

	:global(.user-location-marker) {
		width: 19px;
		height: 19px;
		border: 4px solid white;
		border-radius: 999px;
		background: #2563eb;
		box-shadow:
			0 0 0 3px rgb(37 99 235 / 24%),
			0 2px 8px rgb(0 0 0 / 20%);
	}

	:global(.maplibregl-ctrl-bottom-right) {
		bottom: 12px;
		right: 10px;
	}

	:global(.maplibregl-ctrl-bottom-left) {
		bottom: 2px;
	}
</style>
