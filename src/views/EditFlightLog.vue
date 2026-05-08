<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { CABIN_CLASSES, type FlightInput } from '../types.ts'

const route = useRoute()
const router = useRouter()
const store = useFlightsStore()

const editingId = computed(() => {
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

const cabinOptions = CABIN_CLASSES.map((c) => ({ id: c.value, label: c.label }))
const cabinSelection = ref<{ id: string; label: string } | null>(null)

watch(cabinSelection, (v) => { form.cabinClass = v?.id ?? null })

async function load() {
	if (!editingId.value) {
		Object.assign(form, blank())
		cabinSelection.value = null
		return
	}
	if (!store.loaded) await store.fetchAll()
	const existing = store.flights.find((f) => f.id === editingId.value)
	if (!existing) {
		showError('Flight not found')
		router.push('/view')
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
}

onMounted(load)
watch(editingId, load)

const dateModel = computed<Date>({
	get: () => form.flightDate ? new Date(form.flightDate + 'T00:00:00') : new Date(),
	set: (d: Date) => {
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		form.flightDate = `${yyyy}-${mm}-${dd}`
	},
})

async function save() {
	saving.value = true
	try {
		if (editingId.value) {
			await store.update(editingId.value, form)
			showSuccess('Flight updated')
		} else {
			await store.create(form)
			showSuccess('Flight added')
		}
		router.push('/view')
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Failed to save flight'
		showError(message)
	} finally {
		saving.value = false
	}
}

function cancel() {
	router.push('/view')
}
</script>

<template>
	<div class="edit-flight">
		<h2>{{ editingId ? 'Edit flight' : 'Add flight' }}</h2>
		<form @submit.prevent="save">
			<div class="row">
				<label>Date *</label>
				<NcDateTimePickerNative v-model="dateModel" type="date" />
			</div>
			<div class="row two">
				<NcTextField label="Origin code (IATA/ICAO)" :value="form.originCode ?? ''" @update:value="(v: string) => form.originCode = v || null" />
				<NcTextField label="Origin label (if no code)" :value="form.originLabel ?? ''" @update:value="(v: string) => form.originLabel = v || null" />
			</div>
			<div class="row two">
				<NcTextField label="Destination code (IATA/ICAO)" :value="form.destinationCode ?? ''" @update:value="(v: string) => form.destinationCode = v || null" />
				<NcTextField label="Destination label (if no code)" :value="form.destinationLabel ?? ''" @update:value="(v: string) => form.destinationLabel = v || null" />
			</div>
			<div class="row two">
				<NcTextField label="Airline code" :value="form.airlineCode ?? ''" @update:value="(v: string) => form.airlineCode = v || null" />
				<NcTextField label="Flight number" :value="form.flightNumber ?? ''" @update:value="(v: string) => form.flightNumber = v || null" />
			</div>
			<div class="row two">
				<NcTextField label="Aircraft type (raw)" :value="form.aircraftTypeRaw ?? ''" @update:value="(v: string) => form.aircraftTypeRaw = v || null" />
				<NcTextField label="Registration" :value="form.registration ?? ''" @update:value="(v: string) => form.registration = v || null" />
			</div>
			<div class="row two">
				<div>
					<label>Cabin class</label>
					<NcSelect v-model="cabinSelection"
						:options="cabinOptions"
						:clearable="true"
						label="label" />
				</div>
				<NcTextField label="Seat" :value="form.seat ?? ''" @update:value="(v: string) => form.seat = v || null" />
			</div>
			<div class="row">
				<label>Notes</label>
				<textarea v-model="form.notes" rows="3" />
			</div>
			<div class="actions">
				<NcButton type="primary" native-type="submit" :disabled="saving">
					{{ editingId ? 'Save' : 'Add' }}
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
