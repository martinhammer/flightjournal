import type { LocationQuery } from 'vue-router'
import type { Flight } from './types.ts'

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
