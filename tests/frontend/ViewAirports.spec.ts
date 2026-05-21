import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the search box wiring (catches the v8→v9 `:value`/`modelValue`
// regression) and the per-row menu navigation to the Flights and Map views.

const { listAirports, push } = vi.hoisted(() => ({
	listAirports: vi.fn(),
	push: vi.fn(),
}))

vi.mock('../../src/api.ts', () => ({ listAirports }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import ViewAirports from '../../src/views/ViewAirports.vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'

// Slot-rendering stubs so the row menu's action buttons are reachable.
const NcActions = { template: '<div class="menu"><slot /></div>' }
const NcActionButton = {
	emits: ['click'],
	template: '<button class="action" @click="$emit(\'click\')"><slot /></button>',
}

const stubs = {
	NcTextField: true,
	NcActions,
	NcActionButton,
	NcEmptyContent: true,
	NcLoadingIcon: true,
	NcButton: true,
	AirplaneLanding: true,
	AirplaneTakeoff: true,
	SwapHorizontal: true,
	MapMarker: true,
}

const emptyPage = { items: [], total: 0, limit: 100, offset: 0 }

function pageWith(airport: Record<string, unknown>) {
	return { items: [airport], total: 1, limit: 100, offset: 0 }
}

const lhr = {
	id: 1, iata: 'LHR', icao: 'EGLL', name: 'Heathrow', city: 'London',
	state: null, countryIso2: 'GB', lat: 51.5, lon: -0.45, elevation: 83,
	tz: 'Europe/London', source: 'x', updatedAt: 0,
}

beforeEach(() => {
	listAirports.mockReset()
	listAirports.mockResolvedValue(emptyPage)
	push.mockClear()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('ViewAirports search', () => {
	it('fetches the first page on mount', async () => {
		mount(ViewAirports, { global: { stubs } })
		await flushPromises()
		expect(listAirports).toHaveBeenLastCalledWith('', 100, 0)
	})

	it('queries the backend with the typed search term', async () => {
		vi.useFakeTimers()
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		wrapper.findComponent(NcTextField).vm.$emit('update:modelValue', 'LHR')
		await flushPromises()
		vi.advanceTimersByTime(250)
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('LHR', 100, 0)
	})
})

describe('ViewAirports row menu', () => {
	async function mountWithRow() {
		listAirports.mockResolvedValue(pageWith(lhr))
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()
		return wrapper
	}

	it('navigates to the Flights view filtered by arrivals', async () => {
		const wrapper = await mountWithRow()
		// Menu order: to, from, to-and-from, map.
		await wrapper.findAll('.action')[0].trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'flights',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('navigates to the Map view focused on the airport', async () => {
		const wrapper = await mountWithRow()
		await wrapper.findAll('.action')[3].trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'map',
			query: { airport: 'LHR' },
		})
	})
})
