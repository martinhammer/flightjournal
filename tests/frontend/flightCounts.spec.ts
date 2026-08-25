import { describe, it, expect } from 'vitest'
import { countByAircraft, countByAirport } from '../../src/flightCounts.ts'
import type { Flight } from '../../src/types.ts'

function flight(overrides: Partial<Flight> = {}): Flight {
	return {
		id: 1,
		flightDate: '2026-01-01',
		daySeq: 1,
		originCode: null,
		destinationCode: null,
		originLabel: null,
		destinationLabel: null,
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

describe('countByAircraft', () => {
	it('counts by the resolved reference name', () => {
		const counts = countByAircraft([
			flight({ aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
			flight({ aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
			flight({ aircraftManufacturer: 'AIRBUS', aircraftModel: 'A-320' }),
		])
		expect(counts.get('BOEING 737-800')).toBe(2)
		expect(counts.get('AIRBUS A-320')).toBe(1)
	})

	/**
	 * Keyed on the display value, so a half-reconciled leg lands under its raw
	 * text — not under the reference row it half-points at. That keeps the column
	 * honest: the count is what the row's own filter would return, and that
	 * filter would not return this leg either.
	 */
	it('attributes a half-reconciled leg to its raw text, not its designator', () => {
		const counts = countByAircraft([
			flight({ aircraftTypeCode: 'B738', aircraftTypeRaw: '737-800' }),
		])
		expect(counts.get('BOEING 737-800')).toBeUndefined()
		expect(counts.get('737-800')).toBe(1)
	})

	it('ignores legs with no aircraft recorded', () => {
		expect(countByAircraft([flight()]).size).toBe(0)
	})

	it('is case-insensitive on the key', () => {
		const counts = countByAircraft([
			flight({ aircraftManufacturer: 'Boeing', aircraftModel: '737-800' }),
			flight({ aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
		])
		expect(counts.get('BOEING 737-800')).toBe(2)
	})
})

describe('countByAirport', () => {
	it('counts a leg at both of its endpoints', () => {
		const counts = countByAirport([flight({ originCode: 'LHR', destinationCode: 'JFK' })])
		expect(counts.get('LHR')).toBe(1)
		expect(counts.get('JFK')).toBe(1)
	})

	it('accumulates across legs', () => {
		const counts = countByAirport([
			flight({ originCode: 'LHR', destinationCode: 'JFK' }),
			flight({ originCode: 'JFK', destinationCode: 'LHR' }),
			flight({ originCode: 'LHR', destinationCode: 'CPH' }),
		])
		expect(counts.get('LHR')).toBe(3)
		expect(counts.get('JFK')).toBe(2)
		expect(counts.get('CPH')).toBe(1)
	})

	/**
	 * A leg that starts and ends at the same airport is one flight there, not
	 * two — and the row's "to and from" filter would return it once, so the
	 * column has to agree.
	 */
	it('counts a same-airport leg once', () => {
		const counts = countByAirport([flight({ originCode: 'LHR', destinationCode: 'LHR' })])
		expect(counts.get('LHR')).toBe(1)
	})

	it('counts the resolved half of a partially matched leg', () => {
		const counts = countByAirport([flight({ originCode: 'LHR', destinationCode: null })])
		expect(counts.get('LHR')).toBe(1)
		expect(counts.size).toBe(1)
	})

	it('is case-insensitive on the code', () => {
		const counts = countByAirport([
			flight({ originCode: 'lhr', destinationCode: 'JFK' }),
			flight({ originCode: 'LHR', destinationCode: 'CPH' }),
		])
		expect(counts.get('LHR')).toBe(2)
	})
})
