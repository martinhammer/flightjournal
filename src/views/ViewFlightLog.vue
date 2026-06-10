<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcChip from '@nextcloud/vue/components/NcChip'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import ChevronDown from 'vue-material-design-icons/ChevronDown.vue'
import ChevronUp from 'vue-material-design-icons/ChevronUp.vue'
import MenuDown from 'vue-material-design-icons/MenuDown.vue'
import MenuUp from 'vue-material-design-icons/MenuUp.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import TrashCan from 'vue-material-design-icons/TrashCan.vue'
import { showConfirmation, showError } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import FilterPicker from '../components/FilterPicker.vue'
import { applyFilters, buildFilters, type ActiveFilter } from '../filters.ts'
import { CABIN_CLASSES, type Flight } from '../types.ts'
import Map from 'vue-material-design-icons/Map.vue'

type SortKey = 'date' | 'flight' | 'route' | 'distance' | 'aircraft' | 'registration' | 'cabin' | 'seat'
type SortDir = 'asc' | 'desc'

const cabinLabels: Record<string, string> = Object.fromEntries(
	CABIN_CLASSES.map((c) => [c.value, c.label]),
)

const router = useRouter()
const route = useRoute()
const store = useFlightsStore()

const activeFilters = computed<ActiveFilter[]>(() => buildFilters(route.query, store.flights))

function clearFilter(filter: ActiveFilter) {
	const query: LocationQuery = { ...route.query }
	for (const key of filter.queryKeys) delete query[key]
	router.push({ name: 'flights', query })
}

// Carry the current filter query across to the Map view.
function viewOnMap() {
	router.push({ name: 'map', query: { ...route.query } })
}

// Show a single flight on the Map view.
function viewFlightOnMap(f: Flight) {
	router.push({ name: 'map', query: { flight: String(f.id) } })
}

onMounted(() => { if (!store.loaded) store.fetchAll() })

const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

const columns: { key: SortKey; label: string; defaultDir: SortDir }[] = [
	{ key: 'date', label: 'Date', defaultDir: 'desc' },
	{ key: 'flight', label: 'Flight', defaultDir: 'asc' },
	{ key: 'route', label: 'Route', defaultDir: 'asc' },
	{ key: 'distance', label: 'Distance (km)', defaultDir: 'desc' },
	{ key: 'aircraft', label: 'Aircraft', defaultDir: 'asc' },
	{ key: 'registration', label: 'Reg.', defaultDir: 'asc' },
	{ key: 'cabin', label: 'Cabin', defaultDir: 'asc' },
	{ key: 'seat', label: 'Seat', defaultDir: 'asc' },
]

function sortValue(f: Flight, key: SortKey): string {
	switch (key) {
	case 'date':
		return f.flightDate
	case 'flight':
		return `${f.airlineCode ?? ''}${(f.flightNumber ?? '').padStart(6, '0')}`
	case 'route':
		return routeLabel(f).toLowerCase()
	case 'distance':
		// Zero-padded so the string sort orders numerically; unknowns sort lowest.
		return String(f.distanceKm ?? 0).padStart(6, '0')
	case 'aircraft':
		return (f.aircraftTypeRaw ?? f.aircraftTypeCode ?? '').toLowerCase()
	case 'registration':
		return (f.registration ?? '').toLowerCase()
	case 'cabin':
		return (f.cabinClass ? cabinLabels[f.cabinClass] ?? f.cabinClass : '').toLowerCase()
	case 'seat':
		return (f.seat ?? '').toLowerCase()
	}
}

const sortedFlights = computed<Flight[]>(() => {
	const list = [...store.flights]
	const dir = sortDir.value === 'asc' ? 1 : -1
	list.sort((a, b) => {
		const av = sortValue(a, sortKey.value)
		const bv = sortValue(b, sortKey.value)
		if (av < bv) return -1 * dir
		if (av > bv) return 1 * dir
		// Within a day, follow the date direction by day_seq so the newest day's
		// last leg sits on top (and the oldest day's first leg leads when ascending).
		if (sortKey.value === 'date' && a.daySeq !== b.daySeq) return (a.daySeq - b.daySeq) * dir
		return a.id - b.id
	})
	return list
})

const visibleFlights = computed<Flight[]>(() => applyFilters(sortedFlights.value, activeFilters.value))

// Within-day reordering only makes sense in the natural date-sorted view where
// the visual neighbour is the day-order neighbour. That holds with no filters,
// and also under the "Days with multiple flights" filter alone — it keeps whole
// days intact (it's there precisely to make reordering easier). Any other filter
// can drop legs from a day, breaking the neighbour relationship.
const canReorder = computed(() => {
	if (sortKey.value !== 'date') return false
	const filters = activeFilters.value
	return filters.length === 0 || (filters.length === 1 && filters[0].id === 'multiday')
})

function sameDayPrev(i: number): boolean {
	const list = visibleFlights.value
	return i > 0 && list[i - 1].flightDate === list[i].flightDate
}

function sameDayNext(i: number): boolean {
	const list = visibleFlights.value
	return i < list.length - 1 && list[i + 1].flightDate === list[i].flightDate
}

const canMoveUp = (i: number) => canReorder.value && sameDayPrev(i)
const canMoveDown = (i: number) => canReorder.value && sameDayNext(i)
const hasDaySiblings = (i: number) => canReorder.value && (sameDayPrev(i) || sameDayNext(i))

// Translate the visual chevron into a day-order move. With the newest day on top
// (date desc) the up chevron pushes a leg later in the day; ascending flips it.
async function move(f: Flight, isUp: boolean) {
	const direction = isUp === (sortDir.value === 'desc') ? 'later' : 'earlier'
	try {
		await store.move(f.id, direction)
	} catch {
		showError('Failed to reorder flight')
	}
}

const headerCount = computed(() => {
	const total = store.flights.length
	const shown = visibleFlights.value.length
	const plural = (n: number) => `${n} flight${n === 1 ? '' : 's'}`
	if (activeFilters.value.length === 0 || shown === total) return plural(total)
	return `${shown} of ${plural(total)}`
})

function setSort(key: SortKey) {
	if (sortKey.value === key) {
		sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
	} else {
		sortKey.value = key
		sortDir.value = columns.find((c) => c.key === key)?.defaultDir ?? 'asc'
	}
}

function routeLabel(f: Flight): string {
	const o = f.originCode || f.originLabel || '?'
	const d = f.destinationCode || f.destinationLabel || '?'
	return `${o} → ${d}`
}

function flightNo(f: Flight): string {
	if (!f.airlineCode && !f.flightNumber) return ''
	return `${f.airlineCode ?? ''}${f.flightNumber ?? ''}`
}

function edit(f: Flight) {
	// Carry the active filter query along so it survives the edit round-trip.
	router.push({ path: `/flights/${f.id}/edit`, query: route.query })
}

async function remove(f: Flight) {
	const origin = f.originLabel || f.originCode || '?'
	const destination = f.destinationLabel || f.destinationCode || '?'
	const confirmed = await showConfirmation({
		name: 'Delete flight',
		text: `Delete the flight on ${f.flightDate} from ${origin} to ${destination}? This cannot be undone.`,
		labelConfirm: 'Delete',
		labelReject: 'Cancel',
		severity: 'warning',
	})
	if (!confirmed) return
	try {
		await store.remove(f.id)
	} catch {
		showError('Failed to delete flight')
	}
}
</script>

<template>
	<div class="view-flight">
		<h2>Flight log</h2>
		<div v-if="store.loading && !store.loaded" class="loader">
			<NcLoadingIcon />
		</div>
		<template v-else>
			<div class="filter-bar">
				<FilterPicker :flights="store.flights" />
				<NcChip
					v-for="filter in activeFilters"
					:key="filter.id"
					:text="filter.label"
					@close="clearFilter(filter)" />
				<span class="filter-count">{{ headerCount }}</span>
			</div>
			<div v-if="activeFilters.length" class="filter-actions">
				<NcButton variant="secondary" @click="viewOnMap">
					<template #icon>
						<Map :size="20" />
					</template>
					View on map
				</NcButton>
			</div>
			<NcEmptyContent
				v-if="store.flights.length === 0"
				name="No flights yet"
				description="Add your first flight to get started." />
			<NcEmptyContent
				v-else-if="visibleFlights.length === 0"
				name="No matching flights"
				description="No flights match the current filter." />
			<table v-else class="flight-table">
				<thead>
					<tr>
						<th v-for="col in columns" :key="col.key" :class="{ sorted: sortKey === col.key, numeric: col.key === 'distance' }">
							<button
								type="button"
								class="sort-button"
								:aria-sort="sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'"
								@click="setSort(col.key)">
								<span>{{ col.label }}</span>
								<span class="sort-indicator">
									<MenuUp v-if="sortKey === col.key && sortDir === 'asc'" :size="16" />
									<MenuDown v-else-if="sortKey === col.key && sortDir === 'desc'" :size="16" />
								</span>
							</button>
						</th>
						<th />
						<th />
					</tr>
				</thead>
				<tbody>
					<tr v-for="(f, i) in visibleFlights" :key="f.id">
						<td>{{ f.flightDate }}</td>
						<td>{{ flightNo(f) }}</td>
						<td>{{ routeLabel(f) }}</td>
						<td class="numeric">
							{{ f.distanceKm?.toLocaleString() ?? '' }}
						</td>
						<td>{{ f.aircraftTypeRaw ?? f.aircraftTypeCode ?? '' }}</td>
						<td>{{ f.registration ?? '' }}</td>
						<td>{{ f.cabinClass ? cabinLabels[f.cabinClass] ?? f.cabinClass : '' }}</td>
						<td>{{ f.seat ?? '' }}</td>
						<td class="reorder">
							<div v-if="hasDaySiblings(i)" class="reorder-controls">
								<NcButton
									variant="tertiary-no-background"
									:disabled="!canMoveUp(i)"
									:title="canMoveUp(i) ? 'Reorder same-day flights' : undefined"
									aria-label="Move up within the day"
									@click="move(f, true)">
									<template #icon>
										<ChevronUp :size="16" />
									</template>
								</NcButton>
								<NcButton
									variant="tertiary-no-background"
									:disabled="!canMoveDown(i)"
									:title="canMoveDown(i) ? 'Reorder same-day flights' : undefined"
									aria-label="Move down within the day"
									@click="move(f, false)">
									<template #icon>
										<ChevronDown :size="16" />
									</template>
								</NcButton>
							</div>
						</td>
						<td class="actions">
							<NcActions :force-menu="true">
								<NcActionButton @click="viewFlightOnMap(f)">
									<template #icon>
										<Map :size="20" />
									</template>
									View on map
								</NcActionButton>
								<NcActionButton @click="edit(f)">
									<template #icon>
										<Pencil :size="20" />
									</template>
									Edit
								</NcActionButton>
								<NcActionButton @click="remove(f)">
									<template #icon>
										<TrashCan :size="20" />
									</template>
									Delete
								</NcActionButton>
							</NcActions>
						</td>
					</tr>
				</tbody>
			</table>
		</template>
	</div>
</template>

<style scoped>
.view-flight {
	padding: 16px;
}

.loader {
	display: flex;
	justify-content: center;
	padding: 32px;
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

.flight-table {
	width: 100%;
	border-collapse: collapse;
}

.flight-table th,
.flight-table td {
	padding: 8px;
	text-align: start;
	border-bottom: 1px solid var(--color-border);
}

.flight-table th {
	font-weight: bold;
	color: var(--color-text-maxcontrast);
}

.flight-table th.sorted {
	color: var(--color-main-text);
}

.flight-table th.numeric,
.flight-table td.numeric {
	text-align: end;
	white-space: nowrap;
	/* Breathing room before the Aircraft column. */
	padding-inline-end: 24px;
}

.flight-table td.numeric {
	font-variant-numeric: tabular-nums;
}

/* Right-align the sort button so the header sits directly above the figures. */
.flight-table th.numeric .sort-button {
	margin-inline: 0 -6px;
}

.sort-button {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 6px;
	margin-inline-start: -6px;
	background: transparent;
	border: none;
	border-radius: var(--border-radius);
	font: inherit;
	color: inherit;
	cursor: pointer;
}

.sort-button:hover {
	background-color: var(--color-background-hover);
}

.sort-indicator {
	display: inline-flex;
	width: 16px;
	height: 16px;
}

.actions {
	display: flex;
	gap: 4px;
}

.flight-table td.reorder {
	/* Shrink the chevron buttons so the stacked pair doesn't inflate row height
	   beyond the other rows (whose height is set by the kebab menu's tap target). */
	--default-clickable-area: 20px;
	width: 1px;
	padding-block: 0;
	padding-inline: 0;
}

.reorder-controls {
	display: inline-flex;
	flex-direction: column;
}
</style>
