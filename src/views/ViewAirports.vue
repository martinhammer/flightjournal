<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import AirplaneLanding from 'vue-material-design-icons/AirplaneLanding.vue'
import AirplaneTakeoff from 'vue-material-design-icons/AirplaneTakeoff.vue'
import SwapHorizontal from 'vue-material-design-icons/SwapHorizontal.vue'
import { showError } from '@nextcloud/dialogs'
import { listAirports } from '../api.ts'
import type { Airport } from '../types.ts'

const router = useRouter()

const PAGE_SIZE = 100

const query = ref('')
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
		const page = await listAirports(query.value, PAGE_SIZE, offset.value)
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

onMounted(fetchPage)

let debounce: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
	if (debounce) clearTimeout(debounce)
	debounce = setTimeout(() => {
		offset.value = 0
		fetchPage()
	}, 250)
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
</script>

<template>
	<div class="view-airports">
		<div class="header">
			<h2>Airports</h2>
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
			:name="query ? 'No matches' : 'No airports yet'"
			:description="query ? 'Try a different search term.' : 'An administrator can import airport reference data from the admin settings.'" />
		<template v-else>
			<table class="airport-table">
				<thead>
					<tr>
						<th>ICAO</th>
						<th>IATA</th>
						<th>Name</th>
						<th>City</th>
						<th>Country</th>
						<th>Coordinates</th>
						<th>Elevation</th>
						<th>Timezone</th>
						<th />
					</tr>
				</thead>
				<tbody>
					<tr v-for="a in items" :key="a.id">
						<td>{{ a.icao ?? '' }}</td>
						<td>{{ a.iata ?? '' }}</td>
						<td>{{ a.name ?? '' }}</td>
						<td>{{ [a.city, a.state].filter(Boolean).join(', ') }}</td>
						<td>{{ a.countryIso2 ?? '' }}</td>
						<td>{{ coord(a) }}</td>
						<td>{{ a.elevation ?? '' }}</td>
						<td>{{ a.tz ?? '' }}</td>
						<td class="row-actions">
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
							</NcActions>
						</td>
					</tr>
				</tbody>
			</table>
			<div class="pager">
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
.view-airports {
	padding: 16px;
}

.header {
	display: flex;
	justify-content: space-between;
	align-items: end;
	gap: 16px;
	margin-bottom: 16px;
	flex-wrap: wrap;
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

.pager {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 12px;
	margin-top: 12px;
}

.pager-info {
	color: var(--color-text-maxcontrast);
}

.row-actions {
	width: 44px;
	padding: 0;
}
</style>
