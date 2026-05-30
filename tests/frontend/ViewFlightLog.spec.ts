import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Covers the route-query-driven filtering and the removable filter chip.

const { store, push, routeHolder } = vi.hoisted(() => ({
	store: {
		flights: [] as unknown[],
		loaded: true,
		loading: false,
		fetchAll: vi.fn(),
		remove: vi.fn(),
	},
	push: vi.fn(),
	routeHolder: { query: {} as Record<string, string> },
}))

vi.mock('../../src/store/flights.ts', () => ({ useFlightsStore: () => store }))
vi.mock('vue-router', async (importOriginal) => ({
	...await importOriginal<typeof import('vue-router')>(),
	useRoute: () => routeHolder,
	useRouter: () => ({ push }),
}))

import ViewFlightLog from '../../src/views/ViewFlightLog.vue'

function flight(id: number, originCode: string, destinationCode: string, distanceKm: number | null = null) {
	return {
		id,
		flightDate: `2026-01-0${id}`,
		originCode,
		destinationCode,
		originLabel: originCode,
		destinationLabel: destinationCode,
		airlineCode: null,
		flightNumber: null,
		aircraftTypeCode: null,
		aircraftTypeRaw: null,
		registration: null,
		cabinClass: null,
		seat: null,
		notes: null,
		distanceKm,
		createdAt: 0,
		updatedAt: 0,
	}
}

const NcChipStub = {
	name: 'NcChip',
	props: ['text'],
	emits: ['close'],
	template: '<span class="chip">{{ text }}<button class="chip-close" @click="$emit(\'close\')" /></span>',
}

const NcButtonStub = {
	name: 'NcButton',
	emits: ['click'],
	template: '<button class="nc-button" @click="$emit(\'click\')"><slot /></button>',
}

// Slot-rendering stubs so the per-row menu's action buttons are reachable.
const NcActions = { template: '<div class="row-menu"><slot /></div>' }
const NcActionButton = {
	emits: ['click'],
	template: '<button class="row-action" @click="$emit(\'click\')"><slot /></button>',
}

const stubs = {
	NcChip: NcChipStub,
	NcButton: NcButtonStub,
	NcEmptyContent: true,
	NcActions,
	NcActionButton,
	NcLoadingIcon: true,
	MenuUp: true,
	MenuDown: true,
	Pencil: true,
	TrashCan: true,
	Map: true,
	// FilterPicker is covered by its own spec; stub here to keep this file focused.
	FilterPicker: true,
}

function render() {
	return mount(ViewFlightLog, { global: { stubs } })
}

beforeEach(() => {
	push.mockClear()
	routeHolder.query = {}
	// f1 LHR→JFK, f2 JFK→LHR, f3 CPH→LHR
	store.flights = [
		flight(1, 'LHR', 'JFK', 5555),
		flight(2, 'JFK', 'LHR', 5555),
		flight(3, 'CPH', 'LHR', 955),
	]
})

describe('ViewFlightLog filtering', () => {
	it('lists every flight when no filter is active', () => {
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(3)
		expect(wrapper.find('.chip').exists()).toBe(false)
	})

	it('filters to arrivals with airportDir=to', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(2)
	})

	it('filters to departures with airportDir=from', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'from' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(1)
	})

	it('filters to both directions with airportDir=either', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'either' }
		const wrapper = render()
		expect(wrapper.findAll('tbody tr')).toHaveLength(3)
	})

	it('shows a chip for the active filter and clears it on close', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		expect(wrapper.find('.chip').text()).toContain('To LHR')

		await wrapper.find('.chip-close').trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'flights', query: {} })
	})

	it('shows how many flights the filter matches', () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		// Heading-level count: "<shown> of <total> flights" while a filter narrows.
		expect(wrapper.find('.filter-count').text()).toBe('2 of 3 flights')
	})

	it('shows just the total in the heading when no filter is active', () => {
		routeHolder.query = {}
		const wrapper = render()
		expect(wrapper.find('.filter-count').text()).toBe('3 flights')
	})

	it('carries the active filter to the Map view via "View on map"', async () => {
		routeHolder.query = { airport: 'LHR', airportDir: 'to' }
		const wrapper = render()
		await wrapper.find('.nc-button').trigger('click')
		expect(push).toHaveBeenCalledWith({
			name: 'map',
			query: { airport: 'LHR', airportDir: 'to' },
		})
	})

	it('shows no "View on map" button when no filter is active', () => {
		const wrapper = render()
		expect(wrapper.find('.nc-button').exists()).toBe(false)
	})

	it('opens a single flight on the Map view from its row menu', async () => {
		const wrapper = render()
		// First row is the newest flight (sorted by date desc) — f3, id 3.
		// Row menu order: View on map, Edit, Delete.
		const firstRowActions = wrapper.findAll('tbody tr')[0].findAll('.row-action')
		await firstRowActions[0].trigger('click')
		expect(push).toHaveBeenCalledWith({ name: 'map', query: { flight: '3' } })
	})
})

describe('ViewFlightLog distance column', () => {
	// Distance cell is the 4th column (date, flight, route, distance, …).
	const distanceCells = (wrapper: ReturnType<typeof render>) =>
		wrapper.findAll('tbody tr').map((r) => r.findAll('td')[3].text().replace(/\D/g, ''))

	it('sorts numerically by distance, not lexically', async () => {
		const wrapper = render()
		const distanceHeader = wrapper.findAll('th .sort-button')[3]
		expect(distanceHeader.text()).toContain('Distance (km)')

		// First click uses the column's desc default → longest first.
		await distanceHeader.trigger('click')
		expect(distanceCells(wrapper)).toEqual(['5555', '5555', '955'])

		// Toggling flips to ascending → shortest first.
		await distanceHeader.trigger('click')
		expect(distanceCells(wrapper)).toEqual(['955', '5555', '5555'])
	})

	it('renders an empty cell when distance is unknown', () => {
		store.flights = [flight(1, 'AAA', 'BBB', null)]
		const wrapper = render()
		expect(wrapper.find('tbody tr td.numeric').text()).toBe('')
	})
})
