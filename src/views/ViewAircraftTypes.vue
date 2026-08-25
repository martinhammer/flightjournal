<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import Airplane from 'vue-material-design-icons/Airplane.vue'
import { showError } from '@nextcloud/dialogs'
import { listAircraftTypes } from '../api.ts'
import type { AircraftType } from '../types.ts'

const router = useRouter()

const PAGE_SIZE = 100

const query = ref('')
// Default: only designators the current user has flown.
const showAll = ref(false)
const offset = ref(0)
const total = ref(0)
const items = ref<AircraftType[]>([])
const loading = ref(false)
const loaded = ref(false)

let searchToken = 0

async function fetchPage() {
	const token = ++searchToken
	loading.value = true
	try {
		const page = await listAircraftTypes(query.value, PAGE_SIZE, offset.value, !showAll.value)
		if (token !== searchToken) return
		items.value = page.items
		total.value = page.total
		loaded.value = true
	} catch {
		if (token === searchToken) showError('Failed to load aircraft types')
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

watch(showAll, () => {
	offset.value = 0
	fetchPage()
})

const emptyName = computed(() => {
	if (query.value) return 'No matches'
	return showAll.value ? 'No aircraft types yet' : 'No flown aircraft types yet'
})

const emptyDescription = computed(() => {
	if (query.value) return 'Try a different search term.'
	if (showAll.value) return 'An administrator can import aircraft type reference data from the admin settings.'
	return 'Add flights with an aircraft type and reconcile them from Personal settings, '
		+ 'or enable "Show all aircraft types" to browse the full reference database.'
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

function engines(t: AircraftType): string {
	if (t.engineType === null && t.engineCount === null) return ''
	return [t.engineCount, t.engineType].filter((v) => v !== null && v !== '').join(' × ')
}

/**
 * The flights filter matches on the Aircraft column's displayed value, which
 * for a reconciled leg is the model — so that, not the designator, is what
 * links a reference row to the flights that resolved to it. Both sides are
 * upper-cased by the filter, so case here does not matter.
 */
function showFlights(t: AircraftType) {
	if (!t.model) return
	router.push({ name: 'flights', query: { aircraft: t.model } })
}
</script>

<template>
	<div class="view-aircraft-types">
		<h2>Aircraft types</h2>
		<div class="controls">
			<NcCheckboxRadioSwitch
				:model-value="showAll"
				type="switch"
				@update:model-value="showAll = Boolean($event)">
				Show all aircraft types
			</NcCheckboxRadioSwitch>
			<NcTextField
				:model-value="query"
				label="Search"
				placeholder="Designator, manufacturer or model"
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
			<table class="aircraft-table">
				<thead>
					<tr>
						<th>ICAO</th>
						<th>IATA</th>
						<th>Manufacturer</th>
						<th>Model</th>
						<th>Class</th>
						<th>Engines</th>
						<th>Wake</th>
						<th />
					</tr>
				</thead>
				<tbody>
					<tr v-for="t in items" :key="t.id">
						<td>{{ t.icaoCode }}</td>
						<td>{{ t.iataCode ?? '' }}</td>
						<td>{{ t.manufacturer ?? '' }}</td>
						<td>
							{{ t.model ?? '' }}
							<span v-if="t.canonical" class="default-badge" title="The model a bare type designator resolves to">default</span>
						</td>
						<td>{{ t.description ?? '' }}</td>
						<td>{{ engines(t) }}</td>
						<td>{{ t.wtc ?? '' }}</td>
						<td class="row-actions">
							<NcActions v-if="t.model" :force-menu="true">
								<NcActionButton @click="showFlights(t)">
									<template #icon>
										<Airplane :size="20" />
									</template>
									Show flights on {{ t.model }}
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
.view-aircraft-types {
	padding: 16px;
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

.aircraft-table {
	width: 100%;
	border-collapse: collapse;
}

.aircraft-table th,
.aircraft-table td {
	padding: 8px;
	text-align: start;
	border-bottom: 1px solid var(--color-border);
}

.aircraft-table th {
	font-weight: bold;
	color: var(--color-text-maxcontrast);
}

/* Marks the row a bare designator resolves to, since a designator often
   covers several models. */
.default-badge {
	margin-inline-start: 6px;
	padding: 1px 6px;
	border-radius: 8px;
	font-size: 0.75em;
	background-color: var(--color-primary-element-light);
	color: var(--color-primary-element-light-text);
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
