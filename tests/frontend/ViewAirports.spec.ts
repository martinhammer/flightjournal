import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Covers the search box wiring (catches the v8→v9 `:value`/`modelValue`
// regression) and the per-row menu navigation to the Flights and Map views.

const { listAirports, getAirportsByCodes, push, currentRoute } = vi.hoisted(() => ({
	listAirports: vi.fn(),
	getAirportsByCodes: vi.fn(),
	push: vi.fn(),
	currentRoute: { query: {} as Record<string, string> },
}))

vi.mock('../../src/api.ts', () => ({ listAirports, getAirportsByCodes }))
// The views now read the flights store to count flights per row. Mock it with a
// settable list so each test controls what the counts should be.
const { flightsStore } = vi.hoisted(() => ({
	flightsStore: { flights: [] as unknown[], loaded: true, fetchAll: vi.fn() },
}))
vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => flightsStore }))

vi.mock('vue-router', () => ({
	useRouter: () => ({ push }),
	useRoute: () => currentRoute,
}))

import ViewAirports from '../../src/views/ViewAirports.vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'

// Slot-rendering stubs so the row menu's action buttons are reachable.
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
	currentRoute.query = {}
	flightsStore.flights = []
	flightsStore.loaded = true
	flightsStore.fetchAll.mockClear()
	listAirports.mockReset()
	listAirports.mockResolvedValue(emptyPage)
	getAirportsByCodes.mockReset()
	getAirportsByCodes.mockResolvedValue([])
	push.mockClear()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('ViewAirports search', () => {
	it('fetches the first page on mount, restricted to flown airports', async () => {
		mount(ViewAirports, { global: { stubs } })
		await flushPromises()
		expect(listAirports).toHaveBeenCalledWith('', 100, 0, true)
	})

	/**
	 * The drill-through from the Map view's marker popup, which sends the canonical
	 * code as `?q=`. The first page has to be fetched already filtered — a seeded
	 * box that still lists every flown airport would look broken — and the term has
	 * to reach the search field so the user can see and clear it.
	 */
	it('seeds the search from the route query on mount', async () => {
		currentRoute.query = { q: 'KEF' }
		const wrapper = mount(ViewAirports, { global: { stubs: { ...stubs, NcTextField } } })
		await flushPromises()

		expect(listAirports).toHaveBeenCalledWith('KEF', 100, 0, true)
		expect(wrapper.findComponent(NcTextField).props('modelValue')).toBe('KEF')
	})

	it('queries the backend with the typed search term', async () => {
		vi.useFakeTimers()
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		wrapper.findComponent(NcTextField).vm.$emit('update:modelValue', 'LHR')
		await flushPromises()
		vi.advanceTimersByTime(250)
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('LHR', 100, 0, true)
	})
})

/**
 * The Map view's "View CODE details" sends `?code=`. It must be an exact IATA/ICAO
 * lookup — the search box's substring match lets "SAN" find San Francisco too —
 * and must find the airport even when it is not flown: Airports (Show all) →
 * "Show on map" puts an unflown airport on the map, whose popup links back here.
 */
describe('ViewAirports exact code drill-through', () => {
	const san = { ...lhr, id: 2, iata: 'SAN', icao: 'KSAN', name: 'San Diego International', city: 'San Diego' }

	it('looks the code up exactly, outside the flown-only list', async () => {
		currentRoute.query = { code: 'SAN' }
		getAirportsByCodes.mockResolvedValue([san])
		const wrapper = mount(ViewAirports, { global: { stubs: { ...stubs, NcTextField } } })
		await flushPromises()

		expect(getAirportsByCodes).toHaveBeenCalledWith(['SAN'])
		// No substring search for the page (only the two summary probes, limit 1).
		expect(listAirports).not.toHaveBeenCalledWith('SAN', 100, 0, expect.anything())
		expect(wrapper.findAll('tbody tr')).toHaveLength(1)
		expect(wrapper.find('td.name').text()).toBe('San Diego International')
		expect(wrapper.find('.pager-info').text()).toBe('1–1 of 1')
		expect(wrapper.findComponent(NcTextField).props('modelValue')).toBe('SAN')
	})

	it('goes back to the ordinary search once the box is edited', async () => {
		vi.useFakeTimers()
		currentRoute.query = { code: 'SAN' }
		getAirportsByCodes.mockResolvedValue([san])
		const wrapper = mount(ViewAirports, { global: { stubs: { ...stubs, NcTextField } } })
		await flushPromises()

		wrapper.findComponent(NcTextField).vm.$emit('update:modelValue', 'SA')
		await flushPromises()
		vi.advanceTimersByTime(250)
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('SA', 100, 0, true)
		expect(getAirportsByCodes).toHaveBeenCalledTimes(1)
	})

	it('goes back to the ordinary search when the switch is flipped', async () => {
		currentRoute.query = { code: 'SAN' }
		getAirportsByCodes.mockResolvedValue([san])
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		await wrapper.find('.switch').trigger('click')
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('SAN', 100, 0, false)
		expect(getAirportsByCodes).toHaveBeenCalledTimes(1)
	})

	it('names the code when the reference data has no such airport', async () => {
		currentRoute.query = { code: 'ZZZ' }
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		const empty = wrapper.findComponent({ name: 'NcEmptyContent' })
		expect(empty.attributes('description')).toBe('No airport with the code ZZZ in the reference data.')
	})
})

describe('ViewAirports summary', () => {
	// The two numbers must come from the two list modes, not from the page the
	// view happens to be showing — otherwise searching or paging changes them.
	it('reports visited and total counts from their own unfiltered queries', async () => {
		listAirports.mockImplementation((q: string, limit: number, offset: number, flownOnly: boolean) => {
			if (limit === 100) return Promise.resolve(pageWith(lhr))
			return Promise.resolve({ ...emptyPage, total: flownOnly ? 20 : 25000 })
		})

		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		expect(listAirports).toHaveBeenCalledWith('', 1, 0, true)
		expect(listAirports).toHaveBeenCalledWith('', 1, 0, false)
		expect(wrapper.find('.summary').text()).toBe(
			`${(20).toLocaleString()} visited / ${(25000).toLocaleString()} total`,
		)
	})
})

describe('ViewAirports show-all toggle', () => {
	it('refetches without the flown-only restriction when enabled', async () => {
		const wrapper = mount(ViewAirports, { global: { stubs } })
		await flushPromises()

		await wrapper.find('.switch').trigger('click')
		await flushPromises()

		expect(listAirports).toHaveBeenLastCalledWith('', 100, 0, false)
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
