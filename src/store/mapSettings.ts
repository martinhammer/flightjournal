import { defineStore } from 'pinia'
import { ref } from 'vue'

// In-memory only — resets on reload. The Map view reads `projection` and
// rebuilds the Leaflet map when it changes.
// 'polar-north' and 'azimuthal-home' are powered by proj4leaflet
// (see src/mapProjections.ts) — drop them to back out the custom CRSes.
export type Projection =
	| 'web-mercator'
	| 'equirectangular'
	| 'mercator'
	| 'polar-north'
	| 'azimuthal-home'

export const PROJECTIONS: { id: Projection; label: string }[] = [
	{ id: 'web-mercator', label: 'Web Mercator' },
	{ id: 'equirectangular', label: 'Equirectangular' },
	{ id: 'mercator', label: 'Mercator (ellipsoidal)' },
	{ id: 'polar-north', label: 'Polar Stereographic (North)' },
	{ id: 'azimuthal-home', label: 'Azimuthal Equidistant' },
]

export const useMapSettingsStore = defineStore('mapSettings', () => {
	const projection = ref<Projection>('web-mercator')
	return { projection }
})
