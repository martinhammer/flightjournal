<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { GeodesicLine } from 'leaflet.geodesic'
import { feature } from 'topojson-client'
import worldTopology from 'world-atlas/countries-110m.json'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import MapMarkerOff from 'vue-material-design-icons/MapMarkerOff.vue'
import { showError } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { getAirportsByCodes } from '../api.ts'
import { buildLegs, collectAirportCodes, indexByCode, prepareBasemap } from '../mapUtils.ts'
import type { Airport } from '../types.ts'

const route = useRoute()
const store = useFlightsStore()

const loading = ref(true)
const airports = ref<Airport[]>([])
const mapEl = ref<HTMLElement | null>(null)

// Leaflet's map instance is deliberately kept out of Vue reactivity.
let map: L.Map | null = null

const focusCode = computed(() => {
	const a = route.query.airport
	return typeof a === 'string' && a ? a.toUpperCase() : null
})

const isEmpty = computed(() => !loading.value && airports.value.length === 0)

function themeColor(name: string, fallback: string): string {
	const value = getComputedStyle(document.body).getPropertyValue(name).trim()
	return value || fallback
}

function codeOf(a: Airport): string {
	return (a.iata || a.icao || '').toUpperCase()
}

function initMap() {
	if (!mapEl.value || map) return

	map = L.map(mapEl.value, {
		center: [25, 10],
		zoom: 2,
		minZoom: 1,
		maxZoom: 9,
		worldCopyJump: true,
		attributionControl: false,
	})

	// Bundled GeoJSON basemap — no external tile server. The raw world data
	// crosses the antimeridian; prepareBasemap makes it safe for Leaflet.
	const land = feature(worldTopology, worldTopology.objects.countries)
	L.geoJSON(prepareBasemap(land as unknown as GeoJSON.FeatureCollection), {
		style: {
			color: themeColor('--color-border-dark', '#9aa5b1'),
			weight: 1,
			fillColor: themeColor('--color-background-dark', '#e4e7eb'),
			fillOpacity: 1,
		},
		interactive: false,
	}).addTo(map)

	const arcColor = themeColor('--color-primary-element', '#1a73e8')
	const byCode = indexByCode(airports.value)

	// Flight paths as great-circle arcs. GeodesicLine wraps the antimeridian
	// natively, so trans-Pacific routes render across the seam correctly.
	// steps: 6 → 129 vertices per arc — smooth (default 3 looks polygonal).
	for (const leg of buildLegs(store.flights, byCode)) {
		new GeodesicLine(
			[
				[leg.from.lat as number, leg.from.lon as number],
				[leg.to.lat as number, leg.to.lon as number],
			],
			{ color: arcColor, weight: 1.5, opacity: 0.6, interactive: false, steps: 6 },
		).addTo(map)
	}

	// Airport markers.
	const points: L.LatLng[] = []
	let focusLatLng: L.LatLng | null = null
	for (const a of airports.value) {
		if (a.lat === null || a.lon === null) continue
		const isFocus = focusCode.value !== null && codeOf(a) === focusCode.value
		const marker = L.circleMarker([a.lat, a.lon], {
			radius: isFocus ? 7 : 4,
			color: isFocus ? arcColor : themeColor('--color-main-text', '#222222'),
			weight: 2,
			fillColor: isFocus ? arcColor : themeColor('--color-main-background', '#ffffff'),
			fillOpacity: 1,
		})
		marker.bindTooltip(a.name ? `${codeOf(a)} — ${a.name}` : codeOf(a))
		marker.addTo(map)
		const latLng = L.latLng(a.lat, a.lon)
		points.push(latLng)
		if (isFocus) focusLatLng = latLng
	}

	if (focusLatLng) {
		map.setView(focusLatLng, 6)
	} else if (points.length > 0) {
		map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 7 })
	}
	map.invalidateSize()
}

onMounted(async () => {
	try {
		if (!store.loaded) await store.fetchAll()
		const codes = collectAirportCodes(store.flights, focusCode.value)
		airports.value = codes.length > 0 ? await getAirportsByCodes(codes) : []
	} catch {
		showError('Failed to load the map')
	} finally {
		loading.value = false
	}
	if (!isEmpty.value) {
		await nextTick()
		initMap()
	}
})

onBeforeUnmount(() => {
	map?.remove()
	map = null
})
</script>

<template>
	<div class="map-view">
		<div v-if="loading" class="map-overlay">
			<NcLoadingIcon :size="44" />
		</div>
		<NcEmptyContent
			v-else-if="isEmpty"
			name="Nothing to map yet"
			description="Add flights with recognised airports, or open an airport from the Airports view.">
			<template #icon>
				<MapMarkerOff />
			</template>
		</NcEmptyContent>
		<div v-show="!loading && !isEmpty" ref="mapEl" class="map-canvas" />
	</div>
</template>

<style scoped>
.map-view {
	position: relative;
	height: calc(100vh - var(--header-height, 50px));
}

.map-canvas {
	position: absolute;
	inset: 0;
	background: var(--color-main-background);
}

.map-overlay {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
}
</style>
