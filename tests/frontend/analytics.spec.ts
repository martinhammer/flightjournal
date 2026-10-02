import { describe, it, expect, afterEach } from 'vitest'
import {
	DISTANCE_BINS,
	WEEKDAYS,
	airportCodes,
	cabinBreakdown,
	comparisonPeriod,
	dateParts,
	distanceDistribution,
	flightYears,
	indexAirports,
	percentChange,
	periodSeries,
	rankAircraft,
	rankAirlines,
	rankAirports,
	rankManufacturers,
	rankRoutes,
	rankRoutesByDistanceFlown,
	records,
	summarize,
	weekdayCounts,
	yearOfRange,
	yearRange,
} from '../../src/analytics.ts'
import { applyFilters, buildFilters } from '../../src/filters.ts'
import type { Airport, Flight } from '../../src/types.ts'

let nextId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
	return {
		id: nextId++,
		flightDate: '2025-01-01',
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

function airport(iata: string, countryIso2: string, city = iata): Airport {
	return {
		id: 1, iata, icao: `X${iata}`, name: `${city} Airport`, city, state: null, countryIso2,
		lat: 0, lon: 0, elevation: null, tz: null, source: null, updatedAt: 0,
	}
}

describe('dateParts', () => {
	const tz = process.env.TZ
	afterEach(() => { process.env.TZ = tz })

	it('takes the weekday from the calendar date, not from local midnight', () => {
		// West of Greenwich, new Date('2025-03-03') is still Sunday evening.
		process.env.TZ = 'America/Los_Angeles'
		expect(dateParts('2025-03-03')).toEqual({ year: 2025, month: 2, weekday: 0 })
		expect(dateParts('2025-03-09').weekday).toBe(6)
	})
})

describe('year selection', () => {
	it('lists years newest first with counts', () => {
		const flights = [flight({ flightDate: '2024-05-01' }), flight({ flightDate: '2025-01-01' }), flight({ flightDate: '2025-12-31' })]
		expect(flightYears(flights)).toEqual([{ year: 2025, count: 2 }, { year: 2024, count: 1 }])
	})

	it('recognises only an exact calendar year as a year', () => {
		expect(yearOfRange('2025-01-01', '2025-12-31')).toBe(2025)
		expect(yearOfRange('2025-01-01', '2025-06-30')).toBeNull()
		expect(yearOfRange('2025-01-01', undefined)).toBeNull()
		expect(yearOfRange('2024-01-01', '2025-12-31')).toBeNull()
	})

	it('round-trips through the date filter', () => {
		const range = yearRange(2025)
		expect(yearOfRange(range.dateFrom, range.dateTo)).toBe(2025)
		const flights = [flight({ flightDate: '2024-12-31' }), flight({ flightDate: '2025-01-01' }), flight({ flightDate: '2025-12-31' }), flight({ flightDate: '2026-01-01' })]
		expect(applyFilters(flights, buildFilters(range))).toHaveLength(2)
	})
})

describe('summarize', () => {
	it('totals distance only over legs that have one, counting the rest as flights', () => {
		const s = summarize([flight({ distanceKm: 830 }), flight({ distanceKm: 1660 }), flight()], new Map())
		expect(s).toMatchObject({ flights: 3, distanceKm: 2490, withDistance: 2 })
	})

	it('counts distinct airports and airlines case-insensitively', () => {
		const s = summarize([
			flight({ originCode: 'LHR', destinationCode: 'dxb', airlineCode: 'ek' }),
			flight({ originCode: 'DXB', destinationCode: 'LHR', airlineCode: 'EK' }),
		], new Map())
		expect(s.airports).toBe(2)
		expect(s.airlines).toBe(1)
	})

	it('reports countries as unknown, not zero, without reference data', () => {
		const flights = [flight({ originCode: 'LHR', destinationCode: 'DXB' })]
		expect(summarize(flights, new Map()).countries).toBeNull()
		const index = indexAirports([airport('LHR', 'GB'), airport('DXB', 'AE')])
		expect(summarize(flights, index).countries).toBe(2)
	})

	it('finds reference rows by ICAO too', () => {
		const index = indexAirports([airport('LHR', 'GB')])
		expect(index.get('XLHR')?.countryIso2).toBe('GB')
		expect(airportCodes([flight({ originCode: 'lhr' })])).toEqual(new Set(['LHR']))
	})
})

describe('comparisonPeriod', () => {
	const flights = [
		flight({ flightDate: '2025-02-01' }),
		flight({ flightDate: '2025-11-01' }),
		flight({ flightDate: '2026-02-01' }),
		flight({ flightDate: '2026-11-01' }),
	]

	it('compares a past year with the whole previous year', () => {
		const p = comparisonPeriod(flights, 2025, '2026-06-15')
		expect(p.current).toHaveLength(2)
		expect(p.previous).toHaveLength(0)
		expect(p.label).toBe('vs 2024')
	})

	it('cuts both sides at today for the current year', () => {
		const p = comparisonPeriod(flights, 2026, '2026-06-15')
		expect(p.current.map((f) => f.flightDate)).toEqual(['2026-02-01'])
		expect(p.previous.map((f) => f.flightDate)).toEqual(['2025-02-01'])
		expect(p.label).toBe('vs 2025 to date')
	})

	it('has no percentage without a baseline', () => {
		expect(percentChange(5, 0)).toBeNull()
		expect(percentChange(15, 10)).toBe(50)
		expect(percentChange(5, 10)).toBe(-50)
	})
})

describe('periodSeries', () => {
	it('goes by month within one year, counting legs without a distance as flights only', () => {
		const s = periodSeries([
			flight({ flightDate: '2025-03-02', distanceKm: 800 }),
			flight({ flightDate: '2025-03-20', distanceKm: 5000 }),
			flight({ flightDate: '2025-12-01' }),
		])
		expect(s.unit).toBe('month')
		expect(s.labels).toHaveLength(12)
		expect(s.flights[2]).toBe(2)
		expect(s.km[2]).toBe(5800)
		expect(s.flights[11]).toBe(1)
		expect(s.km[11]).toBe(0)
	})

	it('goes by year across years, keeping empty years as zeros', () => {
		const s = periodSeries([flight({ flightDate: '2022-01-01', distanceKm: 100 }), flight({ flightDate: '2024-01-01', distanceKm: 100 })])
		expect(s.unit).toBe('year')
		expect(s.labels).toEqual(['2022', '2023', '2024'])
		expect(s.flights).toEqual([1, 0, 1])
		expect(s.km).toEqual([100, 0, 100])
	})
})

describe('weekdayCounts', () => {
	it('counts Monday first', () => {
		expect(weekdayCounts([flight({ flightDate: '2025-03-03' }), flight({ flightDate: '2025-03-09' })])).toEqual([1, 0, 0, 0, 0, 0, 1])
	})
})

describe('distanceDistribution', () => {
	it('bins legs with a distance and takes the true median', () => {
		const d = distanceDistribution([
			flight({ distanceKm: 300 }),
			flight({ distanceKm: 900 }),
			flight({ distanceKm: 1100 }),
			flight({ distanceKm: 9000 }),
			flight(),
		])
		expect(d.counts).toEqual([1, 1, 1, 0, 0, 1])
		expect(d.median).toBe(1000)
		expect(distanceDistribution([flight()]).median).toBeNull()
	})
})

describe('rankings', () => {
	it('orders by count, then alphabetically, regardless of input order', () => {
		const flights = [flight({ airlineCode: 'LH' }), flight({ airlineCode: 'BA' }), flight({ airlineCode: 'ek' }), flight({ airlineCode: 'EK' })]
		expect(rankAirlines(flights).map((r) => [r.key, r.count])).toEqual([['EK', 2], ['BA', 1], ['LH', 1]])
		expect(rankAirlines([...flights].reverse()).map((r) => r.key)).toEqual(['EK', 'BA', 'LH'])
	})

	it('counts a same-airport leg once, as the "to and from" filter would', () => {
		expect(rankAirports([flight({ originCode: 'LHR', destinationCode: 'LHR' })])).toEqual([{ key: 'LHR', label: 'LHR', count: 1 }])
	})

	it('ranks aircraft by the Aircraft column, so each row links to exactly its count', () => {
		const flights = [
			flight({ aircraftManufacturer: 'BOEING', aircraftModel: '737-800', aircraftTypeRaw: '738' }),
			flight({ aircraftManufacturer: 'BOEING', aircraftModel: '737-800' }),
			flight({ aircraftTypeRaw: 'Dash 8' }),
		]
		const rows = rankAircraft(flights)
		expect(rows.map((r) => [r.label, r.count])).toEqual([['BOEING 737-800', 2], ['Dash 8', 1]])
		for (const row of rows) {
			expect(applyFilters(flights, buildFilters({ aircraft: row.label }))).toHaveLength(row.count)
		}
		expect(rankManufacturers(flights)).toEqual([{ key: 'BOEING', label: 'BOEING', count: 2 }])
	})

	it('links airline and airport rows to filters returning the same counts', () => {
		const flights = [
			flight({ originCode: 'LHR', destinationCode: 'DXB', airlineCode: 'EK' }),
			flight({ originCode: 'DXB', destinationCode: 'BKK', airlineCode: 'EK' }),
			flight({ originCode: 'LHR', destinationCode: 'LHR', airlineCode: 'BA' }),
		]
		for (const row of rankAirports(flights)) {
			expect(applyFilters(flights, buildFilters({ airport: row.key, airportDir: 'either' }))).toHaveLength(row.count)
		}
		for (const row of rankAirlines(flights)) {
			expect(applyFilters(flights, buildFilters({ airline: row.key }))).toHaveLength(row.count)
		}
	})
})

describe('cabinBreakdown', () => {
	it('counts each class and the legs with none', () => {
		const b = cabinBreakdown([flight({ cabinClass: 'economy' }), flight({ cabinClass: 'business' }), flight({ cabinClass: 'economy' }), flight()])
		expect(b.classes.find((c) => c.value === 'economy')?.count).toBe(2)
		expect(b.classes.find((c) => c.value === 'first')?.count).toBe(0)
		expect(b.notLogged).toBe(1)
	})
})

describe('records', () => {
	it('takes the first occurrence of a tied longest or shortest leg', () => {
		const a = flight({ flightDate: '2025-05-01', distanceKm: 500 })
		const b = flight({ flightDate: '2025-01-01', distanceKm: 500 })
		const c = flight({ flightDate: '2025-03-01', distanceKm: 9000 })
		const r = records([a, b, c, flight()])
		expect(r.longest).toBe(c)
		expect(r.shortest).toBe(b)
	})

	it('combines both directions of a route, and needs it flown twice', () => {
		const once = records([flight({ originCode: 'LHR', destinationCode: 'DXB' })])
		expect(once.route).toBeNull()
		const r = records([
			flight({ originCode: 'LHR', destinationCode: 'DXB' }),
			flight({ originCode: 'DXB', destinationCode: 'LHR' }),
		])
		expect(r.route).toEqual({ a: 'DXB', b: 'LHR', count: 2 })
	})

	it('finds the most-flown airframe by registration', () => {
		const first = flight({ flightDate: '2025-01-01', registration: 'A6-ECM', airlineCode: 'EK' })
		const r = records([flight({ flightDate: '2025-02-01', registration: 'a6-ecm ' }), first, flight({ registration: 'G-XLEA' })])
		expect(r.airframe?.count).toBe(2)
		expect(r.airframe?.flight).toBe(first)
	})
})

describe('chart drill-through', () => {
	// Each chart element must open a log of exactly as many flights as it shows.
	const flights = [
		flight({ flightDate: '2025-03-03', distanceKm: 300, aircraftManufacturer: 'AIRBUS', aircraftModel: 'A-320', registration: 'D-AIZA' }),
		flight({ flightDate: '2025-03-04', distanceKm: 500, aircraftManufacturer: 'AIRBUS', aircraftModel: 'A-321', registration: 'd-aiza ' }),
		flight({ flightDate: '2025-03-09', distanceKm: 4000, aircraftManufacturer: 'BOEING', aircraftModel: '777-300ER' }),
		flight({ flightDate: '2025-03-09', distanceKm: 12000 }),
		flight({ flightDate: '2025-03-10' }),
	]

	it('distance bins', () => {
		const { counts } = distanceDistribution(flights)
		DISTANCE_BINS.forEach((bin, i) => {
			const query: Record<string, string> = {}
			if (i > 0) query.distanceMin = String(DISTANCE_BINS[i - 1].below)
			if (bin.below !== Infinity) query.distanceMax = String(bin.below)
			expect(applyFilters(flights, buildFilters(query))).toHaveLength(counts[i])
		})
	})

	it('weekdays', () => {
		const counts = weekdayCounts(flights)
		WEEKDAYS.forEach((day, i) => {
			expect(applyFilters(flights, buildFilters({ weekday: day.toLowerCase() }))).toHaveLength(counts[i])
		})
	})

	it('manufacturers and the most-flown airframe', () => {
		for (const row of rankManufacturers(flights)) {
			expect(applyFilters(flights, buildFilters({ manufacturer: row.key }))).toHaveLength(row.count)
		}
		const { airframe } = records(flights)
		expect(applyFilters(flights, buildFilters({ registration: airframe!.registration }))).toHaveLength(airframe!.count)
	})
})

describe('rankRoutes', () => {
	const flights = [
		flight({ originCode: 'LHR', destinationCode: 'DXB', distanceKm: 5470 }),
		flight({ originCode: 'dxb', destinationCode: 'LHR', distanceKm: 5470 }),
		flight({ originCode: 'DXB', destinationCode: 'BKK', distanceKm: 4900 }),
		flight({ originCode: 'LHR', destinationCode: 'EDI', distanceKm: 534 }),
		flight({ originCode: 'ZZZ', destinationCode: 'YYY' }),
		flight({ originCode: 'LHR', destinationLabel: 'Somewhere' }),
	]

	it('combines both directions, most-flown first, then the longer route', () => {
		expect(rankRoutes(flights)).toEqual([
			{ a: 'DXB', b: 'LHR', count: 2, distanceKm: 5470 },
			{ a: 'BKK', b: 'DXB', count: 1, distanceKm: 4900 },
			{ a: 'EDI', b: 'LHR', count: 1, distanceKm: 534 },
			{ a: 'YYY', b: 'ZZZ', count: 1, distanceKm: null },
		])
	})

	it('counts exactly what each route\'s drill-through returns', () => {
		for (const r of rankRoutes(flights)) {
			expect(applyFilters(flights, buildFilters({ routeA: r.a, routeB: r.b, routeDir: 'both' }))).toHaveLength(r.count)
		}
	})
})

describe('rankRoutesByDistanceFlown', () => {
	it('ranks by flights × distance, so one long haul can lead, and leaves out routes without a distance', () => {
		const route = (o: string, d: string, km: number | null, n: number) => Array.from({ length: n }, () => flight({ originCode: o, destinationCode: d, distanceKm: km }))
		const ranked = rankRoutesByDistanceFlown([
			...route('FRA', 'LHR', 650, 5), ...route('FRA', 'SYD', 16500, 1), ...route('FRA', 'DXB', 4800, 2), ...route('FRA', 'XXX', null, 9),
		])
		expect(ranked.map((r) => [`${r.a} ${r.b}`, r.totalKm])).toEqual([['FRA SYD', 16500], ['DXB FRA', 9600], ['FRA LHR', 3250]])
	})
})
