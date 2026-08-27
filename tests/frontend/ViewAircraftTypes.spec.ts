import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the flown-only switch (the default that decides what the view shows at
// all), the debounced search wiring, and the row menu's link into the Flights
// view — which has to carry the same "MANUFACTURER Model" string the Aircraft
// column displays, since that is what the aircraft filter matches on.

const { listAircraftTypes, push } = vi.hoisted(() => ({
	listAircraftTypes: vi.fn(),
	push: vi.fn(),
}))

vi.mock('../../src/api.ts', () => ({ listAircraftTypes }))
// The views now read the flights store to count flights per row. Mock it with a
// settable list so each test controls what the counts should be.
const { flightsStore } = vi.hoisted(() => ({
	flightsStore: { flights: [] as unknown[], loaded: true, fetchAll: vi.fn() },
}))
vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => flightsStore }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import ViewAircraftTypes from '../../src/views/ViewAircraftTypes.vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'

const NcActions = { template: '<div class="menu"><slot /></div>' }
const NcActionButton = {
	emits: ['click'],
	template: '<button class="action" @click="$emit(\'click\')"><slot /></button>',
}
const NcCheckboxRadioSwitch = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<button class="switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
}

const stubs = {
	NcTextField: true,
	NcActions,
	NcActionButton,
	NcCheckboxRadioSwitch,
	NcEmptyContent: true,
	NcLoadingIcon: true,
	NcButton: true,
	Airplane: true,
}

const b738 = {
	id: 1, icaoCode: 'B738', iataCode: null, manufacturer: 'BOEING', model: '737-800',
	modelNormalized: '737800', engineType: 'Jet', engineCount: 2, wtc: 'M',
	description: 'LandPlane', canonical: true, source: 'csv-upload', updatedAt: 0,
}
const b738bbj = { ...b738, id: 2, model: '737-800 BBJ2', modelNormalized: '737800bbj2', canonical: false }

function page(items: Array<Record<string, unknown>>) {
	return { items, total: items.length, limit: 100, offset: 0 }
}

describe('ViewAircraftTypes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		flightsStore.flights = []
		flightsStore.loaded = true
		listAircraftTypes.mockResolvedValue(page([b738]))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('defaults to showing only flown types', async () => {
		mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		// 4th arg is flownOnly.
		expect(listAircraftTypes).toHaveBeenCalledWith('', 100, 0, true)
	})

	/**
	 * The two numbers have to come from the two list modes, not from whatever page
	 * the view is showing — otherwise a search or a page turn would change them.
	 */
	it('summarises flown and total counts from their own unfiltered queries', async () => {
		listAircraftTypes.mockImplementation((q: string, limit: number, offset: number, flownOnly: boolean) => {
			if (limit === 100) return Promise.resolve(page([b738]))
			return Promise.resolve({ items: [], total: flownOnly ? 13 : 7000, limit, offset })
		})

		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		expect(listAircraftTypes).toHaveBeenCalledWith('', 1, 0, true)
		expect(listAircraftTypes).toHaveBeenCalledWith('', 1, 0, false)
		expect(wrapper.find('.summary').text()).toBe(
			`${(13).toLocaleString()} flown / ${(7000).toLocaleString()} total`,
		)
	})

	it('switches to the full reference when "Show all" is toggled', async () => {
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		await wrapper.find('button.switch').trigger('click')
		await flushPromises()

		expect(listAircraftTypes).toHaveBeenLastCalledWith('', 100, 0, false)
	})

	it('debounces the search and resets to the first page', async () => {
		vi.useFakeTimers()
		const wrapper = mount(ViewAircraftTypes, {
			global: { stubs: { ...stubs, NcTextField } },
		})
		await flushPromises()
		listAircraftTypes.mockClear()

		await wrapper.findComponent(NcTextField).vm.$emit('update:model-value', 'boeing')
		expect(listAircraftTypes).not.toHaveBeenCalled()

		vi.advanceTimersByTime(250)
		await flushPromises()

		expect(listAircraftTypes).toHaveBeenCalledWith('boeing', 100, 0, true)
	})

	it('links a row to the flights filtered by its displayed name, not its designator', async () => {
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		await wrapper.find('button.action').trigger('click')

		expect(push).toHaveBeenCalledWith({ name: 'flights', query: { aircraft: 'BOEING 737-800' } })
	})

	it('marks only the canonical model as the designator default', async () => {
		listAircraftTypes.mockResolvedValue(page([b738, b738bbj]))
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const rows = wrapper.findAll('tbody tr')
		expect(rows).toHaveLength(2)
		expect(rows[0].find('.default-badge').exists()).toBe(true)
		expect(rows[1].find('.default-badge').exists()).toBe(false)
	})

	/**
	 * Header and body are edited separately, so a column added or removed on one
	 * side only skews every cell after it without failing anything else. There is
	 * no IATA column: `iata_code` is never written yet, so it would be blank on
	 * every row.
	 */
	it('keeps the header and body column counts in step', async () => {
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const headers = wrapper.findAll('thead th').map((h) => h.text())
		expect(headers).toEqual(['ICAO', 'Manufacturer', 'Model', 'Class', 'Engines', 'Wake', 'Flights', ''])
		expect(wrapper.find('tbody tr').findAll('td')).toHaveLength(headers.length)
	})

	it('renders engine count and type together', async () => {
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		expect(wrapper.find('tbody tr').text()).toContain('2 × Jet')
	})

	/**
	 * The rule the flown list is built on: a row belongs there only if its own
	 * menu action leads to at least one flight. Since that action filters on the
	 * row's displayed name and the flights filter matches `aircraftDisplay`, the
	 * link text and the filter value have to be the same string — which is what
	 * makes matching on (manufacturer, model) the right restriction rather than
	 * on the shared designator.
	 */
	it('links using the same string the flights filter matches on', async () => {
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		await wrapper.find('button.action').trigger('click')
		const query = push.mock.calls[0][0].query as { aircraft: string }

		// A flight resolved to this row displays exactly this, so the filter hits.
		const flightDisplay = [b738.manufacturer, b738.model].filter(Boolean).join(' ')
		expect(query.aircraft.toUpperCase()).toBe(flightDisplay.toUpperCase())
	})

	/**
	 * The count is keyed by the same value the flights filter matches on, so the
	 * number shown is exactly what the row's own menu action would return. These
	 * fixtures use the display fallbacks deliberately: only the fully resolved
	 * legs should be attributed to the row.
	 */
	it('counts the flights attributed to each row', async () => {
		flightsStore.flights = [
			{ aircraftManufacturer: 'BOEING', aircraftModel: '737-800', aircraftTypeRaw: '738', aircraftTypeCode: 'B738' },
			{ aircraftManufacturer: 'BOEING', aircraftModel: '737-800', aircraftTypeRaw: null, aircraftTypeCode: 'B738' },
			// Half-reconciled: displays its raw text, so no row can claim it.
			{ aircraftManufacturer: null, aircraftModel: null, aircraftTypeRaw: '737-800', aircraftTypeCode: 'B738' },
			// A different type entirely.
			{ aircraftManufacturer: 'AIRBUS', aircraftModel: 'A-320', aircraftTypeRaw: null, aircraftTypeCode: 'A320' },
		]
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const cells = wrapper.find('tbody tr').findAll('td')
		expect(cells[cells.length - 2].text()).toBe('2')
	})

	it('shows zero for a reference row never flown', async () => {
		flightsStore.flights = []
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const cells = wrapper.find('tbody tr').findAll('td')
		expect(cells[cells.length - 2].text()).toBe('0')
	})

	it('loads the flights only when the store is cold', async () => {
		flightsStore.loaded = true
		mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()
		expect(flightsStore.fetchAll).not.toHaveBeenCalled()

		flightsStore.loaded = false
		mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()
		expect(flightsStore.fetchAll).toHaveBeenCalledTimes(1)
	})

	it('tells the user how to populate an empty flown list', async () => {
		listAircraftTypes.mockResolvedValue(page([]))
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const empty = wrapper.findComponent({ name: 'NcEmptyContent' })
		expect(empty.attributes('name')).toBe('No flown aircraft types yet')
	})
})
