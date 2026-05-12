export interface Flight {
	id: number
	flightDate: string
	originCode: string | null
	destinationCode: string | null
	originLabel: string | null
	destinationLabel: string | null
	airlineCode: string | null
	flightNumber: string | null
	aircraftTypeCode: string | null
	aircraftTypeRaw: string | null
	registration: string | null
	cabinClass: string | null
	seat: string | null
	notes: string | null
	createdAt: number
	updatedAt: number
}

export type FlightInput = Omit<Flight, 'id' | 'createdAt' | 'updatedAt'>

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

export const CABIN_CLASSES = [
	{ value: 'economy', label: 'Economy' },
	{ value: 'premium_economy', label: 'Premium economy' },
	{ value: 'business', label: 'Business' },
	{ value: 'first', label: 'First' },
	{ value: 'other', label: 'Other' },
] as const
