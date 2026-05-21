// world-atlas ships a TopoJSON file consumed via topojson-client. The
// @types/topojson-client package pulls in `topojson-specification`, which is
// not installable from the registry — so the thin slice we use is declared
// directly here instead.
declare module 'topojson-client' {
	import type { GeoJsonObject } from 'geojson'

	export function feature(topology: unknown, object: unknown): GeoJsonObject
}

declare module 'world-atlas/countries-110m.json' {
	const topology: { objects: { countries: unknown } }
	export default topology
}
