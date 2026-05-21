<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { GeodesicLine } from 'leaflet.geodesic'
import { feature } from 'topojson-client'
import worldTopology from 'world-atlas/countries-110m.json'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcChip from '@nextcloud/vue/components/NcChip'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import MapMarkerOff from 'vue-material-design-icons/MapMarkerOff.vue'
import FormatListBulleted from 'vue-material-design-icons/FormatListBulleted.vue'
import { showError } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { getAirportsByCodes } from '../api.ts'
import {
	buildLegs,
	collectAirportCodes,
	countFlightsByAirport,
	countFlightsByRoute,
	flownRouteDirections,
	indexByCode,
	prepareBasemap,
	routeKey,
} from '../mapUtils.ts'
import { applyFilters, buildFilters, type ActiveFilter, type AirportDirection } from '../filters.ts'
import type { Airport } from '../types.ts'

const route = useRoute()
const router = useRouter()
const store = useFlightsStore()

const loading = ref(true)
const airports = ref<Airport[]>([])
const mapEl = ref<HTMLElement | null>(null)

// Leaflet objects are deliberately kept out of Vue reactivity.
let map: L.Map | null = null
let overlay: L.LayerGroup | null = null

const activeFilters = computed<ActiveFilter[]>(() => buildFilters(route.query, store.flights))

const filteredFlights = computed(() => applyFilters(store.flights, activeFilters.value))

const focusCode = computed(() => {
	const a = route.query.airport
	return typeof a === 'string' && a ? a.toUpperCase() : null
})

const isEmpty = computed(() => !loading.value && airports.value.length === 0)

function clearFilter(filter: ActiveFilter) {
	const query: LocationQuery = { ...route.query }
	for (const key of filter.queryKeys) delete query[key]
	router.push({ name: 'map', query })
}

// Carry the current filter query across to the Flights view.
function viewInLog() {
	router.push({ name: 'flights', query: { ...route.query } })
}

function themeColor(name: string, fallback: string): string {
	const value = getComputedStyle(document.body).getPropertyValue(name).trim()
	return value || fallback
}

function codeOf(a: Airport): string {
	return (a.iata || a.icao || '').toUpperCase()
}

// A marker popup offering From / To / Both — applies the airport filter on the
// Map view itself. Built as plain DOM — Leaflet popups live outside Vue's
// render tree.
function airportPopup(a: Airport): HTMLElement {
	const code = codeOf(a)
	const el = document.createElement('div')
	el.className = 'fj-map-popup'

	const title = document.createElement('div')
	title.className = 'fj-map-popup__title'
	title.textContent = a.name ? `${code} - ${a.name}` : code
	el.appendChild(title)

	const actions: [string, AirportDirection][] = [
		['Flights from', 'from'],
		['Flights to', 'to'],
		['Flights to and from', 'either'],
	]
	for (const [label, dir] of actions) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'fj-map-popup__action'
		btn.textContent = `${label} ${code}`
		btn.addEventListener('click', () => {
			router.push({ name: 'map', query: { airport: code, airportDir: dir } })
		})
		el.appendChild(btn)
	}
	return el
}

// An arc popup offering the route filters that actually have flights:
// both directional options plus the bidirectional one when the route was flown
// both ways, or just the single directional option when it was only flown one
// way. Directional options are ordered oldest-flown-first.
function routePopup(from: Airport, to: Airport): HTMLElement {
	const a = codeOf(from)
	const b = codeOf(to)
	const [pairA, pairB] = [a, b].sort()

	const el = document.createElement('div')
	el.className = 'fj-map-popup'

	const title = document.createElement('div')
	title.className = 'fj-map-popup__title'
	title.textContent = `${pairA} ↔ ${pairB}`
	el.appendChild(title)

	const directions = flownRouteDirections(a, b, store.flights)
	const actions: [string, LocationQuery][] = directions.map(
		([dirFrom, dirTo]): [string, LocationQuery] => [
			`View flights ${dirFrom} → ${dirTo}`,
			{ routeA: dirFrom, routeB: dirTo, routeDir: 'ab' },
		],
	)
	if (directions.length === 2) {
		actions.push([
			`View flights ${pairA} ↔ ${pairB}`,
			{ routeA: pairA, routeB: pairB, routeDir: 'both' },
		])
	}
	for (const [label, query] of actions) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'fj-map-popup__action'
		btn.textContent = label
		btn.addEventListener('click', () => {
			router.push({ name: 'map', query })
		})
		el.appendChild(btn)
	}
	return el
}

// Draw (or redraw) the flight overlay for the currently active filter. The
// basemap is added once by initMap; only this layer group changes.
function drawOverlay() {
	if (!map || !overlay) return
	overlay.clearLayers()

	const flights = filteredFlights.value
	const byCode = indexByCode(airports.value)
	const arcColor = themeColor('--color-primary-element', '#1a73e8')

	// Counts span the whole journal, both directions together.
	const routeCounts = countFlightsByRoute(store.flights)
	for (const leg of buildLegs(flights, byCode)) {
		const a = codeOf(leg.from)
		const b = codeOf(leg.to)
		const count = routeCounts.get(routeKey(a, b)) ?? 0
		const line = new GeodesicLine(
			[
				[leg.from.lat as number, leg.from.lon as number],
				[leg.to.lat as number, leg.to.lon as number],
			],
			{ color: arcColor, weight: 1.5, opacity: 0.6, steps: 6 },
		)
		line.bindTooltip(
			`${routeKey(a, b).replace('|', ' ↔ ')} ${count} flight${count === 1 ? '' : 's'}`,
			{ sticky: true },
		)
		line.bindPopup(routePopup(leg.from, leg.to))
		line.addTo(overlay)
	}

	const shown = new Set(collectAirportCodes(flights, focusCode.value))
	// Counts span the whole journal, not just the filtered subset.
	const flightCounts = countFlightsByAirport(store.flights)
	const points: L.LatLng[] = []
	let focusLatLng: L.LatLng | null = null
	for (const a of airports.value) {
		const code = codeOf(a)
		if (!shown.has(code) || a.lat === null || a.lon === null) continue
		const isFocus = focusCode.value !== null && code === focusCode.value
		const marker = L.circleMarker([a.lat, a.lon], {
			radius: isFocus ? 7 : 4,
			color: isFocus ? arcColor : themeColor('--color-main-text', '#222222'),
			weight: 2,
			fillColor: isFocus ? arcColor : themeColor('--color-main-background', '#ffffff'),
			fillOpacity: 1,
		})
		const count = flightCounts.get(code) ?? 0
		const base = a.name ? `${code} - ${a.name}` : code
		marker.bindTooltip(`${base} (${count} flight${count === 1 ? '' : 's'})`)
		marker.bindPopup(airportPopup(a))
		marker.addTo(overlay)
		const latLng = L.latLng(a.lat, a.lon)
		points.push(latLng)
		if (isFocus) focusLatLng = latLng
	}

	if (activeFilters.value.length === 0 && focusLatLng) {
		map.setView(focusLatLng, 6)
	} else if (points.length > 0) {
		map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 7 })
	}
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

	// Bundled GeoJSON basemap — no external tile server. prepareBasemap makes
	// the raw world data safe for Leaflet's flat projection.
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

	overlay = L.layerGroup().addTo(map)
	drawOverlay()
	map.invalidateSize()
}

onMounted(async () => {
	try {
		if (!store.loaded) await store.fetchAll()
		// Fetch every flown airport once; filtering is then client-side.
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

// React to filter changes (e.g. clearing the chip) without a full remount.
watch(() => route.query, () => {
	if (map) drawOverlay()
})

onBeforeUnmount(() => {
	map?.remove()
	map = null
	overlay = null
})
</script>

<template>
	<div class="map-view">
		<div class="header">
			<h2>Map</h2>
			<div v-if="activeFilters.length" class="filter-bar">
				<div class="filter-chips">
					<NcChip
						v-for="filter in activeFilters"
						:key="filter.id"
						:text="filter.label"
						@close="clearFilter(filter)" />
				</div>
				<div class="filter-actions">
					<span class="filter-count">
						Showing {{ filteredFlights.length }} out of {{ store.flights.length }} flights
					</span>
					<NcButton variant="secondary" @click="viewInLog">
						<template #icon>
							<FormatListBulleted :size="20" />
						</template>
						View in log
					</NcButton>
				</div>
			</div>
		</div>
		<div class="map-area">
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
	</div>
</template>

<style scoped>
.map-view {
	display: flex;
	flex-direction: column;
	height: calc(100vh - var(--header-height, 50px));
}

.header {
	padding: 16px 16px 0;
}

.filter-bar {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 10px;
	margin-top: 8px;
	margin-bottom: 12px;
}

.filter-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.filter-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}

.filter-count {
	color: var(--color-text-maxcontrast);
}

.map-area {
	position: relative;
	flex: 1;
	min-height: 0;
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

<!-- Non-scoped: Leaflet popups are appended outside the component's render tree. -->
<style>
.fj-map-popup__title {
	font-weight: bold;
	margin-bottom: 6px;
}

.fj-map-popup__action {
	display: block;
	width: 100%;
	text-align: start;
	padding: 6px 8px;
	border: none;
	border-radius: var(--border-radius, 8px);
	background: transparent;
	color: var(--color-main-text);
	font: inherit;
	cursor: pointer;
}

.fj-map-popup__action:hover {
	background: var(--color-background-hover);
}
</style>
