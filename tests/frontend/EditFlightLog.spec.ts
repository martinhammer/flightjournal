import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Catches the v8→v9 NcButton regression: the Save control relies on being a
// native submit button (the form submits via `@submit.prevent`, the button has
// no `@click`). v8's `native-type="submit"` is ignored by v9, which silently
// turned Save into a plain non-submitting button.

const { store, push } = vi.hoisted(() => ({
	store: {
		loaded: true,
		flights: [] as unknown[],
		fetchAll: vi.fn(),
		update: vi.fn().mockResolvedValue({}),
	},
	push: vi.fn(),
}))

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))

// AircraftTypeField mounts for real here (the aircraft wiring is what two of
// these tests cover), so its type-ahead lookup must not reach the real module.
const { listAircraftTypes } = vi.hoisted(() => ({ listAircraftTypes: vi.fn() }))
vi.mock('../../src/api.ts', () => ({
	listAircraftTypes,
	resolveAircraftType: vi.fn().mockResolvedValue({ match: null, referenceLoaded: false }),
}))

const b738 = {
	id: 1, icaoCode: 'B738', iataCode: null, manufacturer: 'BOEING', model: '737-800',
	modelNormalized: '737800', engineType: 'Jet', engineCount: 2, wtc: 'M',
	description: 'LandPlane', canonical: true, source: 'csv-upload', updatedAt: 0,
}
// Keep vue-router's real exports (NcButton injects `routerKey`); override only
// the composables the view uses.
vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => ({ params: { id: '1' }, query: {} }),
	useRouter: () => ({ push }),
}))

import EditFlightLog from '../../src/views/EditFlightLog.vue'

const flight = {
	id: 1,
	flightDate: '2026-05-01',
	originCode: 'CPH',
	destinationCode: 'LHR',
	originLabel: 'Copenhagen Kastrup',
	destinationLabel: 'London Heathrow',
	airlineCode: 'SK',
	flightNumber: '4745',
	aircraftTypeCode: null,
	aircraftTypeRaw: 'A320',
	registration: 'OY-KAL',
	cabinClass: 'economy',
	seat: '14C',
	notes: null,
	createdAt: 0,
	updatedAt: 0,
}

// Keep NcButton real — the regression is in how the button is configured.
const stubs = {
	NcTextField: true,
	NcSelect: true,
	NcDateTimePickerNative: true,
	// Has its own spec; stubbed here so it doesn't schedule a debounced lookup
	// against the real api module during these tests.
	AircraftResolution: true,
}

async function mountLoaded() {
	store.flights = [flight]
	const wrapper = mount(EditFlightLog, { global: { stubs } })
	await flushPromises()
	return wrapper
}

beforeEach(() => {
	store.update.mockClear()
	push.mockClear()
	listAircraftTypes.mockReset()
	listAircraftTypes.mockResolvedValue({ items: [b738], total: 1, limit: 8, offset: 0 })
})

describe('EditFlightLog save', () => {
	it('renders the Save control as a native submit button', async () => {
		const wrapper = await mountLoaded()
		const submit = wrapper.find('button[type="submit"]')
		expect(submit.exists()).toBe(true)
		expect(submit.text()).toBe('Save')
	})

	it('submitting the form persists via the store', async () => {
		const wrapper = await mountLoaded()
		await wrapper.find('form').trigger('submit')
		await flushPromises()
		expect(store.update).toHaveBeenCalledTimes(1)
		expect(store.update).toHaveBeenCalledWith(1, expect.objectContaining({
			originLabel: 'Copenhagen Kastrup',
			destinationLabel: 'London Heathrow',
			// Codes must not be round-tripped — they are reconciled server-side
			// from the (possibly edited) label.
			originCode: null,
			destinationCode: null,
		}))
	})

	/**
	 * The feedback line must follow the field as it is edited, not the value the
	 * flight was loaded with — otherwise it keeps reporting the stale result
	 * while the user types a correction.
	 */
	it('feeds the live aircraft text to the resolution preview', async () => {
		const wrapper = await mountLoaded()
		const preview = wrapper.findComponent({ name: 'AircraftResolution' })
		expect(preview.props('raw')).toBe('A320')

		const fields = wrapper.findAllComponents({ name: 'NcTextField' })
		const aircraft = fields.find((f) => f.props('label') === 'Aircraft type')!
		await aircraft.vm.$emit('update:model-value', 'B738')
		await flushPromises()

		expect(preview.props('raw')).toBe('B738')
	})

	/**
	 * The seam between the picker and the payload. Sending the triple is what
	 * tells the backend to honour the choice instead of reconciling the text, so
	 * a pick that never reaches the request would silently do nothing.
	 */
	it('sends the picked reference type, leaving the typed text alone', async () => {
		vi.useFakeTimers()
		try {
			const wrapper = await mountLoaded()
			const fields = wrapper.findAllComponents({ name: 'NcTextField' })
			const aircraft = fields.find((f) => f.props('label') === 'Aircraft type')!

			await aircraft.vm.$emit('update:model-value', 'the boeing')
			await vi.advanceTimersByTimeAsync(250)
			await flushPromises()
			await wrapper.find('.suggestion').trigger('click')

			await wrapper.find('form').trigger('submit')
			await flushPromises()

			expect(store.update).toHaveBeenCalledWith(1, expect.objectContaining({
				aircraftTypeCode: 'B738',
				aircraftManufacturer: 'BOEING',
				aircraftModel: '737-800',
				aircraftTypeRaw: 'the boeing',
			}))
		} finally {
			vi.useRealTimers()
		}
	})

	it('sends no aircraft code when nothing was picked, so the server reconciles', async () => {
		const wrapper = await mountLoaded()
		await wrapper.find('form').trigger('submit')
		await flushPromises()

		expect(store.update).toHaveBeenCalledWith(1, expect.objectContaining({
			aircraftTypeCode: null,
			aircraftManufacturer: null,
			aircraftModel: null,
		}))
	})
})
