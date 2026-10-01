<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import AircraftTypeField from './AircraftTypeField.vue'
import AirportResolution from './AirportResolution.vue'
import {
	CABIN_CLASSES, aircraftDisplay,
	type AircraftSelection, type BulkChanges, type Flight, type ResolutionKind,
} from '../types.ts'

/**
 * Apply one set of changes to every selected flight.
 *
 * Each field is opt-in: a switch per field decides whether it is sent at all.
 * That keeps "leave alone" (switch off) distinct from "clear" (switch on, value
 * empty) — a blank is a legitimate value for every one of these fields, so a
 * single "mixed values" placeholder could not tell the two apart.
 *
 * Aircraft type is the one compound field, with two ways in (as in the editor):
 *
 *  - **A pick** sends only the reference triple. Each flight keeps its *own*
 *    typed text — that text is the record of what was entered, and keeping it
 *    is what makes "fix every leg that says X" repeatable. What was typed here
 *    was only a search.
 *  - **Free text** sets that text on every flight, and the server reconciles
 *    each one. Empty clears the aircraft entirely.
 *
 * Origin and destination are required on every flight, so they can be replaced
 * but not cleared. A new label is resolved per flight on the server, and one
 * that matches nothing clears the airport code and distance — routine for a
 * single edit, but at bulk scale the dialog previews the match and says how
 * many flights would lose their code before you apply.
 */

const props = defineProps<{
	open: boolean
	/** The selected flights; every change is applied to all of them. */
	flights: Flight[]
}>()

const emit = defineEmits<{
	'update:open': [value: boolean]
	saved: []
}>()

// Fields that map one-to-one onto a BulkChanges key.
type AirportKey = 'originLabel' | 'destinationLabel'
type SimpleKey = AirportKey | 'cabinClass' | 'airlineCode' | 'flightNumber' | 'registration'
type FieldKey = SimpleKey | 'aircraft'

const isAirport = (key: FieldKey): key is AirportKey => key === 'originLabel' || key === 'destinationLabel'
const CODE_KEY = { originLabel: 'originCode', destinationLabel: 'destinationCode' } as const

interface FieldDef {
	key: FieldKey
	label: string
	/** How a flight's current value reads in the "Currently" summary. */
	display: (f: Flight) => string | null
}

const cabinLabels: Record<string, string> = Object.fromEntries(
	CABIN_CLASSES.map((c) => [c.value, c.label]),
)

// In the flight editor's order. Airports read code-first, as the Route column does.
const FIELDS: FieldDef[] = [
	{ key: 'originLabel', label: 'Origin', display: (f) => f.originCode || f.originLabel },
	{ key: 'destinationLabel', label: 'Destination', display: (f) => f.destinationCode || f.destinationLabel },
	{ key: 'airlineCode', label: 'Airline code', display: (f) => f.airlineCode },
	{ key: 'flightNumber', label: 'Flight number', display: (f) => f.flightNumber },
	// The Aircraft column's own display, so the summary names types as the log does.
	{ key: 'aircraft', label: 'Aircraft type', display: aircraftDisplay },
	{ key: 'registration', label: 'Registration', display: (f) => f.registration },
	{ key: 'cabinClass', label: 'Cabin class', display: (f) => f.cabinClass ? cabinLabels[f.cabinClass] ?? f.cabinClass : null },
]

// How many distinct current values to list before summarising the rest.
const SUMMARY_LIMIT = 3

const store = useFlightsStore()
const saving = ref(false)

const blankState = (): Record<SimpleKey, string | null> => ({
	originLabel: null, destinationLabel: null, cabinClass: null, airlineCode: null, flightNumber: null, registration: null,
})
const enabled = reactive(Object.fromEntries(FIELDS.map((f) => [f.key, false])) as Record<FieldKey, boolean>)
const values = reactive<Record<SimpleKey, string | null>>(blankState())
const aircraftRaw = ref<string | null>(null)
const aircraftSelection = ref<AircraftSelection | null>(null)
// What each airport field's preview line reports, for the code-loss warning.
const airportKind = reactive<Record<AirportKey, ResolutionKind>>({ originLabel: 'idle', destinationLabel: 'idle' })

watch(() => props.open, (isOpen) => {
	if (!isOpen) return
	for (const field of FIELDS) enabled[field.key] = false
	Object.assign(values, blankState())
	aircraftRaw.value = null
	aircraftSelection.value = null
	airportKind.originLabel = 'idle'
	airportKind.destinationLabel = 'idle'
})

const cabinOptions = CABIN_CLASSES.map((c) => ({ id: c.value, label: c.label }))
const cabinSelection = computed({
	get: () => cabinOptions.find((o) => o.id === values.cabinClass) ?? null,
	set: (option: { id: string; label: string } | null) => { values.cabinClass = option?.id ?? null },
})

const plural = (n: number) => `${n} flight${n === 1 ? '' : 's'}`

/**
 * "Economy ×3, Business ×2" — what the selection holds now, most common first,
 * so the user can see what they are about to overwrite.
 *
 * @param {FieldDef} field The field to summarise.
 */
function currentSummary(field: FieldDef): string {
	const counts = new Map<string, number>()
	for (const f of props.flights) {
		const value = field.display(f) ?? '(empty)'
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	const entries = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
	const shown = entries.slice(0, SUMMARY_LIMIT).map(([value, n]) => `${value} ×${n}`)
	const rest = entries.length - SUMMARY_LIMIT
	if (rest > 0) shown.push(`${rest} other value${rest === 1 ? '' : 's'}`)
	return `Currently: ${shown.join(', ')}`
}

function aircraftChanges(): BulkChanges {
	const pick = aircraftSelection.value
	if (pick) {
		// No aircraftTypeRaw: each flight keeps its own typed text.
		return { aircraftTypeCode: pick.code, aircraftManufacturer: pick.manufacturer, aircraftModel: pick.model }
	}
	return { aircraftTypeRaw: aircraftRaw.value?.trim() || null }
}

const changes = computed<BulkChanges>(() => {
	const result: BulkChanges = {}
	for (const field of FIELDS) {
		if (!enabled[field.key]) continue
		if (field.key === 'aircraft') Object.assign(result, aircraftChanges())
		else result[field.key] = values[field.key]?.trim() || null
	}
	return result
})

/**
 * What applying a switched-on field will do. Aircraft says which of its two
 * paths is active, since a pick and the same words typed behave differently.
 *
 * @param {FieldDef} field The switched-on field.
 */
function hint(field: FieldDef): string {
	const all = `all ${plural(props.flights.length)}`
	if (field.key === 'aircraft') {
		if (aircraftSelection.value) return `Sets this type on ${all}. Each keeps its own typed text.`
		if (aircraftRaw.value?.trim()) return `Replaces the typed text on ${all}, then matches each against the reference data.`
		return `Leave empty to clear the aircraft on ${all}.`
	}
	if (isAirport(field.key)) {
		return `Replaces the ${field.label.toLowerCase()} on ${all}. Required, so it can be changed but not cleared.`
	}
	return `Leave empty to clear it on ${all}.`
}

/**
 * How many selected flights would lose their airport code (and so their
 * distance) if this unresolvable text were applied. A flight whose stored label
 * already equals the new text is not counted: the server treats that side as
 * unchanged and keeps its code.
 *
 * @param {AirportKey} key The airport field.
 */
function codeLossCount(key: AirportKey): number {
	const text = values[key]?.trim() ?? ''
	return props.flights.filter((f) => f[CODE_KEY[key]] !== null && (f[key] ?? '').trim() !== text).length
}

function codeLossWarning(field: FieldDef): string | null {
	if (!isAirport(field.key)) return null
	const kind = airportKind[field.key]
	if (kind !== 'unmatched' && kind !== 'noReference') return null
	const n = codeLossCount(field.key)
	if (n === 0) return null
	const subject = n === props.flights.length ? `All ${plural(n)}` : `${n} of ${plural(props.flights.length)}`
	return `${subject} will lose their ${field.label.toLowerCase()} airport code and distance.`
}

const hasChanges = computed(() => Object.keys(changes.value).length > 0)
// The server rejects clearing a required field; say so here rather than after.
const missingRequired = computed(() => FIELDS.some((f) => isAirport(f.key) && enabled[f.key] && !values[f.key]?.trim()))
const canApply = computed(() => hasChanges.value && !missingRequired.value)

function close() {
	emit('update:open', false)
}

function errorMessage(e: unknown): string {
	const ocs = (e as { response?: { data?: { ocs?: { meta?: { message?: string }; data?: { message?: string } } } } })
		?.response?.data?.ocs
	return ocs?.data?.message || ocs?.meta?.message || 'Failed to update flights'
}

async function apply() {
	if (!canApply.value) return
	saving.value = true
	try {
		const updated = await store.bulkUpdate(props.flights.map((f) => f.id), changes.value)
		showSuccess(`Updated ${plural(updated.length)}`)
		emit('saved')
		close()
	} catch (e: unknown) {
		showError(errorMessage(e))
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<NcDialog
		:open="props.open"
		:name="`Edit ${plural(props.flights.length)}`"
		size="normal"
		@update:open="emit('update:open', $event)">
		<div class="bulk-edit-form">
			<p class="intro">
				Switch on each field to change. Fields left off keep their current value on every flight.
			</p>
			<div v-for="field in FIELDS"
				:key="field.key"
				class="field"
				:data-field="field.key">
				<NcCheckboxRadioSwitch
					type="switch"
					:model-value="enabled[field.key]"
					@update:model-value="enabled[field.key] = $event">
					{{ field.label }}
				</NcCheckboxRadioSwitch>
				<p class="current">
					{{ currentSummary(field) }}
				</p>
				<template v-if="enabled[field.key]">
					<AircraftTypeField
						v-if="field.key === 'aircraft'"
						:raw="aircraftRaw"
						:selection="aircraftSelection"
						@update:raw="aircraftRaw = $event"
						@update:selection="aircraftSelection = $event" />
					<NcSelect
						v-else-if="field.key === 'cabinClass'"
						v-model="cabinSelection"
						:input-label="`New ${field.label.toLowerCase()}`"
						:options="cabinOptions"
						:clearable="true"
						label="label" />
					<NcTextField
						v-else
						:label="`New ${field.label.toLowerCase()}`"
						:model-value="values[field.key as SimpleKey] ?? ''"
						@update:model-value="(v: string | number) => values[field.key as SimpleKey] = String(v) || null" />
					<AirportResolution
						v-if="isAirport(field.key)"
						:label="values[field.key]"
						@update:kind="airportKind[field.key as AirportKey] = $event" />
					<p class="hint">
						{{ hint(field) }}
					</p>
					<NcNoteCard v-if="codeLossWarning(field)" type="warning" class="code-loss">
						{{ codeLossWarning(field) }}
					</NcNoteCard>
				</template>
			</div>
		</div>
		<template #actions>
			<NcButton variant="tertiary" @click="close">
				Cancel
			</NcButton>
			<NcButton variant="primary" :disabled="saving || !canApply" @click="apply">
				Apply to {{ plural(props.flights.length) }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.bulk-edit-form {
	padding: 8px 4px;
}

.intro {
	margin-bottom: 12px;
	color: var(--color-text-maxcontrast);
}

.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-bottom: 16px;
}

.current,
.hint {
	color: var(--color-text-maxcontrast);
	font-size: var(--font-size-small, 13px);
	margin-inline-start: 4px;
}

.current {
	/* A long registration list must not stretch the dialog. */
	overflow-wrap: anywhere;
}

.code-loss {
	margin: 4px 0 0;
}
</style>
