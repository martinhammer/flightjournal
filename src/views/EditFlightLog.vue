<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import { showError, showSuccess, showWarning } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { CABIN_CLASSES, type FlightInput } from '../types.ts'

const route = useRoute()
const router = useRouter()
const store = useFlightsStore()

const flightId = computed(() => {
	const id = route.params.id
	return typeof id === 'string' && id ? Number(id) : null
})

const blank = (): FlightInput => ({
	flightDate: new Date().toISOString().slice(0, 10),
	originCode: null,
	destinationCode: null,
	originLabel: null,
	destinationLabel: null,
	airlineCode: null,
	flightNumber: null,
	aircraftTypeCode: null,
	aircraftTypeRaw: null,
	registration: null,
	cabinClass: null,
	seat: null,
	notes: null,
})

const form = reactive<FlightInput>(blank())
const saving = ref(false)
const loaded = ref(false)

const cabinOptions = CABIN_CLASSES.map((c) => ({ id: c.value, label: c.label }))
const cabinSelection = ref<{ id: string; label: string } | null>(null)

watch(cabinSelection, (v) => { form.cabinClass = v?.id ?? null })

async function load() {
	if (!flightId.value) {
		showError('Flight not found')
		backToFlights()
		return
	}
	if (!store.loaded) await store.fetchAll()
	const existing = store.flights.find((f) => f.id === flightId.value)
	if (!existing) {
		showError('Flight not found')
		backToFlights()
		return
	}
	Object.assign(form, {
		flightDate: existing.flightDate,
		originCode: existing.originCode,
		destinationCode: existing.destinationCode,
		originLabel: existing.originLabel,
		destinationLabel: existing.destinationLabel,
		airlineCode: existing.airlineCode,
		flightNumber: existing.flightNumber,
		aircraftTypeCode: existing.aircraftTypeCode,
		aircraftTypeRaw: existing.aircraftTypeRaw,
		registration: existing.registration,
		cabinClass: existing.cabinClass,
		seat: existing.seat,
		notes: existing.notes,
	})
	cabinSelection.value = cabinOptions.find((c) => c.id === existing.cabinClass) ?? null
	loaded.value = true
}

onMounted(load)
watch(flightId, load)

const dateModel = computed<Date>({
	get: () => form.flightDate ? new Date(form.flightDate + 'T00:00:00') : new Date(),
	set: (d: Date) => {
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		form.flightDate = `${yyyy}-${mm}-${dd}`
	},
})

function validate(): string | null {
	const missing: string[] = []
	if (!form.flightDate) missing.push('date')
	if (!form.originLabel) missing.push('origin')
	if (!form.destinationLabel) missing.push('destination')
	if (missing.length === 0) return null
	if (missing.length === 1) {
		return `Please enter the flight ${missing[0]}.`
	}
	const last = missing.pop()
	return `Please enter the flight ${missing.join(', ')} and ${last}.`
}

async function save() {
	if (!flightId.value) return
	const error = validate()
	if (error) {
		showWarning(error)
		return
	}
	saving.value = true
	try {
		await store.update(flightId.value, form)
		showSuccess('Flight updated')
		backToFlights()
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Failed to save flight'
		showError(message)
	} finally {
		saving.value = false
	}
}

// Return to the Flights view, preserving any active filter carried in the query.
function backToFlights() {
	router.push({ path: '/flights', query: route.query })
}

function cancel() {
	backToFlights()
}
</script>

<template>
	<div class="edit-flight">
		<h2>Edit flight</h2>
		<form v-if="loaded" @submit.prevent="save">
			<div class="row">
				<NcDateTimePickerNative v-model="dateModel" type="date" label="Flight date" />
			</div>
			<div class="row two">
				<NcTextField label="Origin" :model-value="form.originLabel ?? ''" @update:model-value="(v: string | number) => form.originLabel = String(v) || null" />
				<NcTextField label="Destination" :model-value="form.destinationLabel ?? ''" @update:model-value="(v: string | number) => form.destinationLabel = String(v) || null" />
			</div>
			<div class="row two">
				<NcTextField label="Airline code" :model-value="form.airlineCode ?? ''" @update:model-value="(v: string | number) => form.airlineCode = String(v) || null" />
				<NcTextField label="Flight number" :model-value="form.flightNumber ?? ''" @update:model-value="(v: string | number) => form.flightNumber = String(v) || null" />
			</div>
			<div class="row two">
				<NcTextField label="Aircraft type" :model-value="form.aircraftTypeRaw ?? ''" @update:model-value="(v: string | number) => form.aircraftTypeRaw = String(v) || null" />
				<NcTextField label="Registration" :model-value="form.registration ?? ''" @update:model-value="(v: string | number) => form.registration = String(v) || null" />
			</div>
			<div class="row half">
				<NcSelect v-model="cabinSelection"
					input-label="Cabin class"
					:options="cabinOptions"
					:clearable="true"
					label="label" />
			</div>
			<div class="row half">
				<NcTextField label="Seat" :model-value="form.seat ?? ''" @update:model-value="(v: string | number) => form.seat = String(v) || null" />
			</div>
			<div class="row">
				<label>Notes</label>
				<textarea v-model="form.notes" rows="3" />
			</div>
			<div class="actions">
				<NcButton variant="primary" type="submit" :disabled="saving">
					Save
				</NcButton>
				<NcButton @click="cancel">
					Cancel
				</NcButton>
			</div>
		</form>
	</div>
</template>

<style scoped>
.edit-flight {
	padding: 16px;
	max-width: 720px;
}

.row {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-bottom: 12px;
}

.row.two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
	align-items: end;
}

.row.half {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}

.row.half > * {
	grid-column: 1;
}

textarea {
	width: 100%;
	padding: 8px;
	border-radius: var(--border-radius);
	border: 1px solid var(--color-border);
	background: var(--color-main-background);
	color: var(--color-main-text);
}

.actions {
	display: flex;
	gap: 8px;
	margin-top: 16px;
}
</style>
