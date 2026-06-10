import type { LocationQuery } from 'vue-router'
import { CABIN_CLASSES, type Flight } from './types.ts'

/**
 * An active filter derived from the route query, shared by the Flights and Map
 * views so both interpret the query identically. New filter types (airline,
 * aircraft, date range, …) extend buildFilters() — the chip row and clearing
 * logic are generic over this shape.
 */
export interface ActiveFilter {
	id: string
	label: string
	/** Query keys to drop when this filter's chip is cleared. */
	queryKeys: string[]
	matches: (f: Flight) => boolean
}

export type AirportDirection = 'to' | 'from' | 'either'

function airportDirection(value: unknown): AirportDirection | null {
	return value === 'to' || value === 'from' || value === 'either' ? value : null
}

// Parse a comma-separated query value into a unique uppercase list. Empty
// strings and whitespace-only entries are skipped.
function csvParam(value: unknown): string[] {
	if (typeof value !== 'string') return []
	return [...new Set(
		value.split(',')
			.map((s) => s.trim().toUpperCase())
			.filter((s) => s !== ''),
	)]
}

// Match a YYYY-MM-DD string with light tolerance: returns the string when it
// parses to a real calendar date, otherwise null. Avoids letting bad query
// values silently filter everything out.
function isoDate(value: unknown): string | null {
	if (typeof value !== 'string') return null
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
	const d = new Date(`${value}T00:00:00Z`)
	if (Number.isNaN(d.getTime())) return null
	// Round-trip to catch dates like 2025-02-30 → parses as 2025-03-02.
	return d.toISOString().slice(0, 10) === value ? value : null
}

const CABIN_LABELS: Record<string, string> = Object.fromEntries(
	CABIN_CLASSES.map((c) => [c.value, c.label]),
)

// Short human description of a single flight for a filter chip. Includes the
// date so it is clear the filter targets one instance, not every flight with
// that number (e.g. "BA123 2026-01-30").
function describeFlight(f: Flight): string {
	const code = `${f.airlineCode ?? ''}${f.flightNumber ?? ''}`.trim()
	const what = code
		|| `${f.originCode || f.originLabel || '?'} → ${f.destinationCode || f.destinationLabel || '?'}`
	return `${what} ${f.flightDate}`
}

// Build the active filters from the route query. `flights` is used only to
// resolve a human label for the single-flight filter; pass [] when unavailable.
export function buildFilters(query: LocationQuery, flights: Flight[] = []): ActiveFilter[] {
	const filters: ActiveFilter[] = []

	const airport = typeof query.airport === 'string' ? query.airport.toUpperCase() : ''
	const dir = airportDirection(query.airportDir)
	// Both an airport and an explicit direction are required: `airport` alone is
	// a focus hint for the Map view, not a filter.
	if (airport && dir !== null) {
		const label = dir === 'from'
			? `From ${airport}`
			: dir === 'either'
				? `To / from ${airport}`
				: `To ${airport}`
		filters.push({
			id: 'airport',
			label,
			queryKeys: ['airport', 'airportDir'],
			matches: (f) => {
				const origin = (f.originCode ?? '').toUpperCase()
				const destination = (f.destinationCode ?? '').toUpperCase()
				if (dir === 'from') return origin === airport
				if (dir === 'either') return origin === airport || destination === airport
				return destination === airport
			},
		})
	}

	const routeA = typeof query.routeA === 'string' ? query.routeA.toUpperCase() : ''
	const routeB = typeof query.routeB === 'string' ? query.routeB.toUpperCase() : ''
	const routeDir = query.routeDir === 'ab' || query.routeDir === 'both' ? query.routeDir : null
	if (routeA && routeB && routeDir) {
		const bidirectional = routeDir === 'both'
		filters.push({
			id: 'route',
			label: bidirectional ? `${routeA} ↔ ${routeB}` : `${routeA} → ${routeB}`,
			queryKeys: ['routeA', 'routeB', 'routeDir'],
			matches: (f) => {
				const o = (f.originCode ?? '').toUpperCase()
				const d = (f.destinationCode ?? '').toUpperCase()
				if (bidirectional) {
					return (o === routeA && d === routeB) || (o === routeB && d === routeA)
				}
				return o === routeA && d === routeB
			},
		})
	}

	// Date range: a single chip when either endpoint is set; missing side is
	// rendered as "…" so the user can tell which end is open.
	const dateFrom = isoDate(query.dateFrom)
	const dateTo = isoDate(query.dateTo)
	if (dateFrom || dateTo) {
		const label = `${dateFrom ?? '…'} → ${dateTo ?? '…'}`
		filters.push({
			id: 'date',
			label,
			queryKeys: ['dateFrom', 'dateTo'],
			matches: (f) => {
				if (dateFrom && f.flightDate < dateFrom) return false
				if (dateTo && f.flightDate > dateTo) return false
				return true
			},
		})
	}

	// Cabin class: closed enum, multi-value via CSV. Values that don't match a
	// known cabin are silently dropped so a broken URL doesn't reject everything.
	const cabins = csvParam(query.cabin)
		.map((c) => c.toLowerCase())
		.filter((c) => c in CABIN_LABELS)
	if (cabins.length > 0) {
		const cabinSet = new Set(cabins)
		const label = `Cabin: ${cabins.map((c) => CABIN_LABELS[c]).join(', ')}`
		filters.push({
			id: 'cabin',
			label,
			queryKeys: ['cabin'],
			matches: (f) => f.cabinClass !== null && cabinSet.has(f.cabinClass),
		})
	}

	// Airline: free-form CSV (we don't know every possible code up front).
	const airlines = csvParam(query.airline)
	if (airlines.length > 0) {
		const airlineSet = new Set(airlines)
		filters.push({
			id: 'airline',
			label: `Airline: ${airlines.join(', ')}`,
			queryKeys: ['airline'],
			matches: (f) => f.airlineCode !== null && airlineSet.has(f.airlineCode.toUpperCase()),
		})
	}

	// Aircraft type: same shape as airline. We compare against the table's
	// display value (raw-then-code) because many flights only have
	// aircraftTypeRaw populated; the option list in the picker uses the same
	// fallback so what you see is what you can filter on.
	const aircraft = csvParam(query.aircraft)
	if (aircraft.length > 0) {
		const aircraftSet = new Set(aircraft)
		filters.push({
			id: 'aircraft',
			label: `Aircraft: ${aircraft.join(', ')}`,
			queryKeys: ['aircraft'],
			matches: (f) => {
				const display = f.aircraftTypeRaw ?? f.aircraftTypeCode
				return display !== null && aircraftSet.has(display.toUpperCase())
			},
		})
	}

	// Unmatched airports: legs where an endpoint did not resolve to a reference
	// code (a null `_code` means "no confident match"). The FilterPicker only
	// offers this when reference data exists, but the matcher itself is purely
	// client-side and needs no list context.
	if (query.unmatched === '1') {
		filters.push({
			id: 'unmatched',
			label: 'Unmatched airports',
			queryKeys: ['unmatched'],
			matches: (f) => !f.originCode || !f.destinationCode,
		})
	}

	// Days with multiple flights: every leg whose `flight_date` carries more than
	// one flight, so the user can find and reorder same-day legs. The multi-day
	// set is derived from the full list, so this filter keeps whole days intact —
	// which is what lets the Flights view still allow reordering under it.
	if (query.multiday === '1') {
		const perDate = new Map<string, number>()
		for (const f of flights) perDate.set(f.flightDate, (perDate.get(f.flightDate) ?? 0) + 1)
		filters.push({
			id: 'multiday',
			label: 'Days with multiple flights',
			queryKeys: ['multiday'],
			matches: (f) => (perDate.get(f.flightDate) ?? 0) > 1,
		})
	}

	const flightId = typeof query.flight === 'string' ? Number(query.flight) : NaN
	if (Number.isInteger(flightId) && flightId > 0) {
		const match = flights.find((f) => f.id === flightId)
		filters.push({
			id: 'flight',
			label: match ? describeFlight(match) : `Flight #${flightId}`,
			queryKeys: ['flight'],
			matches: (f) => f.id === flightId,
		})
	}

	return filters
}

// Apply every active filter to a flight list (AND semantics).
export function applyFilters(flights: Flight[], filters: ActiveFilter[]): Flight[] {
	if (filters.length === 0) return flights
	return flights.filter((f) => filters.every((filter) => filter.matches(f)))
}
