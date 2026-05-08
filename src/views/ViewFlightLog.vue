<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import MenuDown from 'vue-material-design-icons/MenuDown.vue'
import MenuUp from 'vue-material-design-icons/MenuUp.vue'
import Pencil from 'vue-material-design-icons/Pencil.vue'
import TrashCan from 'vue-material-design-icons/TrashCan.vue'
import { showConfirmation, showError } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { CABIN_CLASSES, type Flight } from '../types.ts'

type SortKey = 'date' | 'flight' | 'route' | 'aircraft' | 'registration' | 'cabin' | 'seat'
type SortDir = 'asc' | 'desc'

const cabinLabels: Record<string, string> = Object.fromEntries(
	CABIN_CLASSES.map((c) => [c.value, c.label]),
)

const router = useRouter()
const store = useFlightsStore()

onMounted(() => { if (!store.loaded) store.fetchAll() })

const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

const columns: { key: SortKey; label: string; defaultDir: SortDir }[] = [
	{ key: 'date', label: 'Date', defaultDir: 'desc' },
	{ key: 'flight', label: 'Flight', defaultDir: 'asc' },
	{ key: 'route', label: 'Route', defaultDir: 'asc' },
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
		return route(f).toLowerCase()
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
		return a.id - b.id
	})
	return list
})

function setSort(key: SortKey) {
	if (sortKey.value === key) {
		sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
	} else {
		sortKey.value = key
		sortDir.value = columns.find((c) => c.key === key)?.defaultDir ?? 'asc'
	}
}

function route(f: Flight): string {
	const o = f.originLabel || f.originCode || '?'
	const d = f.destinationLabel || f.destinationCode || '?'
	return `${o} → ${d}`
}

function flightNo(f: Flight): string {
	if (!f.airlineCode && !f.flightNumber) return ''
	return `${f.airlineCode ?? ''}${f.flightNumber ?? ''}`
}

function edit(f: Flight) {
	router.push(`/flights/${f.id}/edit`)
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
		<div class="header">
			<h2>Flight log</h2>
		</div>
		<div v-if="store.loading && !store.loaded" class="loader">
			<NcLoadingIcon />
		</div>
		<NcEmptyContent
			v-else-if="store.loaded && store.flights.length === 0"
			name="No flights yet"
			description="Add your first flight to get started." />
		<table v-else class="flight-table">
			<thead>
				<tr>
					<th v-for="col in columns" :key="col.key" :class="{ sorted: sortKey === col.key }">
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
				</tr>
			</thead>
			<tbody>
				<tr v-for="f in sortedFlights" :key="f.id">
					<td>{{ f.flightDate }}</td>
					<td>{{ flightNo(f) }}</td>
					<td>{{ route(f) }}</td>
					<td>{{ f.aircraftTypeRaw ?? f.aircraftTypeCode ?? '' }}</td>
					<td>{{ f.registration ?? '' }}</td>
					<td>{{ f.cabinClass ? cabinLabels[f.cabinClass] ?? f.cabinClass : '' }}</td>
					<td>{{ f.seat ?? '' }}</td>
					<td class="actions">
						<NcActions :force-menu="true">
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
	</div>
</template>

<style scoped>
.view-flight {
	padding: 16px;
}

.header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 16px;
}

.loader {
	display: flex;
	justify-content: center;
	padding: 32px;
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
</style>
