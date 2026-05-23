import { describe, it, expect } from 'vitest'
import { applyFilters, buildFilters } from '../../src/filters.ts'
import type { Flight } from '../../src/types.ts'

function flight(originCode: string, destinationCode: string): Flight {
	return {
		id: 1,
		flightDate: '2026-01-01',
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

describe('buildFilters', () => {
	it('returns no filter for an empty query', () => {
		expect(buildFilters({})).toEqual([])
	})

	it('treats an airport without a direction as a focus hint, not a filter', () => {
		expect(buildFilters({ airport: 'LHR' })).toEqual([])
	})

	it('ignores an invalid direction', () => {
		expect(buildFilters({ airport: 'LHR', airportDir: 'sideways' })).toEqual([])
	})

	it('builds an airport filter with a valid direction and uppercases the code', () => {
		const filters = buildFilters({ airport: 'lhr', airportDir: 'from' })
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('airport')
		expect(filters[0].label).toBe('From LHR')
		expect(filters[0].queryKeys).toEqual(['airport', 'airportDir'])
	})

	it('builds a single-flight filter matching by id', () => {
		const flights = [flight('LHR', 'JFK')]
		const filters = buildFilters({ flight: '1' }, flights)
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('flight')
		expect(filters[0].queryKeys).toEqual(['flight'])
		expect(filters[0].matches(flights[0])).toBe(true)
	})

	it('includes the date in the flight chip label to disambiguate instances', () => {
		const flights = [{ ...flight('LHR', 'JFK'), airlineCode: 'BA', flightNumber: '123' }]
		expect(buildFilters({ flight: '1' }, flights)[0].label).toBe('BA123 2026-01-01')
	})

	it('falls back to a generic flight label when the flight is not in the list', () => {
		expect(buildFilters({ flight: '99' }, [])[0].label).toBe('Flight #99')
	})

	it('ignores a non-numeric flight id', () => {
		expect(buildFilters({ flight: 'abc' })).toEqual([])
	})

	it('builds a directional route filter', () => {
		const filters = buildFilters({ routeA: 'lhr', routeB: 'jfk', routeDir: 'ab' })
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('route')
		expect(filters[0].label).toBe('LHR → JFK')
		expect(filters[0].queryKeys).toEqual(['routeA', 'routeB', 'routeDir'])
	})

	it('builds a cabin filter from a CSV value, labelling with the display names', () => {
		const filters = buildFilters({ cabin: 'business,first' })
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('cabin')
		expect(filters[0].label).toBe('Cabin: Business, First')
		expect(filters[0].queryKeys).toEqual(['cabin'])
	})

	it('ignores unknown cabin values', () => {
		expect(buildFilters({ cabin: 'business,sleeper' })[0].label).toBe('Cabin: Business')
		expect(buildFilters({ cabin: 'sleeper' })).toEqual([])
	})

	it('builds a date-range filter and renders "…" for the open side', () => {
		expect(buildFilters({ dateFrom: '2025-01-01', dateTo: '2025-06-30' })[0].label)
			.toBe('2025-01-01 → 2025-06-30')
		expect(buildFilters({ dateTo: '2025-06-30' })[0].label).toBe('… → 2025-06-30')
		expect(buildFilters({ dateFrom: '2025-01-01' })[0].label).toBe('2025-01-01 → …')
	})

	it('rejects malformed or impossible dates rather than silently filtering everything', () => {
		expect(buildFilters({ dateFrom: 'yesterday' })).toEqual([])
		expect(buildFilters({ dateFrom: '2025-02-30' })).toEqual([]) // round-trip catches it
	})

	it('builds an airline filter (CSV, uppercase)', () => {
		const filters = buildFilters({ airline: 'ey,ek' })
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('airline')
		expect(filters[0].label).toBe('Airline: EY, EK')
	})

	it('builds an aircraft-type filter (CSV, uppercase)', () => {
		const filters = buildFilters({ aircraft: 'b77w,b789' })
		expect(filters).toHaveLength(1)
		expect(filters[0].id).toBe('aircraft')
		expect(filters[0].label).toBe('Aircraft: B77W, B789')
	})

	it('drops empty or duplicate CSV entries', () => {
		expect(buildFilters({ airline: ' ,ey, ,ey ' })[0].label).toBe('Airline: EY')
	})
})

describe('new filter matchers', () => {
	const f = (overrides: Partial<Flight>): Flight => ({ ...flight('LHR', 'JFK'), ...overrides })

	it('cabin matches only the selected classes', () => {
		const list = [
			f({ id: 1, cabinClass: 'business' }),
			f({ id: 2, cabinClass: 'first' }),
			f({ id: 3, cabinClass: 'economy' }),
			f({ id: 4, cabinClass: null }),
		]
		const filtered = applyFilters(list, buildFilters({ cabin: 'business,first' }))
		expect(filtered.map((x) => x.id).sort()).toEqual([1, 2])
	})

	it('date range is inclusive on both ends', () => {
		const list = [
			f({ id: 1, flightDate: '2024-12-31' }),
			f({ id: 2, flightDate: '2025-01-01' }),
			f({ id: 3, flightDate: '2025-06-30' }),
			f({ id: 4, flightDate: '2025-07-01' }),
		]
		const filtered = applyFilters(list, buildFilters({ dateFrom: '2025-01-01', dateTo: '2025-06-30' }))
		expect(filtered.map((x) => x.id).sort()).toEqual([2, 3])
	})

	it('airline matches case-insensitively', () => {
		const list = [
			f({ id: 1, airlineCode: 'EY' }),
			f({ id: 2, airlineCode: 'ey' }),
			f({ id: 3, airlineCode: 'EK' }),
			f({ id: 4, airlineCode: null }),
		]
		const filtered = applyFilters(list, buildFilters({ airline: 'ey' }))
		expect(filtered.map((x) => x.id).sort()).toEqual([1, 2])
	})

	it('aircraft matches case-insensitively', () => {
		const list = [
			f({ id: 1, aircraftTypeCode: 'B77W' }),
			f({ id: 2, aircraftTypeCode: 'b789' }),
			f({ id: 3, aircraftTypeCode: null }),
		]
		const filtered = applyFilters(list, buildFilters({ aircraft: 'B789' }))
		expect(filtered.map((x) => x.id).sort()).toEqual([2])
	})
})

describe('route filter matching', () => {
	const flights = [
		flight('LHR', 'JFK'),
		flight('JFK', 'LHR'),
		flight('CPH', 'LHR'),
	]

	it('directional matches only that exact direction', () => {
		const filtered = applyFilters(flights, buildFilters({ routeA: 'LHR', routeB: 'JFK', routeDir: 'ab' }))
		expect(filtered).toHaveLength(1)
		expect(filtered[0].originCode).toBe('LHR')
		expect(filtered[0].destinationCode).toBe('JFK')
	})

	it('bidirectional matches both directions of the pair', () => {
		const filtered = applyFilters(flights, buildFilters({ routeA: 'LHR', routeB: 'JFK', routeDir: 'both' }))
		expect(filtered).toHaveLength(2)
	})
})

describe('applyFilters', () => {
	const flights = [
		flight('LHR', 'JFK'),
		flight('JFK', 'LHR'),
		flight('CPH', 'LHR'),
	]

	it('returns all flights when there are no filters', () => {
		expect(applyFilters(flights, [])).toHaveLength(3)
	})

	it('applies the airport "either" matcher', () => {
		const filtered = applyFilters(flights, buildFilters({ airport: 'LHR', airportDir: 'either' }))
		expect(filtered).toHaveLength(3)
	})

	it('applies the airport "from" matcher', () => {
		const filtered = applyFilters(flights, buildFilters({ airport: 'LHR', airportDir: 'from' }))
		expect(filtered).toHaveLength(1)
		expect(filtered[0].originCode).toBe('LHR')
	})
})
