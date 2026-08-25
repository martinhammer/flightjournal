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

export type FlightInput = Omit<Flight, 'id' | 'daySeq' | 'distanceKm' | 'createdAt' | 'updatedAt'>

/**
 * One reference row as chosen in the aircraft type-ahead. Sending these three
 * together is what tells the backend "the user picked this" — `resolveAircraft`
 * then honours them verbatim instead of reconciling the free text.
 *
 * Kept as a cohesive triple rather than three loose fields so the same value can
 * be applied to many flights at once by a future bulk update.
 */
export interface AircraftSelection {
	code: string
	manufacturer: string | null
	model: string | null
}

/**
 * Fold a pick into the payload. With no pick the aircraft fields stay null and
 * the server reconciles the free text — which is also what lets it preserve a
 * previously stored type when the text is unchanged.
 *
 * `aircraftTypeRaw` is deliberately untouched: the picked values have their own
 * columns, so the user's typed text survives the pick.
 *
 * @param input The form as edited.
 * @param selection The reference row the user picked, if any.
 */
export function withAircraftSelection(input: FlightInput, selection: AircraftSelection | null): FlightInput {
	if (!selection) return { ...input }
	return {
		...input,
		aircraftTypeCode: selection.code,
		aircraftManufacturer: selection.manufacturer,
		aircraftModel: selection.model,
	}
}

/**
 * A reference type's human name: "BOEING 737-800". Null when neither half is
 * present.
 *
 * Shared with the Aircraft types view and the editor's type-ahead so a reference
 * row is spelled identically wherever it appears — the flights filter matches on
 * this exact string, so a second copy of the join that drifted would silently
 * produce links that match nothing.
 *
 * @param manufacturer The reference manufacturer.
 * @param model The reference model.
 */
export function aircraftName(manufacturer: string | null, model: string | null): string | null {
	return [manufacturer, model].filter(Boolean).join(' ') || null
}

/**
 * What the Aircraft column shows, in priority order: the reconciled reference
 * type, then the user's own text, then the bare designator. Reference-first so
 * the resolved (or user-chosen) type is what the log actually displays, rather
 * than whatever shorthand happened to be typed.
 *
 * Shared so the table, its sort key, the filter matcher and the picker's option
 * list never disagree about what a leg is called.
 *
 * @param f The flight to describe.
 */
export function aircraftDisplay(
	f: Pick<Flight, 'aircraftManufacturer' | 'aircraftModel' | 'aircraftTypeRaw' | 'aircraftTypeCode'>,
): string | null {
	return aircraftName(f.aircraftManufacturer, f.aircraftModel) ?? f.aircraftTypeRaw ?? f.aircraftTypeCode
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
