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

function flight(id: number, originCode: string, destinationCode: string) {
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

const stubs = {
	NcChip: NcChipStub,
	NcEmptyContent: true,
	NcActions: true,
	NcActionButton: true,
	NcLoadingIcon: true,
	MenuUp: true,
	MenuDown: true,
	Pencil: true,
	TrashCan: true,
}

function render() {
	return mount(ViewFlightLog, { global: { stubs } })
}

beforeEach(() => {
	push.mockClear()
	routeHolder.query = {}
	// f1 LHR→JFK, f2 JFK→LHR, f3 CPH→LHR
	store.flights = [
		flight(1, 'LHR', 'JFK'),
		flight(2, 'JFK', 'LHR'),
		flight(3, 'CPH', 'LHR'),
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
})
