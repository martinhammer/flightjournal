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
import { useMapSettingsStore, type Projection } from '../store/mapSettings.ts'
import {
	azimuthalEquidistantCRS,
	azimuthalFitZoom,
	pickHomeAirport,
	polarNorthFitZoom,
	polarStereographicNorthCRS,
} from '../mapProjections.ts'
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
const mapSettings = useMapSettingsStore()

const loading = ref(true)
const airports = ref<Airport[]>([])
const mapEl = ref<HTMLElement | null>(null)

// Experimental: switch between projections. The first three are Leaflet built-
// ins (flat, 2D). 'polar-north' and 'azimuthal-home' come from proj4leaflet
// (see src/mapProjections.ts) and can be removed without affecting the others.
// The selected projection lives in the mapSettings store so the Settings entry
// in the app navigation can change it from outside this view.
interface MapConfig {
	crs: L.CRS
	center: L.LatLngExpression
	zoom: number
	minZoom: number
	worldCopyJump: boolean
}
// Resolve the AEQD centre: filter anchor (airport / route origin / flight
// origin) takes precedence over the most-flown airport. Falls back to (0,0) if
// nothing is known yet.
function azimuthalCenter(): [number, number] {
	const code = anchorCode.value
	const anchored = code
		? airports.value.find((a) => codeOf(a) === code && a.lat !== null && a.lon !== null) ?? null
		: null
	const anchor = anchored ?? pickHomeAirport(store.flights, airports.value)
	return anchor && anchor.lat !== null && anchor.lon !== null
		? [anchor.lat, anchor.lon]
		: [0, 0]
}

function configFor(p: Projection): MapConfig {
	switch (p) {
	case 'equirectangular':
		return { crs: L.CRS.EPSG4326, center: [25, 10], zoom: 1, minZoom: 0, worldCopyJump: false }
	case 'mercator':
		return { crs: L.CRS.EPSG3395, center: [25, 10], zoom: 2, minZoom: 1, worldCopyJump: false }
	case 'polar-north':
		return { crs: polarStereographicNorthCRS(), center: [90, 0], zoom: 0, minZoom: 0, worldCopyJump: false }
	case 'azimuthal-home': {
		const center = azimuthalCenter()
		return {
			crs: azimuthalEquidistantCRS(center[0], center[1]),
			center,
			zoom: 3,
			minZoom: 2,
			worldCopyJump: false,
		}
	}
	default:
		return { crs: L.CRS.EPSG3857, center: [25, 10], zoom: 2, minZoom: 1, worldCopyJump: true }
	}
}

// Leaflet objects are deliberately kept out of Vue reactivity.
let map: L.Map | null = null
let overlay: L.LayerGroup | null = null

const activeFilters = computed<ActiveFilter[]>(() => buildFilters(route.query, store.flights))

const filteredFlights = computed(() => applyFilters(store.flights, activeFilters.value))

const focusCode = computed(() => {
	const a = route.query.airport
	return typeof a === 'string' && a ? a.toUpperCase() : null
})

// The airport AEQD should re-centre on when a filter is active. Mirrors
// focusCode for the airport filter, then falls through to route filters
// (origin airport, i.e. routeA) and single-flight filters (the flight's
// origin_code). Used only for projection centring, not for the focus marker
// highlight (which keeps following focusCode alone).
const anchorCode = computed<string | null>(() => {
	if (focusCode.value) return focusCode.value
	const ra = route.query.routeA
	if (typeof ra === 'string' && ra) return ra.toUpperCase()
	const f = route.query.flight
	if (typeof f === 'string' && f) {
		const id = Number(f)
		const flight = store.flights.find((x) => x.id === id)
		if (flight?.originCode) return flight.originCode.toUpperCase()
	}
	return null
})

const isEmpty = computed(() => !loading.value && airports.value.length === 0)

const headerCount = computed(() => {
	const total = store.flights.length
	const shown = filteredFlights.value.length
	const plural = (n: number) => `${n} flight${n === 1 ? '' : 's'}`
	if (activeFilters.value.length === 0 || shown === total) return plural(total)
	return `${shown} of ${plural(total)}`
})

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

// "12 flights" when no filter is active or shown == total; "5 of 12 flights"
// when a filter narrows the visible subset.
function formatCount(shown: number, total: number, filterActive: boolean): string {
	const plural = (n: number) => `${n} flight${n === 1 ? '' : 's'}`
	if (!filterActive || shown === total) return plural(total)
	return `${shown} of ${plural(total)}`
}

// Multi-line tooltip: bold title above, one or more dim lines below. Built as
// DOM (not an HTML string) so airport names with special characters don't need
// escaping.
function tooltipContent(title: string, lines: string[]): HTMLElement {
	const el = document.createElement('div')
	el.className = 'fj-map-tooltip'
	const t = document.createElement('div')
	t.className = 'fj-map-tooltip__title'
	t.textContent = title
	el.appendChild(t)
	for (const line of lines) {
		const c = document.createElement('div')
		c.className = 'fj-map-tooltip__count'
		c.textContent = line
		el.appendChild(c)
	}
	return el
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

	// Totals span the whole journal; filtered counts span only the currently
	// visible subset. Show both when they differ so the tooltip reads e.g.
	// "LHR ↔ DXB 3 of 8 flights" while a filter is active.
	const totalRouteCounts = countFlightsByRoute(store.flights)
	const filteredRouteCounts = countFlightsByRoute(flights)
	const filterActive = activeFilters.value.length > 0
	for (const leg of buildLegs(flights, byCode)) {
		const a = codeOf(leg.from)
		const b = codeOf(leg.to)
		const key = routeKey(a, b)
		const total = totalRouteCounts.get(key) ?? 0
		const shownCount = filteredRouteCounts.get(key) ?? 0
		const line = new GeodesicLine(
			[
				[leg.from.lat as number, leg.from.lon as number],
				[leg.to.lat as number, leg.to.lon as number],
			],
			{ color: arcColor, weight: 1.5, opacity: 0.6, steps: 6 },
		)
		line.bindTooltip(
			tooltipContent(key.replace('|', ' ↔ '), [formatCount(shownCount, total, filterActive)]),
			{ sticky: true },
		)
		line.bindPopup(routePopup(leg.from, leg.to))
		line.addTo(overlay)
	}

	const shown = new Set(collectAirportCodes(flights, focusCode.value))
	const totalAirportCounts = countFlightsByAirport(store.flights)
	const filteredAirportCounts = countFlightsByAirport(flights)
	const points: L.LatLng[] = []
	let focusLatLng: L.LatLng | null = null
	for (const a of airports.value) {
		const code = codeOf(a)
		if (!shown.has(code) || a.lat === null || a.lon === null) continue
		const isFocus = focusCode.value !== null && code === focusCode.value
		const marker = L.circleMarker([a.lat, a.lon], {
			radius: isFocus ? 9 : 6,
			color: isFocus ? arcColor : themeColor('--color-main-text', '#222222'),
			weight: 2,
			fillColor: isFocus ? arcColor : themeColor('--color-main-background', '#ffffff'),
			fillOpacity: 1,
		})
		const total = totalAirportCounts.get(code) ?? 0
		const shownCount = filteredAirportCounts.get(code) ?? 0
		const base = a.name ? `${code} - ${a.name}` : code
		const plural = (n: number) => `${n} flight${n === 1 ? '' : 's'}`
		// With a filter active: filter label + matching count on line 2, total
		// on line 3. Without a filter: just the total on line 2.
		const lines = filterActive
			? [
				`${activeFilters.value.map((f) => f.label).join(', ')}: ${shownCount}`,
				`Total: ${plural(total)}`,
			]
			: [plural(total)]
		marker.bindTooltip(tooltipContent(base, lines))
		marker.bindPopup(airportPopup(a))
		// Double-click is a shortcut for the popup's "Flights to and from" action:
		// focus the airport and apply the bidirectional filter in one gesture.
		marker.on('dblclick', (e) => {
			L.DomEvent.stopPropagation(e)
			router.push({ name: 'map', query: { airport: code, airportDir: 'either' } })
		})
		marker.addTo(overlay)
		const latLng = L.latLng(a.lat, a.lon)
		points.push(latLng)
		if (isFocus) focusLatLng = latLng
	}

	if (activeFilters.value.length === 0 && focusLatLng) {
		map.setView(focusLatLng, 6)
	} else if (mapSettings.projection === 'polar-north' && points.length > 0) {
		// Polar projection: keep the pole centred, just scale to fit.
		const viewportPx = Math.min(
			mapEl.value?.clientWidth ?? 800,
			mapEl.value?.clientHeight ?? 800,
		)
		map.setView([90, 0], polarNorthFitZoom(points, viewportPx))
	} else if (mapSettings.projection === 'azimuthal-home' && points.length > 0) {
		// AEQD: keep the projection centre at the viewport centre, scale to fit.
		const viewportPx = Math.min(
			mapEl.value?.clientWidth ?? 800,
			mapEl.value?.clientHeight ?? 800,
		)
		const center = azimuthalCenter()
		map.setView(center, azimuthalFitZoom(points, center, viewportPx))
	} else if (points.length > 0) {
		map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 7 })
	}
}

function initMap() {
	if (!mapEl.value || map) return

	let cfg: MapConfig
	try {
		cfg = configFor(mapSettings.projection)
	} catch (e) {
		// proj4leaflet failure — fall back to Web Mercator and surface why.
		console.warn('[flightjournal] Projection failed, falling back to Web Mercator:', e)
		showError('That projection could not be loaded; falling back to Web Mercator.')
		mapSettings.projection = 'web-mercator'
		cfg = configFor('web-mercator')
	}
	map = L.map(mapEl.value, {
		crs: cfg.crs,
		center: cfg.center,
		zoom: cfg.zoom,
		minZoom: cfg.minZoom,
		maxZoom: 9,
		worldCopyJump: cfg.worldCopyJump,
		attributionControl: false,
		// Canvas renderer with tolerance adds an N-pixel pad to every path's
		// hit area without changing how it looks — much easier to hover the
		// thin geodesic arcs (and gives markers a little extra grace too).
		renderer: L.canvas({ tolerance: 6 }),
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
// Exception: Azimuthal Equidistant re-centres on the filter anchor (airport,
// route origin, or flight origin), and the centre is baked into the CRS — so
// a change in the anchor needs a full map rebuild.
let lastAnchor: string | null = anchorCode.value
watch(() => route.query, async () => {
	if (!map) return
	if (mapSettings.projection === 'azimuthal-home' && anchorCode.value !== lastAnchor) {
		lastAnchor = anchorCode.value
		map.remove()
		map = null
		overlay = null
		await nextTick()
		initMap()
		return
	}
	lastAnchor = anchorCode.value
	drawOverlay()
})

// Leaflet bakes the CRS in at construction — swap projections by rebuilding.
watch(() => mapSettings.projection, async () => {
	if (!map) return
	map.remove()
	map = null
	overlay = null
	await nextTick()
	initMap()
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
			<div class="filter-bar">
				<NcChip
					v-for="filter in activeFilters"
					:key="filter.id"
					:text="filter.label"
					@close="clearFilter(filter)" />
				<span v-if="!loading" class="filter-count">{{ headerCount }}</span>
			</div>
			<div v-if="activeFilters.length" class="filter-actions">
				<NcButton variant="secondary" @click="viewInLog">
					<template #icon>
						<FormatListBulleted :size="20" />
					</template>
					View in log
				</NcButton>
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
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	margin-top: 8px;
	margin-bottom: 6px;
}

.filter-count {
	color: var(--color-text-maxcontrast);
}

.filter-actions {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 12px;
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

.fj-map-tooltip__title {
	font-weight: bold;
}

.fj-map-tooltip__count {
	color: var(--color-text-maxcontrast);
	margin-top: 2px;
}
</style>
