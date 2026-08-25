/**
 * How many of the user's flights each reference row accounts for, for the
 * "Flights" column on the Airports and Aircraft types views.
 *
 * Counted client-side from the flights store rather than aggregated in SQL, for
 * one reason worth keeping: each count is keyed by the *same value the
 * corresponding filter matches on*. So the number in the column is exactly how
 * many flights that row's own "Show flights…" action will return — correct by
 * construction rather than by two implementations agreeing.
 *
 * Keys are upper-cased on both sides, matching how `filters.ts` compares.
 */
import { aircraftDisplay } from './types.ts'
import type { Flight } from './types.ts'

/**
 * Flights per aircraft type, keyed by the Aircraft column's displayed value
 * ("BOEING 737-800"). Legs with no resolved type are not counted — no reference
 * row could claim them.
 *
 * @param flights The user's flights.
 */
export function countByAircraft(flights: Flight[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const f of flights) {
		const display = aircraftDisplay(f)
		if (!display) continue
		const key = display.toUpperCase()
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	return counts
}

/**
 * Flights per airport, keyed by canonical code, counting a leg once for each
 * *distinct* endpoint. The de-duplication matters for a leg that starts and ends
 * at the same airport (a scenic or training flight): it is one flight there, not
 * two, and this mirrors the "to and from" filter, which would return it once.
 *
 * @param flights The user's flights.
 */
export function countByAirport(flights: Flight[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const f of flights) {
		const endpoints = new Set<string>()
		if (f.originCode) endpoints.add(f.originCode.toUpperCase())
		if (f.destinationCode) endpoints.add(f.destinationCode.toUpperCase())
		for (const code of endpoints) {
			counts.set(code, (counts.get(code) ?? 0) + 1)
		}
	}
	return counts
}
