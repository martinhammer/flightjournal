import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { showError, showSuccess } from '@nextcloud/dialogs'

// Covers the opt-in contract: only switched-on fields are sent, a switched-on
// empty field clears, and a switched-off one is never mentioned.

const { store } = vi.hoisted(() => ({
	store: { bulkUpdate: vi.fn() },
}))

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))

import BulkEditDialog from '../../src/components/BulkEditDialog.vue'

function flight(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		flightDate: `2026-01-0${id}`,
		daySeq: 1,
		originCode: 'LHR',
		destinationCode: 'JFK',
		originLabel: 'London Heathrow',
		destinationLabel: 'New York JFK',
		airlineCode: null,
		flightNumber: null,
		aircraftTypeCode: null,
		aircraftTypeRaw: null,
		aircraftManufacturer: null,
		aircraftModel: null,
		registration: null,
		cabinClass: null,
		seat: null,
		notes: null,
		distanceKm: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}
}

const NcDialog = {
	props: ['open', 'name'],
	template: '<div v-if="open" class="dialog"><h2 class="dialog-name">{{ name }}</h2><slot /><slot name="actions" /></div>',
}

const NcCheckboxRadioSwitch = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<label class="switch"><input type="checkbox" :checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></label>',
}

const NcTextField = {
	props: ['modelValue', 'label'],
	emits: ['update:modelValue'],
	template: '<input class="text-field" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
}

// Picks by option id, emitting the option object as the real NcSelect does.
const NcSelect = {
	props: ['modelValue', 'options'],
	emits: ['update:modelValue'],
	template: `<select class="select" @change="$emit('update:modelValue', options.find((o) => o.id === $event.target.value) ?? null)">
		<option value="" />
		<option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
	</select>`,
}

const NcButton = {
	props: ['disabled', 'variant'],
	emits: ['click'],
	template: '<button class="nc-button" :class="variant" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

// Has its own spec. Typing emits update:raw; a test emits update:selection to pick.
const AircraftTypeField = {
	name: 'AircraftTypeField',
	props: ['raw', 'selection'],
	emits: ['update:raw', 'update:selection'],
	template: '<input class="aircraft-field" :value="raw ?? \'\'" @input="$emit(\'update:raw\', $event.target.value || null)">',
}

// Has its own spec. A test emits update:kind to stand in for a settled lookup.
const AirportResolution = {
	name: 'AirportResolution',
	props: ['label'],
	emits: ['update:kind'],
	template: '<p class="airport-resolution" />',
}

const NcNoteCard = { props: ['type'], template: '<div class="note-card"><slot /></div>' }

const stubs = {
	NcDialog, NcCheckboxRadioSwitch, NcTextField, NcSelect, NcButton, NcNoteCard, AircraftTypeField, AirportResolution,
}

const selection = [
	flight(1, { cabinClass: 'economy', registration: 'A6-EAA' }),
	flight(2, { cabinClass: 'economy', registration: 'A6-EAB' }),
	flight(3, { cabinClass: 'business', registration: 'A6-EAC' }),
]

async function mountOpen(flights = selection) {
	// Mounted closed, then opened, so the reset-on-open watcher runs as in the app.
	const wrapper = mount(BulkEditDialog, { props: { open: false, flights }, global: { stubs } })
	await wrapper.setProps({ open: true })
	return wrapper
}

const field = (wrapper: Awaited<ReturnType<typeof mountOpen>>, key: string) => wrapper.find(`[data-field="${key}"]`)
const applyButton = (wrapper: Awaited<ReturnType<typeof mountOpen>>) => wrapper.find('.nc-button.primary')

beforeEach(() => {
	store.bulkUpdate.mockReset()
	store.bulkUpdate.mockImplementation(async (ids: number[]) => ids.map((id) => flight(id)))
	vi.mocked(showError).mockClear()
	vi.mocked(showSuccess).mockClear()
})

describe('BulkEditDialog', () => {
	it('names the dialog and the apply button after the selection size', async () => {
		const wrapper = await mountOpen()
		expect(wrapper.find('.dialog-name').text()).toBe('Edit 3 flights')
		expect(applyButton(wrapper).text()).toBe('Apply to 3 flights')
	})

	it('disables Apply until a field is switched on', async () => {
		const wrapper = await mountOpen()
		expect(applyButton(wrapper).attributes('disabled')).toBeDefined()
		await field(wrapper, 'cabinClass').find('.switch input').trigger('click')
		expect(applyButton(wrapper).attributes('disabled')).toBeUndefined()
	})

	it('summarises the current values, most common first', async () => {
		const wrapper = await mountOpen()
		expect(field(wrapper, 'cabinClass').find('.current').text()).toBe('Currently: Economy ×2, Business ×1')
		expect(field(wrapper, 'airlineCode').find('.current').text()).toBe('Currently: (empty) ×3')
	})

	it('caps the summary and counts the remaining values', async () => {
		const wrapper = await mountOpen([1, 2, 3, 4, 5].map((id) => flight(id, { registration: `REG-${id}` })))
		expect(field(wrapper, 'registration').find('.current').text())
			.toBe('Currently: REG-1 ×1, REG-2 ×1, REG-3 ×1, 2 other values')
	})

	it('reveals an editor only for a switched-on field', async () => {
		const wrapper = await mountOpen()
		expect(field(wrapper, 'registration').find('.text-field').exists()).toBe(false)
		await field(wrapper, 'registration').find('.switch input').trigger('click')
		expect(field(wrapper, 'registration').find('.text-field').exists()).toBe(true)
	})

	it('sends the picked cabin class for every selected flight, then closes', async () => {
		const wrapper = await mountOpen()
		await field(wrapper, 'cabinClass').find('.switch input').trigger('click')
		await field(wrapper, 'cabinClass').find('select').setValue('business')
		await applyButton(wrapper).trigger('click')
		await flushPromises()

		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { cabinClass: 'business' })
		expect(showSuccess).toHaveBeenCalledWith('Updated 3 flights')
		expect(wrapper.emitted('saved')).toHaveLength(1)
		expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
	})

	it('clears a field that is switched on but left empty', async () => {
		const wrapper = await mountOpen()
		await field(wrapper, 'registration').find('.switch input').trigger('click')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { registration: null })
	})

	it('sends only switched-on fields, trimmed', async () => {
		const wrapper = await mountOpen()
		// Typed into, then switched off again: must not be sent.
		await field(wrapper, 'airlineCode').find('.switch input').trigger('click')
		await field(wrapper, 'airlineCode').find('.text-field').setValue('EY')
		await field(wrapper, 'airlineCode').find('.switch input').trigger('click')

		await field(wrapper, 'flightNumber').find('.switch input').trigger('click')
		await field(wrapper, 'flightNumber').find('.text-field').setValue('  449 ')
		await applyButton(wrapper).trigger('click')

		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { flightNumber: '449' })
	})

	it('shows the server message and stays open when the update fails', async () => {
		store.bulkUpdate.mockRejectedValue({
			response: { data: { ocs: { meta: { message: '' }, data: { message: 'Flight 9 not found' } } } },
		})
		const wrapper = await mountOpen()
		await field(wrapper, 'cabinClass').find('.switch input').trigger('click')
		await applyButton(wrapper).trigger('click')
		await flushPromises()

		expect(showError).toHaveBeenCalledWith('Flight 9 not found')
		expect(wrapper.emitted('saved')).toBeUndefined()
		expect(wrapper.emitted('update:open')).toBeUndefined()
	})

	it('starts from a clean slate each time it opens', async () => {
		const wrapper = await mountOpen()
		await field(wrapper, 'registration').find('.switch input').trigger('click')
		await field(wrapper, 'registration').find('.text-field').setValue('A6-XYZ')

		await wrapper.setProps({ open: false })
		await wrapper.setProps({ open: true })

		expect(field(wrapper, 'registration').find('.text-field').exists()).toBe(false)
		expect(applyButton(wrapper).attributes('disabled')).toBeDefined()
	})
})

describe('BulkEditDialog aircraft type', () => {
	const b738 = { code: 'B738', manufacturer: 'BOEING', model: '737-800' }

	async function openAircraft(flights = selection) {
		const wrapper = await mountOpen(flights)
		await field(wrapper, 'aircraft').find('.switch input').trigger('click')
		return wrapper
	}

	const pick = async (wrapper: Awaited<ReturnType<typeof mountOpen>>, value: typeof b738 | null) => {
		wrapper.findComponent({ name: 'AircraftTypeField' }).vm.$emit('update:selection', value)
		await wrapper.vm.$nextTick()
	}

	it('summarises the types as the Aircraft column names them', async () => {
		const wrapper = await mountOpen([
			flight(1, { aircraftTypeRaw: '738', aircraftTypeCode: 'B738', aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
			flight(2, { aircraftTypeRaw: 'B737-800', aircraftTypeCode: 'B738', aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
			flight(3, { aircraftTypeRaw: 'mystery jet' }),
		])
		expect(field(wrapper, 'aircraft').find('.current').text())
			.toBe('Currently: BOEING 737-800 ×2, mystery jet ×1')
	})

	it('sends a pick as the reference triple only, so each flight keeps its typed text', async () => {
		const wrapper = await openAircraft()
		// Typed to search, then picked: the search text must not be sent.
		await field(wrapper, 'aircraft').find('.aircraft-field').setValue('737')
		await pick(wrapper, b738)
		await applyButton(wrapper).trigger('click')

		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], {
			aircraftTypeCode: 'B738',
			aircraftManufacturer: 'BOEING',
			aircraftModel: '737-800',
		})
	})

	it('sends free text as the typed text for the server to reconcile', async () => {
		const wrapper = await openAircraft()
		await field(wrapper, 'aircraft').find('.aircraft-field').setValue(' B77W ')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { aircraftTypeRaw: 'B77W' })
	})

	it('clears the aircraft when switched on and left empty', async () => {
		const wrapper = await openAircraft()
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { aircraftTypeRaw: null })
	})

	it('falls back to the typed text once a pick is cleared', async () => {
		const wrapper = await openAircraft()
		await field(wrapper, 'aircraft').find('.aircraft-field').setValue('B738')
		await pick(wrapper, b738)
		await pick(wrapper, null)
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { aircraftTypeRaw: 'B738' })
	})

	it('explains which of the two paths applying will take', async () => {
		const wrapper = await openAircraft()
		const hint = () => field(wrapper, 'aircraft').find('.hint').text()
		expect(hint()).toBe('Leave empty to clear the aircraft on all 3 flights.')

		await field(wrapper, 'aircraft').find('.aircraft-field').setValue('B738')
		expect(hint()).toBe('Replaces the typed text on all 3 flights, then matches each against the reference data.')

		await pick(wrapper, b738)
		expect(hint()).toBe('Sets this type on all 3 flights. Each keeps its own typed text.')
	})

	it('combines with other switched-on fields in one request', async () => {
		const wrapper = await openAircraft()
		await pick(wrapper, b738)
		await field(wrapper, 'cabinClass').find('.switch input').trigger('click')
		await field(wrapper, 'cabinClass').find('select').setValue('first')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], {
			cabinClass: 'first',
			aircraftTypeCode: 'B738',
			aircraftManufacturer: 'BOEING',
			aircraftModel: '737-800',
		})
	})

	it('forgets a pick when reopened', async () => {
		const wrapper = await openAircraft()
		await pick(wrapper, b738)
		await wrapper.setProps({ open: false })
		await wrapper.setProps({ open: true })
		await field(wrapper, 'aircraft').find('.switch input').trigger('click')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { aircraftTypeRaw: null })
	})
})

describe('BulkEditDialog origin and destination', () => {
	async function openOrigin(flights = selection) {
		const wrapper = await mountOpen(flights)
		await field(wrapper, 'originLabel').find('.switch input').trigger('click')
		return wrapper
	}

	const typeOrigin = (wrapper: Awaited<ReturnType<typeof mountOpen>>, text: string) =>
		field(wrapper, 'originLabel').find('.text-field').setValue(text)

	/** Stand in for the preview line settling on a result. */
	async function resolvesAs(wrapper: Awaited<ReturnType<typeof mountOpen>>, kind: string) {
		field(wrapper, 'originLabel').findComponent({ name: 'AirportResolution' }).vm.$emit('update:kind', kind)
		await wrapper.vm.$nextTick()
	}

	const warning = (wrapper: Awaited<ReturnType<typeof mountOpen>>) => field(wrapper, 'originLabel').find('.note-card')

	it('summarises the current route endpoint code-first, as the Route column does', async () => {
		const wrapper = await mountOpen([
			flight(1),
			flight(2, { originCode: null, originLabel: 'Dublin' }),
		])
		expect(field(wrapper, 'originLabel').find('.current').text()).toBe('Currently: Dublin ×1, LHR ×1')
	})

	it('sends the new origin, trimmed, for every flight', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, ' DUB ')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { originLabel: 'DUB' })
	})

	it('previews the text as typed', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'DUB')
		expect(field(wrapper, 'originLabel').findComponent({ name: 'AirportResolution' }).props('label')).toBe('DUB')
	})

	it('refuses to clear a required endpoint', async () => {
		const wrapper = await openOrigin()
		expect(applyButton(wrapper).attributes('disabled')).toBeDefined()
		expect(field(wrapper, 'originLabel').find('.hint').text()).toContain('can be changed but not cleared')

		// Another field switched on doesn't make the empty origin acceptable.
		await field(wrapper, 'registration').find('.switch input').trigger('click')
		expect(applyButton(wrapper).attributes('disabled')).toBeDefined()

		await typeOrigin(wrapper, 'DUB')
		expect(applyButton(wrapper).attributes('disabled')).toBeUndefined()
	})

	it('warns how many flights lose their code when the text matches nothing', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'Nowhere')
		await resolvesAs(wrapper, 'unmatched')
		expect(warning(wrapper).text()).toBe('All 3 flights will lose their origin airport code and distance.')
	})

	it('also warns when there is no airport reference data to match against', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'LHR')
		await resolvesAs(wrapper, 'noReference')
		expect(warning(wrapper).exists()).toBe(true)
	})

	/**
	 * Only flights that have a code can lose one, and a flight whose stored
	 * label already equals the new text keeps its code (the server treats that
	 * side as unchanged) — so neither counts.
	 */
	it('counts only the flights that would actually lose a code', async () => {
		const wrapper = await openOrigin([
			flight(1),
			flight(2, { originCode: null, originLabel: 'Somewhere' }),
			flight(3, { originCode: 'DUB', originLabel: 'Dublin' }),
		])
		await typeOrigin(wrapper, 'Dublin')
		await resolvesAs(wrapper, 'unmatched')
		expect(warning(wrapper).text()).toBe('1 of 3 flights will lose their origin airport code and distance.')
	})

	it('does not warn on a match, or while the lookup is pending', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'DUB')
		await resolvesAs(wrapper, 'checking')
		expect(warning(wrapper).exists()).toBe(false)
		await resolvesAs(wrapper, 'matched')
		expect(warning(wrapper).exists()).toBe(false)
	})

	it('warns without blocking: an unresolvable endpoint can still be applied', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'Nowhere')
		await resolvesAs(wrapper, 'unmatched')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { originLabel: 'Nowhere' })
	})

	it('changes both endpoints in one request', async () => {
		const wrapper = await openOrigin()
		await typeOrigin(wrapper, 'DUB')
		await field(wrapper, 'destinationLabel').find('.switch input').trigger('click')
		await field(wrapper, 'destinationLabel').find('.text-field').setValue('FRA')
		await applyButton(wrapper).trigger('click')
		expect(store.bulkUpdate).toHaveBeenCalledWith([1, 2, 3], { originLabel: 'DUB', destinationLabel: 'FRA' })
	})
})
