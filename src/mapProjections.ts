// Custom Leaflet projections via proj4leaflet. EXPERIMENTAL.
//
// To back this out cleanly:
//   1. Delete this file.
//   2. Remove 'polar-north' and 'azimuthal-home' from `Projection` and
//      `PROJECTIONS` in src/store/mapSettings.ts.
//   3. Remove the corresponding cases in `crsFor` (src/views/MapView.vue).
//   4. `npm uninstall proj4 proj4leaflet @types/proj4 @types/proj4leaflet`.
// The built-in projections (Web Mercator / Equirectangular / Mercator) keep
// working without this file or those deps.

import L, { bounds as latLngBounds } from 'leaflet'
import 'proj4leaflet'
import type { Airport, Flight } from './types.ts'

// EPSG:3995 — Arctic Polar Stereographic, true scale at 71°N. The equator
// projects to ~12.4 M m from the pole; the south pole is at infinity. Extent
// of ±20 M m comfortably contains the whole northern hemisphere and a chunk of
// the southern, which is what we need to render the world basemap. The
// resolutions array is sized so zoom 0 fits the full extent on screen.
const POLAR_EXTENT = 20_000_000
const POLAR_RESOLUTIONS: number[] = (() => {
	const r: number[] = []
	let v = 80_000 // m/px at zoom 0 — ~40 M m across a ~500 px viewport
	for (let i = 0; i < 10; i++) {
		r.push(v)
		v /= 2
	}
	return r
})()

/**
 * Pick a zoom level for the polar projection that keeps the north pole at the
 * centre of the viewport while still showing the farthest flown airport.
 *
 * Without this, Leaflet's fitBounds would centre on the airport cluster and
 * push the pole into a corner.
 */
export function polarNorthFitZoom(points: L.LatLng[], viewportPx: number): number {
	if (points.length === 0) return 1
	const R = 6378137 // WGS84 equatorial radius (m)
	let maxRho = 0
	for (const p of points) {
		// Stereographic radial distance from the projection centre (the pole).
		const colat = (90 - p.lat) * Math.PI / 180
		const rho = 2 * R * Math.tan(colat / 2)
		if (rho > maxRho) maxRho = rho
	}
	// Want maxRho metres to fit inside half the (shorter) viewport dimension,
	// with ~10% padding.
	const half = Math.max(50, viewportPx / 2)
	const targetRes = (maxRho * 1.1) / half
	// Find the smallest zoom (i.e. largest resolution index) where the
	// resolution is >= the target. Resolutions are sorted high → low.
	for (let z = POLAR_RESOLUTIONS.length - 1; z >= 0; z--) {
		if (POLAR_RESOLUTIONS[z] >= targetRes) return z
	}
	return 0
}

export function polarStereographicNorthCRS(): L.CRS {
	return new L.Proj.CRS(
		'EPSG:3995',
		'+proj=stere +lat_0=90 +lat_ts=71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
		{
			resolutions: POLAR_RESOLUTIONS,
			origin: [-POLAR_EXTENT, POLAR_EXTENT],
			bounds: latLngBounds(
				[-POLAR_EXTENT, -POLAR_EXTENT],
				[POLAR_EXTENT, POLAR_EXTENT],
			),
		},
	)
}

// Azimuthal Equidistant centred on (lat, lon). Distances FROM that point are
// true to scale; the antipode is a singularity, so the far side of the globe
// gets distorted dramatically — that's the point, it makes "how far have I
// flown from home?" legible.
const AEQD_EXTENT = 22_000_000 // ~half-circumference plus margin
const AEQD_RESOLUTIONS: number[] = (() => {
	const r: number[] = []
	let v = 90_000
	for (let i = 0; i < 10; i++) {
		r.push(v)
		v /= 2
	}
	return r
})()

/**
 * Pick a zoom for the AEQD projection that keeps the centre point centred
 * while showing the farthest airport. AEQD's defining property is that the
 * projected distance from the centre equals the great-circle distance, so we
 * can just measure that distance and match it to a resolution.
 */
export function azimuthalFitZoom(
	points: L.LatLng[],
	center: L.LatLngExpression,
	viewportPx: number,
): number {
	if (points.length === 0) return 3
	const centreLatLng = L.latLng(center as L.LatLngTuple)
	let maxDist = 0
	for (const p of points) {
		const d = centreLatLng.distanceTo(p)
		if (d > maxDist) maxDist = d
	}
	const half = Math.max(50, viewportPx / 2)
	const targetRes = (maxDist * 1.1) / half
	for (let z = AEQD_RESOLUTIONS.length - 1; z >= 0; z--) {
		if (AEQD_RESOLUTIONS[z] >= targetRes) return z
	}
	return 0
}

export function azimuthalEquidistantCRS(centerLat: number, centerLon: number): L.CRS {
	const proj4def = `+proj=aeqd +lat_0=${centerLat} +lon_0=${centerLon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`
	// Code includes the centre so Leaflet treats re-centred CRSes as distinct.
	const code = `AEQD:${centerLat.toFixed(3)}:${centerLon.toFixed(3)}`
	return new L.Proj.CRS(code, proj4def, {
		resolutions: AEQD_RESOLUTIONS,
		origin: [-AEQD_EXTENT, AEQD_EXTENT],
		bounds: latLngBounds(
			[-AEQD_EXTENT, -AEQD_EXTENT],
			[AEQD_EXTENT, AEQD_EXTENT],
		),
	})
}

// Choose a "home" airport: the most frequently flown code across origins and
// destinations. Returns null if no flights have codes or none resolve to a
// known airport with coordinates.
export function pickHomeAirport(flights: Flight[], airports: Airport[]): Airport | null {
	const counts = new Map<string, number>()
	for (const f of flights) {
		if (f.originCode) counts.set(f.originCode.toUpperCase(), (counts.get(f.originCode.toUpperCase()) ?? 0) + 1)
		if (f.destinationCode) counts.set(f.destinationCode.toUpperCase(), (counts.get(f.destinationCode.toUpperCase()) ?? 0) + 1)
	}
	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
	for (const [code] of ranked) {
		const a = airports.find((x) =>
			(x.iata?.toUpperCase() === code) || (x.icao?.toUpperCase() === code),
		)
		if (a && a.lat !== null && a.lon !== null) return a
	}
	return null
}
