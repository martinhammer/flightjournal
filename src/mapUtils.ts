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
