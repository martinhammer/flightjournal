import { describe, it, expect } from 'vitest'
import {
	buildLegs,
	collectAirportCodes,
	countFlightsByAirport,
	countFlightsByRoute,
	flownRouteDirections,
	greatCircleKm,
	indexByCode,
	orderedRouteDirections,
	prepareBasemap,
	routeKey,
	unwrapRing,
} from '../../src/mapUtils.ts'
import type { Airport, Flight } from '../../src/types.ts'

function flight(overrides: Partial<Flight>): Flight {
	return {
		id: 1,
		flightDate: '2026-01-01',
		originCode: null,
		destinationCode: null,
		originLabel: null,
		destinationLabel: null,
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
		...overrides,
	}
}

function airport(overrides: Partial<Airport>): Airport {
	return {
		id: 1,
		iata: null,
		icao: null,
		name: null,
		city: null,
		state: null,
		countryIso2: null,
		lat: null,
		lon: null,
		elevation: null,
		tz: null,
		source: null,
		updatedAt: 0,
		...overrides,
	}
}

describe('collectAirportCodes', () => {
	it('returns distinct uppercased codes and ignores null codes', () => {
		const flights = [
			flight({ originCode: 'lhr', destinationCode: 'JFK' }),
			flight({ originCode: 'JFK', destinationCode: 'lhr' }),
			flight({ originCode: null, destinationCode: 'CPH' }),
		]
		expect(collectAirportCodes(flights).sort()).toEqual(['CPH', 'JFK', 'LHR'])
	})

	it('includes the focus code even when not flown', () => {
		expect(collectAirportCodes([], 'osh')).toEqual(['OSH'])
	})
})

describe('countFlightsByAirport', () => {
	it('counts each flight once per airport it involves', () => {
		const counts = countFlightsByAirport([
			flight({ originCode: 'LHR', destinationCode: 'JFK' }),
			flight({ originCode: 'JFK', destinationCode: 'LHR' }),
			flight({ originCode: 'CPH', destinationCode: 'LHR' }),
		])
		expect(counts.get('LHR')).toBe(3)
		expect(counts.get('JFK')).toBe(2)
		expect(counts.get('CPH')).toBe(1)
	})

	it('is case-insensitive and ignores flights with no code', () => {
		const counts = countFlightsByAirport([
			flight({ originCode: 'lhr', destinationCode: null }),
			flight({ originCode: null, destinationCode: null }),
		])
		expect(counts.get('LHR')).toBe(1)
	})
})

describe('countFlightsByRoute', () => {
	it('counts both directions of a route together', () => {
		const counts = countFlightsByRoute([
			flight({ originCode: 'LHR', destinationCode: 'JFK' }),
			flight({ originCode: 'JFK', destinationCode: 'LHR' }),
			flight({ originCode: 'lhr', destinationCode: 'jfk' }),
			flight({ originCode: 'CPH', destinationCode: 'LHR' }),
		])
		expect(counts.get(routeKey('JFK', 'LHR'))).toBe(3)
		expect(counts.get(routeKey('CPH', 'LHR'))).toBe(1)
	})

	it('routeKey is order-independent and uppercased', () => {
		expect(routeKey('lhr', 'JFK')).toBe(routeKey('jfk', 'LHR'))
	})
})

describe('orderedRouteDirections', () => {
	it('puts the oldest-flown direction first', () => {
		const flights = [
			{ ...flight({ originCode: 'JFK', destinationCode: 'LHR' }), flightDate: '2020-01-01' },
			{ ...flight({ originCode: 'LHR', destinationCode: 'JFK' }), flightDate: '2019-01-01' },
		]
		expect(orderedRouteDirections('LHR', 'JFK', flights)).toEqual([['LHR', 'JFK'], ['JFK', 'LHR']])
	})

	it('falls back to alphabetical order when no flight resolves it', () => {
		expect(orderedRouteDirections('LHR', 'JFK', [])).toEqual([['JFK', 'LHR'], ['LHR', 'JFK']])
	})
})

describe('flownRouteDirections', () => {
	it('returns both directions when the route was flown both ways', () => {
		const flights = [
			flight({ originCode: 'LHR', destinationCode: 'JFK' }),
			flight({ originCode: 'JFK', destinationCode: 'LHR' }),
		]
		expect(flownRouteDirections('LHR', 'JFK', flights)).toHaveLength(2)
	})

	it('returns only the flown direction for a one-way route', () => {
		const flights = [flight({ originCode: 'LHR', destinationCode: 'JFK' })]
		expect(flownRouteDirections('JFK', 'LHR', flights)).toEqual([['LHR', 'JFK']])
	})
})

describe('indexByCode', () => {
	it('keys by IATA when present, else ICAO, uppercased', () => {
		const map = indexByCode([
			airport({ id: 1, iata: 'LHR', icao: 'EGLL' }),
			airport({ id: 2, iata: null, icao: 'KOSH' }),
		])
		expect(map.get('LHR')?.id).toBe(1)
		expect(map.get('KOSH')?.id).toBe(2)
		expect(map.has('EGLL')).toBe(false)
	})
})

describe('buildLegs', () => {
	const lhr = airport({ iata: 'LHR', lat: 51.5, lon: -0.45 })
	const jfk = airport({ iata: 'JFK', lat: 40.6, lon: -73.8 })
	const noCoords = airport({ iata: 'CPH' })
	const byCode = indexByCode([lhr, jfk, noCoords])

	it('builds a leg when both endpoints resolve with coordinates', () => {
		const legs = buildLegs([flight({ originCode: 'LHR', destinationCode: 'JFK' })], byCode)
		expect(legs).toHaveLength(1)
		expect(legs[0].from.iata).toBe('LHR')
		expect(legs[0].to.iata).toBe('JFK')
	})

	it('skips flights with a missing code, unknown airport, or missing coordinates', () => {
		const legs = buildLegs([
			flight({ originCode: null, destinationCode: 'JFK' }),
			flight({ originCode: 'LHR', destinationCode: 'ZZZ' }),
			flight({ originCode: 'LHR', destinationCode: 'CPH' }),
		], byCode)
		expect(legs).toHaveLength(0)
	})
})

describe('unwrapRing', () => {
	it('removes the antimeridian jump so longitudes run continuously', () => {
		const ring = unwrapRing([[170, 60], [179, 61], [-179, 62], [-170, 63]])
		// -179 after 179 must become 181, -170 must become 190.
		expect(ring.map((p) => p[0])).toEqual([170, 179, 181, 190])
		for (let i = 1; i < ring.length; i++) {
			expect(Math.abs(ring[i][0] - ring[i - 1][0])).toBeLessThanOrEqual(180)
		}
	})
})

describe('prepareBasemap', () => {
	const fc: GeoJSON.FeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: { name: 'Antarctica' },
				geometry: { type: 'Polygon', coordinates: [[[0, -80], [10, -80], [0, -80]]] },
			},
			{
				type: 'Feature',
				properties: { name: 'Russia' },
				geometry: { type: 'Polygon', coordinates: [[[170, 60], [-170, 62], [170, 60]]] },
			},
		],
	}

	it('drops Antarctica and unwraps the remaining rings', () => {
		const out = prepareBasemap(fc)
		expect(out.features).toHaveLength(1)
		expect(out.features[0].properties?.name).toBe('Russia')
		const ring = (out.features[0].geometry as { coordinates: number[][][] }).coordinates[0]
		expect(ring.map((p) => p[0])).toEqual([170, 190, 170])
	})
})

describe('greatCircleKm', () => {
	it('is zero for identical points', () => {
		expect(greatCircleKm(51.47, -0.4543, 51.47, -0.4543)).toBe(0)
	})

	it('returns ~10008 km for a quarter of the equator', () => {
		expect(greatCircleKm(0, 0, 0, 90)).toBeGreaterThanOrEqual(10006)
		expect(greatCircleKm(0, 0, 0, 90)).toBeLessThanOrEqual(10010)
	})

	it('matches the backend formula for a known city pair (LHR → JFK ≈ 5555 km)', () => {
		const d = greatCircleKm(51.47, -0.4543, 40.6413, -73.7781)
		expect(d).toBeGreaterThanOrEqual(5525)
		expect(d).toBeLessThanOrEqual(5585)
	})
})
