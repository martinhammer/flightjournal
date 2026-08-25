export interface Flight {
	id: number
	flightDate: string
	daySeq: number
	originCode: string | null
	destinationCode: string | null
	originLabel: string | null
	destinationLabel: string | null
	airlineCode: string | null
	flightNumber: string | null
	aircraftTypeCode: string | null
	aircraftTypeRaw: string | null
	aircraftManufacturer: string | null
	aircraftModel: string | null
	registration: string | null
	cabinClass: string | null
	seat: string | null
	notes: string | null
	distanceKm: number | null
	createdAt: number
	updatedAt: number
}

/**
 * The aircraft manufacturer/model are server-derived by reconciliation, so the
 * editor never submits them — the same reason distanceKm is excluded. They
 * become part of the input only once the Edit view can override the resolved
 * model.
 */
export type FlightInput = Omit<
	Flight,
	'id' | 'daySeq' | 'distanceKm' | 'createdAt' | 'updatedAt' | 'aircraftManufacturer' | 'aircraftModel'
>

/**
 * What the Aircraft column shows, in priority order: the reconciled reference
 * model, then the user's own text, then the bare designator. Model-first so the
 * resolved (and later, user-chosen) model is what the log actually displays.
 * Shared so the table, its sort key and the filters never disagree.
 *
 * @param f The flight to describe.
 */
export function aircraftDisplay(f: Pick<Flight, 'aircraftModel' | 'aircraftTypeRaw' | 'aircraftTypeCode'>): string | null {
	return f.aircraftModel ?? f.aircraftTypeRaw ?? f.aircraftTypeCode
}

export interface Airport {
	id: number
	iata: string | null
	icao: string | null
	name: string | null
	city: string | null
	state: string | null
	countryIso2: string | null
	lat: number | null
	lon: number | null
	elevation: number | null
	tz: string | null
	source: string | null
	updatedAt: number
}

/**
 * A row of the aircraft reference table — one *model*, not one designator.
 * `icaoCode` groups the models sharing a designator; `canonical` marks the one
 * a bare designator resolves to.
 */
export interface AircraftType {
	id: number
	icaoCode: string
	iataCode: string | null
	manufacturer: string | null
	model: string | null
	modelNormalized: string | null
	engineType: string | null
	engineCount: number | null
	wtc: string | null
	description: string | null
	canonical: boolean
	source: string | null
	updatedAt: number
}

export const CABIN_CLASSES = [
	{ value: 'economy', label: 'Economy' },
	{ value: 'premium_economy', label: 'Premium economy' },
	{ value: 'business', label: 'Business' },
	{ value: 'first', label: 'First' },
	{ value: 'other', label: 'Other' },
] as const
