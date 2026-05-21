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
