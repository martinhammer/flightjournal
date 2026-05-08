<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { showError, showSuccess, showWarning } from '@nextcloud/dialogs'
import { useFlightsStore } from '../store/flights.ts'
import { CABIN_CLASSES, type FlightInput } from '../types.ts'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{(e: 'update:open', value: boolean): void}>()

const store = useFlightsStore()
const saving = ref(false)

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
const cabinOptions = CABIN_CLASSES.map((c) => ({ id: c.value, label: c.label }))
const cabinSelection = ref<{ id: string; label: string } | null>(null)
watch(cabinSelection, (v) => { form.cabinClass = v?.id ?? null })

watch(() => props.open, (isOpen) => {
	if (isOpen) {
		Object.assign(form, blank())
		cabinSelection.value = null
	}
})

const dateModel = computed<Date>({
	get: () => form.flightDate ? new Date(form.flightDate + 'T00:00:00') : new Date(),
	set: (d: Date) => {
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		form.flightDate = `${yyyy}-${mm}-${dd}`
	},
})

function close() {
	emit('update:open', false)
}

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

async function add() {
	const error = validate()
	if (error) {
		showWarning(error)
		return
	}
	saving.value = true
	try {
		await store.create(form)
		showSuccess('Flight added')
		close()
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? 'Failed to save flight'
		showError(message)
	} finally {
		saving.value = false
	}
}

</script>

<template>
	<NcDialog
		:open="props.open"
		name="Add flight"
		size="normal"
		@update:open="emit('update:open', $event)">
		<div class="add-flight-form">
			<div class="row">
				<NcDateTimePickerNative v-model="dateModel" type="date" label="Flight date" />
			</div>
			<div class="row two">
				<NcTextField label="Origin" :model-value="form.originLabel ?? ''" @update:model-value="(v: string) => form.originLabel = v || null" />
				<NcTextField label="Destination" :model-value="form.destinationLabel ?? ''" @update:model-value="(v: string) => form.destinationLabel = v || null" />
			</div>
			<div class="row two">
				<NcTextField label="Airline code" :model-value="form.airlineCode ?? ''" @update:model-value="(v: string) => form.airlineCode = v || null" />
				<NcTextField label="Flight number" :model-value="form.flightNumber ?? ''" @update:model-value="(v: string) => form.flightNumber = v || null" />
			</div>
			<div class="row two">
				<NcTextField label="Aircraft type" :model-value="form.aircraftTypeRaw ?? ''" @update:model-value="(v: string) => form.aircraftTypeRaw = v || null" />
				<NcTextField label="Registration" :model-value="form.registration ?? ''" @update:model-value="(v: string) => form.registration = v || null" />
			</div>
			<div class="row half">
				<NcSelect v-model="cabinSelection"
					input-label="Cabin class"
					:options="cabinOptions"
					:clearable="true"
					label="label" />
			</div>
			<div class="row half">
				<NcTextField label="Seat" :model-value="form.seat ?? ''" @update:model-value="(v: string) => form.seat = v || null" />
			</div>
		</div>
		<template #actions>
			<NcButton variant="primary" :disabled="saving" @click="add">
				Add
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.add-flight-form {
	padding: 8px 4px;
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
</style>
