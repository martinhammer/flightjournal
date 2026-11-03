<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import AirplaneLanding from 'vue-material-design-icons/AirplaneLanding.vue'
import AirplaneTakeoff from 'vue-material-design-icons/AirplaneTakeoff.vue'
import SwapHorizontal from 'vue-material-design-icons/SwapHorizontal.vue'
import MapMarker from 'vue-material-design-icons/MapMarker.vue'
import { showError } from '@nextcloud/dialogs'
import { listAirports } from '../api.ts'
import { useFlightsStore } from '../store/flights.ts'
import { countByAirport } from '../flightCounts.ts'
import type { Airport } from '../types.ts'

const route = useRoute()
const router = useRouter()
const store = useFlightsStore()

const PAGE_SIZE = 100

// Seeded from `?q=` so another view can drill through to one airport — the Map
// view's marker popup does, sending the canonical code. Read once on setup
// rather than watched: typing in the box deliberately does not write back to the
// URL, so nothing can change the query while this view is mounted.
const query = ref(String(route.query.q ?? ''))
// Default: only airports the current user has flown to/from.
const showAll = ref(false)
const offset = ref(0)
const total = ref(0)
const items = ref<Airport[]>([])
const loading = ref(false)
const loaded = ref(false)

let searchToken = 0

async function fetchPage() {
	const token = ++searchToken
	loading.value = true
	try {
		const page = await listAirports(query.value, PAGE_SIZE, offset.value, !showAll.value)
		if (token !== searchToken) return
		items.value = page.items
		total.value = page.total
		loaded.value = true
	} catch {
		if (token === searchToken) showError('Failed to load airports')
	} finally {
		if (token === searchToken) loading.value = false
	}
}

// The store is usually already warm (Flights is the default route); fetch only
// if not. Counted here rather than server-side so the number is keyed by the
// same value the flights filter matches on — see flightCounts.ts. A leg counts
// once per distinct endpoint, matching the row's "to and from" action.
const flightCounts = computed(() => countByAirport(store.flights))
const flightCount = (a: Airport) => flightCounts.value.get((canonicalCode(a) ?? '').toUpperCase()) ?? 0

// Headline summary: how many airports the user has visited out of the whole
// reference table. Both numbers come from the server rather than the store, so
// each is exactly the size of the list the corresponding "Show all" mode shows
// (a flown code with no reference row is in neither). Deliberately independent
// of the search box and the switch — the pager already reports what the current
// query returns.
const visitedTotal = ref<number | null>(null)
const referenceTotal = ref<number | null>(null)

const summary = computed(() => {
	if (visitedTotal.value === null || referenceTotal.value === null) return ''
	return `${visitedTotal.value.toLocaleString()} visited / ${referenceTotal.value.toLocaleString()} total`
})

async function fetchTotals() {
	try {
		const [visited, all] = await Promise.all([
			listAirports('', 1, 0, true),
			listAirports('', 1, 0, false),
		])
		visitedTotal.value = visited.total
		referenceTotal.value = all.total
	} catch {
		// Non-critical decoration; the list itself surfaces a load failure.
	}
}

onMounted(async () => {
	fetchPage()
	fetchTotals()
	if (!store.loaded) await store.fetchAll()
})

let debounce: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
	if (debounce) clearTimeout(debounce)
	debounce = setTimeout(() => {
		offset.value = 0
		fetchPage()
	}, 250)
})

watch(showAll, () => {
	offset.value = 0
	fetchPage()
})

const emptyName = computed(() => {
	if (query.value) return 'No matches'
	return showAll.value ? 'No airports yet' : 'No flown airports yet'
})

const emptyDescription = computed(() => {
	if (query.value) return 'Try a different search term.'
	if (showAll.value) return 'An administrator can import airport reference data from the admin settings.'
	return 'Add flights to your log, or enable "Show all airports" to browse the full reference database.'
})

const pageStart = computed(() => total.value === 0 ? 0 : offset.value + 1)
const pageEnd = computed(() => Math.min(offset.value + items.value.length, total.value))
const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + items.value.length < total.value)

function prev() {
	if (!hasPrev.value) return
	offset.value = Math.max(0, offset.value - PAGE_SIZE)
	fetchPage()
}

function next() {
	if (!hasNext.value) return
	offset.value += PAGE_SIZE
	fetchPage()
}

function coord(a: Airport): string {
	if (a.lat === null || a.lon === null) return ''
	return `${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}`
}

// Canonical code as stored on flights: IATA when present, else ICAO.
function canonicalCode(a: Airport): string | null {
	return a.iata || a.icao || null
}

function showFlights(a: Airport, direction: 'to' | 'from' | 'either') {
	const code = canonicalCode(a)
	if (!code) return
	router.push({ name: 'flights', query: { airport: code, airportDir: direction } })
}

function showOnMap(a: Airport) {
	const code = canonicalCode(a)
	if (!code) return
	router.push({ name: 'map', query: { airport: code } })
}
</script>

<template>
	<div class="view-airports fj-view">
		<h2>Airports</h2>
		<div class="controls">
			<div class="switch-row">
				<NcCheckboxRadioSwitch
					:model-value="showAll"
					type="switch"
					@update:model-value="showAll = Boolean($event)">
					Show all airports
				</NcCheckboxRadioSwitch>
				<span v-if="summary" class="summary">{{ summary }}</span>
			</div>
			<NcTextField
				:model-value="query"
				label="Search"
				placeholder="ICAO, IATA, name or city"
				class="search"
				@update:model-value="query = String($event)" />
		</div>

		<div v-if="loading && !loaded" class="loader">
			<NcLoadingIcon />
		</div>
		<NcEmptyContent
			v-else-if="loaded && items.length === 0"
			:name="emptyName"
			:description="emptyDescription" />
		<template v-else>
			<!-- Explicit roles: the card layout changes these elements' display,
				 which can strip their table semantics in some browsers. -->
			<table class="airport-table" role="table">
				<thead role="rowgroup">
					<tr role="row">
						<th role="columnheader">
							ICAO
						</th>
						<th role="columnheader">
							IATA
						</th>
						<th role="columnheader">
							Name
						</th>
						<th role="columnheader">
							City
						</th>
						<th role="columnheader">
							Country
						</th>
						<th role="columnheader">
							Coordinates
						</th>
						<th role="columnheader">
							Elevation
						</th>
						<th role="columnheader">
							Timezone
						</th>
						<th class="numeric" role="columnheader">
							Flights
						</th>
						<th role="columnheader" aria-label="Actions" />
					</tr>
				</thead>
				<tbody role="rowgroup">
					<!-- An unset value must leave its cell :empty (the card layout
						 hides it): render '' rather than a placeholder. -->
					<tr v-for="a in items" :key="a.id" role="row">
						<td class="icao" role="cell">
							{{ a.icao ?? '' }}
						</td>
						<td class="iata" role="cell">
							{{ a.iata ?? '' }}
						</td>
						<td class="name" role="cell">
							{{ a.name ?? '' }}
						</td>
						<td class="city" role="cell">
							{{ [a.city, a.state].filter(Boolean).join(', ') }}
						</td>
						<td class="country" role="cell">
							{{ a.countryIso2 ?? '' }}
						</td>
						<td role="cell">
							{{ coord(a) }}
						</td>
						<td role="cell">
							{{ a.elevation ?? '' }}
						</td>
						<td role="cell">
							{{ a.tz ?? '' }}
						</td>
						<!-- data-unit: the card layout writes "N flights" from CSS,
							 leaving the cell's own text the bare count. -->
						<td class="numeric count" role="cell" :data-unit="flightCount(a) === 1 ? 'flight' : 'flights'">
							{{ flightCount(a) }}
						</td>
						<td class="row-actions" role="cell">
							<NcActions v-if="canonicalCode(a)" :force-menu="true">
								<NcActionButton @click="showFlights(a, 'to')">
									<template #icon>
										<AirplaneLanding :size="20" />
									</template>
									Show flights to {{ canonicalCode(a) }}
								</NcActionButton>
								<NcActionButton @click="showFlights(a, 'from')">
									<template #icon>
										<AirplaneTakeoff :size="20" />
									</template>
									Show flights from {{ canonicalCode(a) }}
								</NcActionButton>
								<NcActionButton @click="showFlights(a, 'either')">
									<template #icon>
										<SwapHorizontal :size="20" />
									</template>
									Show flights to and from {{ canonicalCode(a) }}
								</NcActionButton>
								<NcActionButton @click="showOnMap(a)">
									<template #icon>
										<MapMarker :size="20" />
									</template>
									Show {{ canonicalCode(a) }} on map
								</NcActionButton>
							</NcActions>
						</td>
					</tr>
				</tbody>
			</table>
			<div class="fj-pager">
				<span class="pager-info">
					{{ pageStart }}–{{ pageEnd }} of {{ total }}
				</span>
				<NcButton variant="secondary" :disabled="!hasPrev || loading" @click="prev">
					Previous
				</NcButton>
				<NcButton variant="secondary" :disabled="!hasNext || loading" @click="next">
					Next
				</NcButton>
			</div>
		</template>
	</div>
</template>

<style scoped>
.switch-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 20px;
}

.summary {
	color: var(--color-text-maxcontrast);
}

.controls {
	display: flex;
	flex-direction: column;
	align-items: start;
	gap: 12px;
	margin: 12px 0 16px;
}

.search {
	min-width: 280px;
}

.loader {
	display: flex;
	justify-content: center;
	padding: 32px;
}

.airport-table {
	width: 100%;
	border-collapse: collapse;
}

.airport-table th,
.airport-table td {
	padding: 8px;
	text-align: start;
	border-bottom: 1px solid var(--color-border);
}

.airport-table th {
	font-weight: bold;
	color: var(--color-text-maxcontrast);
}

/* Not ".pager": Nextcloud core styles that class (float: right and a 13em
   end margin, for an old core widget), which squeezed this row. */
.fj-pager {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	align-items: center;
	gap: 12px;
	margin-top: 12px;
}

.pager-info {
	color: var(--color-text-maxcontrast);
}

.airport-table .numeric {
	text-align: end;
}

.row-actions {
	width: 44px;
	padding: 0;
}

/* Medium widths: drop Coordinates (6), Elevation (7) and Timezone (8), header
   and cells together. An exclusive range, so the card rules never undo it. */
@media (701px <= width <= 1100px) {
	.airport-table th:nth-child(6),
	.airport-table th:nth-child(7),
	.airport-table th:nth-child(8),
	.airport-table td:nth-child(6),
	.airport-table td:nth-child(7),
	.airport-table td:nth-child(8) {
		display: none;
	}
}

/* Cards. Keep 700px in step with CARD_BREAKPOINT_PX (useCardLayout.ts).

   Each row becomes a wrapping flex line of its cells, reordered into two
   lines — "IATA · ICAO" then the name; city, country · N flights — with the
   row's ::before as the line break and the row menu in its end padding. Unset
   values leave their cell :empty, and it is hidden; separators go only
   between set values. Coordinates, elevation and timezone are left out. */
@media (width <= 700px) {
	.airport-table,
	.airport-table tbody {
		display: block;
	}

	.airport-table thead,
	.airport-table td:nth-child(6),
	.airport-table td:nth-child(7),
	.airport-table td:nth-child(8) {
		display: none;
	}

	.airport-table tr {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		row-gap: 2px;
		min-height: 44px;
		padding-block: 10px;
		padding-inline: 0 48px;
		border-bottom: 1px solid var(--color-border);
	}

	.airport-table tr::before {
		content: '';
		order: 4;
		flex-basis: 100%;
		height: 0;
	}

	.airport-table td {
		display: block;
		min-width: 0;
		padding: 0;
		border: none;
	}

	.airport-table td:empty {
		display: none;
	}

	/* Line 1 wraps rather than truncating: it identifies the airport. IATA
	   leads, as it is the code flights store when there is one. */
	/* The gap before the name is the codes' end margin, not the name's start
	   margin, so a name that wraps onto its own line starts flush. */
	.airport-table td.iata {
		order: 1;
		margin-inline-end: 8px;
	}

	.airport-table td.icao {
		order: 2;
		margin-inline-end: 8px;
	}

	.airport-table td.icao:not(:empty) + td.iata:not(:empty) {
		margin-inline-end: 0;
	}

	.airport-table td.icao:not(:empty) + td.iata:not(:empty)::after {
		content: '·';
		margin-inline: 6px;
	}

	.airport-table td.name {
		order: 3;
		overflow-wrap: anywhere;
	}

	/* Line 2. */
	.airport-table td.city,
	.airport-table td.country,
	.airport-table td.count {
		color: var(--color-text-maxcontrast);
	}

	.airport-table td.city {
		order: 5;
		overflow-wrap: anywhere;
	}

	.airport-table td.country {
		order: 6;
	}

	/* The comma ends the city, so a country that wraps doesn't start its
	   line with one. */
	.airport-table td.city:not(:empty):has(+ td.country:not(:empty))::after {
		content: ',';
		margin-inline-end: 0.3em;
	}

	.airport-table td.count {
		order: 7;
		white-space: nowrap;
	}

	.airport-table td.count::after {
		content: '\00a0' attr(data-unit);
	}

	.airport-table td.city:not(:empty) ~ td.count::before,
	.airport-table td.country:not(:empty) ~ td.count::before {
		content: '·';
		margin-inline: 6px;
	}

	.airport-table td.row-actions {
		position: absolute;
		top: 0;
		inset-inline-end: 0;
		width: auto;
		--default-clickable-area: 44px;
	}
}
</style>
