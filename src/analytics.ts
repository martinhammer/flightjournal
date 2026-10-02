/**
 * Aggregations for the Analytics view, computed client-side from the flights
 * store — the same reasoning as `flightCounts.ts`: every number that links into
 * the Flights view is keyed by the exact value that view's filter matches on,
 * so a bar reading "12" opens a log of 12 flights by construction.
 *
 * Pure functions over `Flight[]`; the view does the filtering (shared
 * `filters.ts`) and the presentation.
 */
import { countByAirport } from './flightCounts.ts'
import { CABIN_CLASSES, aircraftDisplay, type Airport, type Flight } from './types.ts'

// --- Derived per-flight values -------------------------------------------------

/**
 * Split a `YYYY-MM-DD` flight date into parts without going through local
 * time: `new Date('2025-03-02')` is UTC midnight, which is the previous
 * weekday anywhere west of Greenwich.
 *
 * @param date The flight date.
 */
export function dateParts(date: string): { year: number, month: number, weekday: number } {
	const [y, m, d] = date.split('-').map(Number)
	const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
	// Monday = 0 … Sunday = 6 (ISO order).
	return { year: y, month: m - 1, weekday: (day + 6) % 7 }
}

// --- Year selection -------------------------------------------------------------

/**
 * Years with flights, newest first, with their counts.
 *
 * @param flights The flights to scan.
 */
export function flightYears(flights: Flight[]): { year: number, count: number }[] {
	const counts = new Map<number, number>()
	for (const f of flights) {
		const year = dateParts(f.flightDate).year
		counts.set(year, (counts.get(year) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, count]) => ({ year, count }))
}

/**
 * The calendar year a `dateFrom`/`dateTo` pair spans exactly, or null if it is
 * anything else (open-ended, partial, several years).
 *
 * @param dateFrom The range start, if any.
 * @param dateTo The range end, if any.
 */
export function yearOfRange(dateFrom: unknown, dateTo: unknown): number | null {
	if (typeof dateFrom !== 'string' || typeof dateTo !== 'string') return null
	const m = /^(\d{4})-01-01$/.exec(dateFrom)
	return m && dateTo === `${m[1]}-12-31` ? Number(m[1]) : null
}

/**
 * The date-range query selecting one calendar year.
 *
 * @param year The year.
 */
export function yearRange(year: number): { dateFrom: string, dateTo: string } {
	return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }
}

// --- Summary ----------------------------------------------------------------------

export interface Summary {
	flights: number
	distanceKm: number
	/** Legs that contributed a distance; the rest are footnoted. */
	withDistance: number
	airports: number
	/** Null when no endpoint resolved to a reference airport. */
	countries: number | null
	airlines: number
}

/**
 * Codes of every airport endpoint, upper-cased.
 *
 * @param flights The flights to scan.
 */
export function airportCodes(flights: Flight[]): Set<string> {
	const codes = new Set<string>()
	for (const f of flights) {
		if (f.originCode) codes.add(f.originCode.toUpperCase())
		if (f.destinationCode) codes.add(f.destinationCode.toUpperCase())
	}
	return codes
}

/**
 * Index reference airports by the code flights store for them (IATA, else
 * ICAO — both are indexed so either form finds the row).
 *
 * @param airports Reference rows.
 */
export function indexAirports(airports: Airport[]): Map<string, Airport> {
	const index = new Map<string, Airport>()
	for (const a of airports) {
		if (a.icao) index.set(a.icao.toUpperCase(), a)
		if (a.iata) index.set(a.iata.toUpperCase(), a)
	}
	return index
}

/**
 * Headline numbers for a set of flights.
 *
 * @param flights The flights in scope.
 * @param airports Reference airports by code, for countries.
 */
export function summarize(flights: Flight[], airports: Map<string, Airport>): Summary {
	let distanceKm = 0
	let withDistance = 0
	const airlines = new Set<string>()
	for (const f of flights) {
		if (f.distanceKm !== null) {
			distanceKm += f.distanceKm
			withDistance++
		}
		if (f.airlineCode) airlines.add(f.airlineCode.toUpperCase())
	}
	const codes = airportCodes(flights)
	const countries = new Set<string>()
	let resolved = 0
	for (const code of codes) {
		const a = airports.get(code)
		if (!a) continue
		resolved++
		if (a.countryIso2) countries.add(a.countryIso2.toUpperCase())
	}
	return {
		flights: flights.length,
		distanceKm,
		withDistance,
		airports: codes.size,
		countries: resolved > 0 ? countries.size : null,
		airlines: airlines.size,
	}
}

/**
 * What a selected year is compared against. For the current year both sides
 * are cut at today's date, so January isn't measured against a whole year.
 *
 * @param flights The flights in scope *before* the year filter.
 * @param year The selected year.
 * @param today Today, as `YYYY-MM-DD`.
 */
export function comparisonPeriod(flights: Flight[], year: number, today: string): {
	current: Flight[]
	previous: Flight[]
	label: string
} {
	const toDate = dateParts(today).year === year
	const monthDay = today.slice(5)
	const inPeriod = (f: Flight, y: number) => f.flightDate.startsWith(`${y}-`)
		&& (!toDate || f.flightDate.slice(5) <= monthDay)
	return {
		current: flights.filter((f) => inPeriod(f, year)),
		previous: flights.filter((f) => inPeriod(f, year - 1)),
		label: toDate ? `vs ${year - 1} to date` : `vs ${year - 1}`,
	}
}

/**
 * Signed whole-percent change, or null when there is nothing to compare with.
 *
 * @param current This period's value.
 * @param previous The comparison period's value.
 */
export function percentChange(current: number, previous: number): number | null {
	if (previous === 0) return null
	return Math.round(((current - previous) / previous) * 100)
}

// --- Time series --------------------------------------------------------------------

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface PeriodSeries {
	unit: 'month' | 'year'
	labels: string[]
	/** One value per label. */
	flights: number[]
	/** Legs without a distance add nothing here, but still count as flights. */
	km: number[]
}

/**
 * Flights and distance per period. By month when the flights
 * fall within one calendar year, otherwise by year with empty years kept (a
 * gap in the axis would read as a missing year rather than a zero).
 *
 * @param flights The flights in scope.
 */
export function periodSeries(flights: Flight[]): PeriodSeries {
	const years = flights.map((f) => dateParts(f.flightDate).year)
	const min = Math.min(...years)
	const max = Math.max(...years)
	const byMonth = flights.length === 0 || min === max
	const labels = byMonth
		? MONTHS
		: Array.from({ length: max - min + 1 }, (_, i) => String(min + i))
	const series: PeriodSeries = {
		unit: byMonth ? 'month' : 'year',
		labels,
		flights: labels.map(() => 0),
		km: labels.map(() => 0),
	}
	for (const f of flights) {
		const parts = dateParts(f.flightDate)
		const i = byMonth ? parts.month : parts.year - min
		series.flights[i]++
		series.km[i] += f.distanceKm ?? 0
	}
	return series
}

/**
 * Flights per weekday, Monday first.
 *
 * @param flights The flights in scope.
 */
export function weekdayCounts(flights: Flight[]): number[] {
	const counts = [0, 0, 0, 0, 0, 0, 0]
	for (const f of flights) counts[dateParts(f.flightDate).weekday]++
	return counts
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// --- Distance -------------------------------------------------------------------------

export const EARTH_CIRCUMFERENCE_KM = 40075
export const EARTH_MOON_KM = 384400

export const DISTANCE_BINS = [
	{ label: '< 500 km', below: 500 },
	{ label: '500–1,000', below: 1000 },
	{ label: '1,000–2,000', below: 2000 },
	{ label: '2,000–4,000', below: 4000 },
	{ label: '4,000–8,000', below: 8000 },
	{ label: '> 8,000 km', below: Infinity },
] as const

/**
 * Legs per distance bin, plus the median. Legs without a distance are left out
 * of both.
 *
 * @param flights The flights in scope.
 */
export function distanceDistribution(flights: Flight[]): { counts: number[], median: number | null } {
	const distances = flights.flatMap((f) => (f.distanceKm === null ? [] : [f.distanceKm])).sort((a, b) => a - b)
	const counts = DISTANCE_BINS.map(() => 0)
	for (const km of distances) counts[DISTANCE_BINS.findIndex((b) => km < b.below)]++
	const n = distances.length
	const median = n === 0
		? null
		: n % 2 === 1 ? distances[(n - 1) / 2] : Math.round((distances[n / 2 - 1] + distances[n / 2]) / 2)
	return { counts, median }
}

// --- Rankings ---------------------------------------------------------------------------

export interface Ranked {
	/** Upper-cased; what the matching filter compares against. */
	key: string
	/** As displayed. */
	label: string
	count: number
}

// Most first; ties alphabetical, so the order never depends on input order.
function ranked(counts: Map<string, { label: string, count: number }>): Ranked[] {
	return [...counts.entries()]
		.map(([key, { label, count }]) => ({ key, label, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function rankBy(flights: Flight[], value: (f: Flight) => string | null): Ranked[] {
	const counts = new Map<string, { label: string, count: number }>()
	for (const f of flights) {
		const label = value(f)
		if (!label) continue
		const key = label.toUpperCase()
		const entry = counts.get(key)
		if (entry) entry.count++
		else counts.set(key, { label, count: 1 })
	}
	return ranked(counts)
}

/**
 * Airlines by flights, keyed by code (the `airline` filter's value).
 *
 * @param flights The flights in scope.
 */
export function rankAirlines(flights: Flight[]): Ranked[] {
	return rankBy(flights, (f) => f.airlineCode?.toUpperCase() ?? null)
}

/**
 * Aircraft by flights, keyed by the Aircraft column's displayed value (the
 * `aircraft` filter's value).
 *
 * @param flights The flights in scope.
 */
export function rankAircraft(flights: Flight[]): Ranked[] {
	return rankBy(flights, aircraftDisplay)
}

/**
 * Manufacturers of reconciled aircraft. Unresolved legs have no manufacturer
 * and are not counted.
 *
 * @param flights The flights in scope.
 */
export function rankManufacturers(flights: Flight[]): Ranked[] {
	return rankBy(flights, (f) => f.aircraftManufacturer)
}

/**
 * Airports by flights, a leg counting once per distinct endpoint — the same
 * count the "to and from" filter returns (see `countByAirport`).
 *
 * @param flights The flights in scope.
 */
export function rankAirports(flights: Flight[]): Ranked[] {
	const counts = new Map<string, { label: string, count: number }>()
	for (const [code, count] of countByAirport(flights)) counts.set(code, { label: code, count })
	return ranked(counts)
}

/**
 * Legs per cabin class in the editor's order, plus how many have none.
 *
 * @param flights The flights in scope.
 */
export function cabinBreakdown(flights: Flight[]): { classes: { value: string, label: string, count: number }[], notLogged: number } {
	const classes = CABIN_CLASSES.map((c) => ({ value: c.value as string, label: c.label as string, count: 0 }))
	let notLogged = 0
	for (const f of flights) {
		const entry = classes.find((c) => c.value === f.cabinClass)
		if (entry) entry.count++
		else notLogged++
	}
	return { classes, notLogged }
}

// --- Routes ---------------------------------------------------------------------------------

export interface RouteStat {
	/** Codes sorted, so A→B and B→A are one route — the route filter's `both`. */
	a: string
	b: string
	count: number
	/** Great-circle distance; null when no leg on the route has one. */
	distanceKm: number | null
}

/**
 * Routes by flights, both directions combined, most-flown first (ties by
 * longer distance, then alphabetically). A route is the pair of airport codes,
 * exactly as the route filter with `routeDir=both` matches it, so each count
 * equals what its drill-through returns. Legs missing either code are not
 * routes and are left out.
 *
 * @param flights The flights in scope.
 */
export function rankRoutes(flights: Flight[]): RouteStat[] {
	const routes = new Map<string, RouteStat>()
	for (const f of flights) {
		if (!f.originCode || !f.destinationCode) continue
		const [a, b] = [f.originCode.toUpperCase(), f.destinationCode.toUpperCase()].sort()
		const key = `${a} ${b}`
		const route = routes.get(key) ?? { a, b, count: 0, distanceKm: null }
		route.count++
		route.distanceKm ??= f.distanceKm
		routes.set(key, route)
	}
	return [...routes.values()].sort((x, y) => y.count - x.count
		|| (y.distanceKm ?? -1) - (x.distanceKm ?? -1)
		|| `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`))
}

/**
 * Routes with a distance, ranked by distance flown on them — flights ×
 * distance — so one long haul can outrank many short hops. Ties fall back to
 * more flights, then alphabetically.
 *
 * @param flights The flights in scope.
 */
export function rankRoutesByDistanceFlown(flights: Flight[]): (RouteStat & { totalKm: number })[] {
	return rankRoutes(flights)
		.filter((r) => r.distanceKm !== null)
		.map((r) => ({ ...r, totalKm: r.count * r.distanceKm! }))
		.sort((x, y) => y.totalKm - x.totalKm || y.count - x.count || `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`))
}

// --- Records ------------------------------------------------------------------------------

export interface Records {
	longest: Flight | null
	shortest: Flight | null
	/** Codes sorted, so A→B and B→A are one route. Null unless flown twice. */
	route: { a: string, b: string, count: number } | null
	/** Null unless one airframe was flown twice. */
	airframe: { registration: string, count: number, flight: Flight } | null
}

// Oldest first on ties, so the record is the first time it happened.
const chronological = (a: Flight, b: Flight) => a.flightDate.localeCompare(b.flightDate) || a.daySeq - b.daySeq || a.id - b.id

/**
 * Longest and shortest legs, most-flown route and airframe.
 *
 * @param flights The flights in scope.
 */
export function records(flights: Flight[]): Records {
	const measured = flights.filter((f) => f.distanceKm !== null).sort(chronological)
	let longest: Flight | null = null
	let shortest: Flight | null = null
	for (const f of measured) {
		if (!longest || f.distanceKm! > longest.distanceKm!) longest = f
		if (!shortest || f.distanceKm! < shortest.distanceKm!) shortest = f
	}

	const routes = rankBy(flights, (f) => (f.originCode && f.destinationCode
		? [f.originCode.toUpperCase(), f.destinationCode.toUpperCase()].sort().join(' ')
		: null))
	const route = routes[0]?.count > 1
		? { a: routes[0].key.split(' ')[0], b: routes[0].key.split(' ')[1], count: routes[0].count }
		: null

	const airframes = rankBy(flights, (f) => f.registration?.trim().toUpperCase() || null)
	const top = airframes[0]
	const airframe = top?.count > 1
		? {
			registration: top.label,
			count: top.count,
			flight: [...flights].sort(chronological).find((f) => f.registration?.trim().toUpperCase() === top.key)!,
		}
		: null

	return { longest, shortest, route, airframe }
}
