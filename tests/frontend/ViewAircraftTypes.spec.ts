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

	it('tells the user how to populate an empty flown list', async () => {
		listAircraftTypes.mockResolvedValue(page([]))
		const wrapper = mount(ViewAircraftTypes, { global: { stubs } })
		await flushPromises()

		const empty = wrapper.findComponent({ name: 'NcEmptyContent' })
		expect(empty.attributes('name')).toBe('No flown aircraft types yet')
	})
})
