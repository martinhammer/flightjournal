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
import { useFlightsStore } from '../store/flights.ts'
import { countByAircraft } from '../flightCounts.ts'
import { aircraftName, type AircraftType } from '../types.ts'

const router = useRouter()
const store = useFlightsStore()

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

// The store is usually already warm (Flights is the default route); fetch only
// if not. Counting here rather than server-side keeps the number keyed by the
// same value the flights filter matches on — see flightCounts.ts.
const flightCounts = computed(() => countByAircraft(store.flights))
const flightCount = (t: AircraftType) => flightCounts.value.get((typeName(t) ?? '').toUpperCase()) ?? 0

// Headline summary: how many reference models the user has flown out of the
// whole table. Both numbers come from the server rather than the store, so each
// is exactly the size of the list the corresponding "Show all" mode shows (an
// unresolved or half-reconciled leg matches no reference row, so it is in
// neither). Deliberately independent of the search box and the switch — the
// pager already reports what the current query returns.
const flownTotal = ref<number | null>(null)
const referenceTotal = ref<number | null>(null)

const summary = computed(() => {
	if (flownTotal.value === null || referenceTotal.value === null) return ''
	return `${flownTotal.value.toLocaleString()} flown / ${referenceTotal.value.toLocaleString()} total`
})

async function fetchTotals() {
	try {
		const [flown, all] = await Promise.all([
			listAircraftTypes('', 1, 0, true),
			listAircraftTypes('', 1, 0, false),
		])
		flownTotal.value = flown.total
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

const typeName = (t: AircraftType) => aircraftName(t.manufacturer, t.model)

function engines(t: AircraftType): string {
	if (t.engineType === null && t.engineCount === null) return ''
	return [t.engineCount, t.engineType].filter((v) => v !== null && v !== '').join(' × ')
}

/**
 * The flights filter matches on the Aircraft column's displayed value, which for
 * a reconciled leg is "MANUFACTURER Model" — so that, not the designator, is
 * what links a reference row to the flights that resolved to it. Built from the
 * shared aircraftName() for exactly that reason. Both sides are upper-cased by
 * the filter, so case here does not matter.
 */
function showFlights(t: AircraftType) {
	const name = typeName(t)
	if (!name) return
	router.push({ name: 'flights', query: { aircraft: name } })
}
</script>

<template>
	<div class="view-aircraft-types fj-view">
		<h2>Aircraft types</h2>
		<div class="controls">
			<div class="switch-row">
				<NcCheckboxRadioSwitch
					:model-value="showAll"
					type="switch"
					@update:model-value="showAll = Boolean($event)">
					Show all aircraft types
				</NcCheckboxRadioSwitch>
				<span v-if="summary" class="summary">{{ summary }}</span>
			</div>
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
			<!-- Explicit roles: the card layout changes these elements' display,
				 which can strip their table semantics in some browsers. -->
			<table class="aircraft-table" role="table">
				<thead role="rowgroup">
					<tr role="row">
						<th role="columnheader">
							ICAO
						</th>
						<!-- No IATA column: `iata_code` exists in the schema but nothing
						     writes it yet (the OpenFlights overlay is deferred), so it
						     would render an empty cell on every row. Restore this and
						     its <td> when the overlay lands. -->
						<th role="columnheader">
							Manufacturer
						</th>
						<th role="columnheader">
							Model
						</th>
						<th role="columnheader">
							Class
						</th>
						<th role="columnheader">
							Engines
						</th>
						<th role="columnheader">
							Wake
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
					<tr v-for="t in items" :key="t.id" role="row">
						<td class="designator" role="cell">
							{{ t.icaoCode }}
						</td>
						<td class="manufacturer" role="cell">
							{{ t.manufacturer ?? '' }}
						</td>
						<td class="model" role="cell">
							{{ t.model ?? '' }}
							<span v-if="t.canonical" class="default-badge" title="Several models can share one ICAO code, this is the default one for this code">default</span>
						</td>
						<td class="detail" role="cell">
							{{ t.description ?? '' }}
						</td>
						<td class="detail" role="cell">
							{{ engines(t) }}
						</td>
						<td class="detail wake" role="cell">
							{{ t.wtc ?? '' }}
						</td>
						<!-- data-unit: the card layout writes "N flights" from CSS,
							 leaving the cell's own text the bare count. -->
						<td class="numeric count detail" role="cell" :data-unit="flightCount(t) === 1 ? 'flight' : 'flights'">
							{{ flightCount(t) }}
						</td>
						<td class="row-actions" role="cell">
							<NcActions v-if="typeName(t)" :force-menu="true">
								<NcActionButton @click="showFlights(t)">
									<template #icon>
										<Airplane :size="20" />
									</template>
									Show flights on {{ typeName(t) }}
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

.aircraft-table .numeric {
	text-align: end;
}

.row-actions {
	width: 44px;
	padding: 0;
}

/* Medium widths: drop Engines (5) and Wake (6), header and cells together. An
   exclusive range, so the card rules never undo it. */
@media (701px <= width <= 1100px) {
	.aircraft-table th:nth-child(5),
	.aircraft-table th:nth-child(6),
	.aircraft-table td:nth-child(5),
	.aircraft-table td:nth-child(6) {
		display: none;
	}
}

/* Cards. Keep 700px in step with CARD_BREAKPOINT_PX (useCardLayout.ts).

   Each row becomes a wrapping flex line of its cells in two lines —
   designator, manufacturer and model (with its badge); class · engines ·
   wake · N flights — with the row's ::before as the line break and the row
   menu in its end padding. Unset values leave their cell :empty, and it is
   hidden; the "·" separators go only between set values. */
@media (width <= 700px) {
	.aircraft-table,
	.aircraft-table tbody {
		display: block;
	}

	.aircraft-table thead {
		display: none;
	}

	.aircraft-table tr {
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

	.aircraft-table tr::before {
		content: '';
		order: 2;
		flex-basis: 100%;
		height: 0;
	}

	.aircraft-table td {
		display: block;
		min-width: 0;
		padding: 0;
		border: none;
	}

	.aircraft-table td:empty {
		display: none;
	}

	/* Line 1 wraps rather than truncating: it identifies the type. */
	.aircraft-table td.designator,
	.aircraft-table td.manufacturer,
	.aircraft-table td.model {
		order: 1;
		margin-inline-end: 8px;
		overflow-wrap: anywhere;
	}

	/* Line 2. */
	.aircraft-table td.detail {
		order: 3;
		white-space: nowrap;
		color: var(--color-text-maxcontrast);
	}

	.aircraft-table td.detail:not(:empty) ~ td.detail:not(:empty)::before {
		content: '·';
		margin-inline: 6px;
	}

	/* A lone "M" says nothing without its column header. */
	.aircraft-table td.wake:not(:empty)::after {
		content: '\00a0wake';
	}

	.aircraft-table td.count::after {
		content: '\00a0' attr(data-unit);
	}

	.aircraft-table td.row-actions {
		position: absolute;
		top: 0;
		inset-inline-end: 0;
		width: auto;
		--default-clickable-area: 44px;
	}
}
</style>
