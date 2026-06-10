<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryValue } from 'vue-router'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import Plus from 'vue-material-design-icons/Plus.vue'
import { listAirports } from '../api.ts'
import { CABIN_CLASSES, type Flight } from '../types.ts'

// The four v1 filter types. All four use the same NcPopover editor surface for
// a consistent Apply-button style; the NcActions menu only does type selection.
type FilterType = 'date' | 'cabin' | 'airline' | 'aircraft'

const props = defineProps<{ flights: Flight[] }>()

const route = useRoute()
const router = useRouter()

// NcActions open state (only used for the filter-type picker).
const menuOpen = ref(false)

// NcPopover open state and which editor it's currently hosting.
const editorOpen = ref(false)
const editorType = ref<FilterType | null>(null)

// Staged editor values. They prefill from the current URL when an editor opens
// and only commit to the router when the user clicks Apply.
const stagedCabins = ref<Set<string>>(new Set())
const stagedDateFrom = ref<Date | null>(null)
const stagedDateTo = ref<Date | null>(null)
const stagedAirlines = ref<Set<string>>(new Set())
const stagedAircraft = ref<Set<string>>(new Set())

// Free-text search applied to the scrollable airline / aircraft checkbox list.
const airlineSearch = ref('')
const aircraftSearch = ref('')

// Whether the instance has any airport reference data. The "Unmatched airports"
// filter is only meaningful when reconciliation has something to match against,
// so the menu item is hidden until we confirm at least one reference airport.
const hasReferenceData = ref(false)
onMounted(async () => {
	try {
		const page = await listAirports('', 1, 0, false)
		hasReferenceData.value = page.total > 0
	} catch {
		hasReferenceData.value = false
	}
})

// Whether the user has any date with more than one flight — the precondition for
// offering the "Days with multiple flights" filter.
const hasMultiFlightDays = computed<boolean>(() => {
	const seen = new Set<string>()
	for (const f of props.flights) {
		if (seen.has(f.flightDate)) return true
		seen.add(f.flightDate)
	}
	return false
})

// These two are toggles (no editor surface): hide the menu item once active so
// it isn't a no-op entry — the chip's close button is how you turn it back off.
const unmatchedActive = computed(() => route.query.unmatched === '1')
const multidayActive = computed(() => route.query.multiday === '1')
const showUnmatched = computed(() => hasReferenceData.value && !unmatchedActive.value)
const showMultiday = computed(() => hasMultiFlightDays.value && !multidayActive.value)

// Distinct airline / aircraft codes derived from the user's own flights —
// option lists until reference data lands.
const airlineOptions = computed<string[]>(() => distinctCodes(props.flights.map((f) => f.airlineCode)))
// Aircraft uses raw-then-code to match the table's display value — many flights
// only have aircraftTypeRaw populated until canonicalisation lands.
const aircraftOptions = computed<string[]>(() => distinctCodes(
	props.flights.map((f) => f.aircraftTypeRaw ?? f.aircraftTypeCode),
))

// Filter the options by the current search term (case-insensitive substring).
// Staged codes always remain visible so the user can untick them even when the
// search would otherwise hide them.
const filteredAirlineOptions = computed(() => filterCodes(airlineOptions.value, airlineSearch.value, stagedAirlines.value))
const filteredAircraftOptions = computed(() => filterCodes(aircraftOptions.value, aircraftSearch.value, stagedAircraft.value))

function distinctCodes(values: Array<string | null>): string[] {
	const seen = new Set<string>()
	for (const v of values) {
		if (v) seen.add(v.toUpperCase())
	}
	return [...seen].sort()
}

function filterCodes(all: string[], search: string, staged: Set<string>): string[] {
	const q = search.trim().toUpperCase()
	if (!q) return all
	return all.filter((code) => code.includes(q) || staged.has(code))
}

// Reopening the picker dismisses whatever editor was open. Click on the
// trigger fires unconditionally — the simplest reliable hook.
function onTriggerClick() {
	editorOpen.value = false
}

function cancelEditor() {
	editorOpen.value = false
}

// Root element of the picker; used to detect clicks outside the editor so we
// can dismiss it without an explicit Cancel click. The editor is a plain
// absolutely-positioned div (not an NcPopover), so we wire this ourselves.
const rootEl = ref<HTMLElement | null>(null)

function onDocumentPointerDown(event: PointerEvent) {
	if (!editorOpen.value) return
	const target = event.target as Node | null
	if (target && rootEl.value && rootEl.value.contains(target)) return
	editorOpen.value = false
}

watch(editorOpen, (open) => {
	if (open) {
		document.addEventListener('pointerdown', onDocumentPointerDown, true)
	} else {
		document.removeEventListener('pointerdown', onDocumentPointerDown, true)
	}
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})

// Opening an editor: close the picker menu, prefill staged values from the
// URL, then open the popover.
function openEditor(type: FilterType) {
	editorType.value = type
	if (type === 'cabin') {
		stagedCabins.value = new Set(csvFromQuery(route.query.cabin).map((c) => c.toLowerCase()))
	} else if (type === 'date') {
		stagedDateFrom.value = parseDate(route.query.dateFrom)
		stagedDateTo.value = parseDate(route.query.dateTo)
	} else if (type === 'airline') {
		stagedAirlines.value = new Set(csvFromQuery(route.query.airline))
		airlineSearch.value = ''
	} else {
		stagedAircraft.value = new Set(csvFromQuery(route.query.aircraft))
		aircraftSearch.value = ''
	}
	menuOpen.value = false
	editorOpen.value = true
}

function csvFromQuery(value: LocationQueryValue | LocationQueryValue[] | undefined): string[] {
	if (typeof value !== 'string') return []
	return value.split(',').map((s) => s.trim()).filter((s) => s !== '').map((s) => s.toUpperCase())
}

function parseDate(value: LocationQueryValue | LocationQueryValue[] | undefined): Date | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
	const d = new Date(`${value}T00:00:00`)
	return Number.isNaN(d.getTime()) ? null : d
}

function formatDate(d: Date | null): string | undefined {
	if (!d) return undefined
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

// Push a new query, dropping the given keys when their staged value is empty.
// `query` carries the keys to set; `drop` carries keys to delete unconditionally.
function commit(updates: Record<string, string | undefined>) {
	const query: LocationQuery = { ...route.query }
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined || value === '') delete query[key]
		else query[key] = value
	}
	router.push({ name: 'flights', query })
}

function applyCabin() {
	commit({ cabin: [...stagedCabins.value].join(',') || undefined })
	editorOpen.value = false
}

function applyDate() {
	commit({
		dateFrom: formatDate(stagedDateFrom.value),
		dateTo: formatDate(stagedDateTo.value),
	})
	editorOpen.value = false
}

function applyAirline() {
	commit({ airline: [...stagedAirlines.value].join(',') || undefined })
	editorOpen.value = false
}

function applyAircraft() {
	commit({ aircraft: [...stagedAircraft.value].join(',') || undefined })
	editorOpen.value = false
}

// The two toggle filters commit straight from the menu — no editor to dismiss.
function applyUnmatched() {
	commit({ unmatched: '1' })
}

function applyMultiday() {
	commit({ multiday: '1' })
}

// NcCheckboxRadioSwitch emits update:modelValue; we manage staged state as a Set.
function toggleInSet(set: Set<string>, value: string, checked: boolean): Set<string> {
	const next = new Set(set)
	if (checked) next.add(value)
	else next.delete(value)
	return next
}

function toggleCabin(value: string, checked: boolean) {
	stagedCabins.value = toggleInSet(stagedCabins.value, value, checked)
}

function toggleAirline(value: string, checked: boolean) {
	stagedAirlines.value = toggleInSet(stagedAirlines.value, value, checked)
}

function toggleAircraft(value: string, checked: boolean) {
	stagedAircraft.value = toggleInSet(stagedAircraft.value, value, checked)
}

// Title shown above the popover editor.
const editorTitle = computed(() => {
	switch (editorType.value) {
	case 'date': return 'Date range'
	case 'cabin': return 'Cabin class'
	case 'airline': return 'Airline'
	case 'aircraft': return 'Aircraft type'
	default: return ''
	}
})
</script>

<template>
	<div ref="rootEl" class="filter-picker">
		<NcActions
			:force-menu="true"
			:open="menuOpen"
			menu-name="Add filter"
			@click="onTriggerClick"
			@update:open="menuOpen = $event">
			<template #icon>
				<Plus :size="20" />
			</template>
			<NcActionButton :close-after-click="true" @click="openEditor('date')">
				Date range
			</NcActionButton>
			<NcActionButton :close-after-click="true" @click="openEditor('cabin')">
				Cabin class
			</NcActionButton>
			<NcActionButton :close-after-click="true" @click="openEditor('airline')">
				Airline
			</NcActionButton>
			<NcActionButton :close-after-click="true" @click="openEditor('aircraft')">
				Aircraft type
			</NcActionButton>
			<NcActionSeparator v-if="showUnmatched || showMultiday" />
			<NcActionButton v-if="showUnmatched" :close-after-click="true" @click="applyUnmatched">
				Unmatched airports
			</NcActionButton>
			<NcActionButton v-if="showMultiday" :close-after-click="true" @click="applyMultiday">
				Days with multiple flights
			</NcActionButton>
		</NcActions>

		<div v-if="editorOpen" class="filter-popover">
			<div class="filter-popover__title">
				{{ editorTitle }}
			</div>

			<template v-if="editorType === 'date'">
				<label class="filter-popover__field">
					<span>From</span>
					<NcDateTimePickerNative
						v-model="stagedDateFrom"
						type="date" />
				</label>
				<label class="filter-popover__field">
					<span>To</span>
					<NcDateTimePickerNative
						v-model="stagedDateTo"
						type="date" />
				</label>
				<div class="filter-popover__actions">
					<NcButton @click="cancelEditor">
						Cancel
					</NcButton>
					<NcButton variant="primary" @click="applyDate">
						Apply
					</NcButton>
				</div>
			</template>

			<template v-else-if="editorType === 'cabin'">
				<NcCheckboxRadioSwitch
					v-for="c in CABIN_CLASSES"
					:key="c.value"
					:model-value="stagedCabins.has(c.value)"
					@update:model-value="(v: boolean) => toggleCabin(c.value, v)">
					{{ c.label }}
				</NcCheckboxRadioSwitch>
				<div class="filter-popover__actions">
					<NcButton @click="cancelEditor">
						Cancel
					</NcButton>
					<NcButton variant="primary" @click="applyCabin">
						Apply
					</NcButton>
				</div>
			</template>

			<template v-else-if="editorType === 'airline'">
				<NcTextField
					:model-value="airlineSearch"
					label="Search"
					placeholder="Search airlines"
					@update:model-value="airlineSearch = String($event)" />
				<div class="filter-popover__list">
					<div v-if="filteredAirlineOptions.length === 0" class="filter-popover__empty">
						No airlines match the search.
					</div>
					<NcCheckboxRadioSwitch
						v-for="code in filteredAirlineOptions"
						:key="code"
						:model-value="stagedAirlines.has(code)"
						@update:model-value="(v: boolean) => toggleAirline(code, v)">
						{{ code }}
					</NcCheckboxRadioSwitch>
				</div>
				<div class="filter-popover__actions">
					<NcButton @click="cancelEditor">
						Cancel
					</NcButton>
					<NcButton variant="primary" @click="applyAirline">
						Apply
					</NcButton>
				</div>
			</template>

			<template v-else-if="editorType === 'aircraft'">
				<NcTextField
					:model-value="aircraftSearch"
					label="Search"
					placeholder="Search aircraft types"
					@update:model-value="aircraftSearch = String($event)" />
				<div class="filter-popover__list">
					<div v-if="filteredAircraftOptions.length === 0" class="filter-popover__empty">
						No aircraft types match the search.
					</div>
					<NcCheckboxRadioSwitch
						v-for="code in filteredAircraftOptions"
						:key="code"
						:model-value="stagedAircraft.has(code)"
						@update:model-value="(v: boolean) => toggleAircraft(code, v)">
						{{ code }}
					</NcCheckboxRadioSwitch>
				</div>
				<div class="filter-popover__actions">
					<NcButton @click="cancelEditor">
						Cancel
					</NcButton>
					<NcButton variant="primary" @click="applyAircraft">
						Apply
					</NcButton>
				</div>
			</template>
		</div>
	</div>
</template>

<style scoped>
.filter-picker {
	position: relative;
	display: inline-block;
}

.filter-popover {
	position: absolute;
	top: calc(100% + 6px);
	left: 0;
	z-index: 1000;
	padding: 12px;
	min-width: 260px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	background: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 12px);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.filter-popover__title {
	font-weight: bold;
}

.filter-popover__field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.filter-popover__field > span {
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.filter-popover__list {
	max-height: 240px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
}

.filter-popover__empty {
	color: var(--color-text-maxcontrast);
	padding: 4px 0;
}

.filter-popover__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 4px;
}
</style>
