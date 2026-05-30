import type { Airport, Flight } from './types.ts'

// GeoJSON.* types come from the global namespace declared by @types/geojson.

// Distinct uppercase airport codes referenced by a set of flights, plus an
// optional focus code. Only the canonical `_code` fields are used — flights
// whose endpoints never reconciled simply contribute nothing.
export function collectAirportCodes(flights: Flight[], focus: string | null = null): string[] {
	const codes = new Set<string>()
	for (const f of flights) {
		if (f.originCode) codes.add(f.originCode.toUpperCase())
		if (f.destinationCode) codes.add(f.destinationCode.toUpperCase())
	}
	if (focus) codes.add(focus.toUpperCase())
	return [...codes]
}

export interface MapLeg {
	from: Airport
	to: Airport
}

// Flight legs whose origin and destination both resolve to an airport with
// coordinates. Flights missing a code or coordinate are skipped.
export function buildLegs(flights: Flight[], byCode: Map<string, Airport>): MapLeg[] {
	const legs: MapLeg[] = []
	for (const f of flights) {
		if (!f.originCode || !f.destinationCode) continue
		const from = byCode.get(f.originCode.toUpperCase())
		const to = byCode.get(f.destinationCode.toUpperCase())
		if (!from || !to) continue
		if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) continue
		legs.push({ from, to })
	}
	return legs
}

// Great-circle (haversine) distance in whole km. Mirrors the backend formula
// in lib/Service/GreatCircle.php so on-screen values match the persisted one.
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371.0088
	const toRad = (d: number) => d * Math.PI / 180
	const dLat = toRad(lat2 - lat1)
	const dLon = toRad(lon2 - lon1)
	const a = Math.sin(dLat / 2) ** 2
		+ Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
	return Math.round(R * c)
}

// Number of journal flights involving each airport code (as origin OR
// destination), keyed by uppercased code. Each flight counts once per airport.
export function countFlightsByAirport(flights: Flight[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const f of flights) {
		const codes = new Set<string>()
		if (f.originCode) codes.add(f.originCode.toUpperCase())
		if (f.destinationCode) codes.add(f.destinationCode.toUpperCase())
		for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
	}
	return counts
}

// Canonical key for an unordered airport pair, e.g. routeKey('LHR','JFK') and
// routeKey('JFK','LHR') both yield 'JFK|LHR'.
export function routeKey(codeA: string, codeB: string): string {
	return [codeA.toUpperCase(), codeB.toUpperCase()].sort().join('|')
}

// Number of journal flights between each airport pair, counting both
// directions together, keyed by routeKey().
export function countFlightsByRoute(flights: Flight[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const f of flights) {
		if (!f.originCode || !f.destinationCode) continue
		const key = routeKey(f.originCode, f.destinationCode)
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	return counts
}

// The two directional orderings [from, to] of a route pair, with the
// oldest-flown direction first. Falls back to alphabetical by code when no
// flight resolves the order.
export function orderedRouteDirections(a: string, b: string, flights: Flight[]): [string, string][] {
	const codeA = a.toUpperCase()
	const codeB = b.toUpperCase()
	let oldest: Flight | null = null
	for (const f of flights) {
		const o = (f.originCode ?? '').toUpperCase()
		const d = (f.destinationCode ?? '').toUpperCase()
		const onRoute = (o === codeA && d === codeB) || (o === codeB && d === codeA)
		if (onRoute && (oldest === null || f.flightDate < oldest.flightDate)) {
			oldest = f
		}
	}
	if (oldest && oldest.originCode && oldest.destinationCode) {
		const o = oldest.originCode.toUpperCase()
		const d = oldest.destinationCode.toUpperCase()
		return [[o, d], [d, o]]
	}
	const sorted = [codeA, codeB].sort()
	return [[sorted[0], sorted[1]], [sorted[1], sorted[0]]]
}

// The directional [from, to] pairs of a route that were actually flown,
// oldest-flown first. Returns one entry when the route was only flown one way.
export function flownRouteDirections(a: string, b: string, flights: Flight[]): [string, string][] {
	const flown = (from: string, to: string) => flights.some((f) =>
		(f.originCode ?? '').toUpperCase() === from
		&& (f.destinationCode ?? '').toUpperCase() === to)
	return orderedRouteDirections(a, b, flights).filter(([from, to]) => flown(from, to))
}

// Index airports by their canonical code (IATA preferred, else ICAO), uppercased.
export function indexByCode(airports: Airport[]): Map<string, Airport> {
	const map = new Map<string, Airport>()
	for (const a of airports) {
		const code = (a.iata || a.icao || '').toUpperCase()
		if (code) map.set(code, a)
	}
	return map
}

// Rewrite a ring's longitudes to run continuously, removing the ±360 jump at
// the antimeridian. Without this, Leaflet draws a polygon that wraps the seam
// as a band spanning the whole map (Russia, Fiji).
export function unwrapRing(ring: GeoJSON.Position[]): GeoJSON.Position[] {
	if (ring.length === 0) return ring
	const out: GeoJSON.Position[] = [[...ring[0]]]
	for (let i = 1; i < ring.length; i++) {
		let lon = ring[i][0]
		const prevLon = out[i - 1][0]
		while (lon - prevLon > 180) lon -= 360
		while (lon - prevLon < -180) lon += 360
		out.push([lon, ring[i][1]])
	}
	return out
}

// Make a world basemap safe for Leaflet's flat projection: drop Antarctica
// (a pole-encircling ring that cannot be unwrapped) and unwrap every other
// polygon ring so nothing crosses the antimeridian.
export function prepareBasemap(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
	const features = fc.features
		.filter((f) => f.properties?.name !== 'Antarctica')
		.map((f) => {
			const g = f.geometry
			if (g.type === 'Polygon') {
				return { ...f, geometry: { ...g, coordinates: g.coordinates.map(unwrapRing) } }
			}
			if (g.type === 'MultiPolygon') {
				return { ...f, geometry: { ...g, coordinates: g.coordinates.map((p) => p.map(unwrapRing)) } }
			}
			return f
		})
	return { type: 'FeatureCollection', features }
}
